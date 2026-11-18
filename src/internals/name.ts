import { CompilerContext } from "./context";
import { Bytes } from "./bytes";

// Append UTF-8 bytes directly to the byte pool; avoid TextEncoder's temporary
// Uint8Array so the intern table stays a compact byte-oriented SoA.
export function writeUtf8(text: string, bytes: Bytes): number {
  const start = bytes.length;
  for (let i = 0; i < text.length; i++) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff) {
      if (i + 1 < text.length) {
        const low = text.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00;
          i++;
        } else cp = 0xfffd;
      } else cp = 0xfffd;
    } else if (cp >= 0xdc00 && cp <= 0xdfff) cp = 0xfffd;

    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return bytes.length - start;
}

export function utf8ByteLength(text: string): number {
  let length = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length &&
        text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      i++;
      length += 4;
    } else if (cp < 0x80) length++;
    else if (cp < 0x800) length += 2;
    else length += 3;
  }
  return length;
}

// Append UTF-8 payload bytes without a terminator, or append a C string with
// exactly one trailing NUL. Return the payload's byte offset in the pool.
export function appendBytes(text: string, pool: Bytes): number {
  const offset = pool.length;
  writeUtf8(text, pool);
  return offset;
}

export function appendCString(text: string, pool: Bytes): number {
  const offset = appendBytes(text, pool);
  pool.push(0);
  return offset;
}

function decodeUtf8(bytes: Bytes, start: number, length: number): string {
  let text = "";
  const end = start + length;
  for (let i = start; i < end;) {
    const a = bytes.load(i++);
    let cp: number;
    if (a < 0x80) cp = a;
    else if (a < 0xe0 && i < end) cp = ((a & 0x1f) << 6) | (bytes.load(i++) & 0x3f);
    else if (a < 0xf0 && i + 1 < end) cp = ((a & 0x0f) << 12) | ((bytes.load(i++) & 0x3f) << 6) | (bytes.load(i++) & 0x3f);
    else if (i + 2 < end) cp = ((a & 7) << 18) | ((bytes.load(i++) & 0x3f) << 12) | ((bytes.load(i++) & 0x3f) << 6) | (bytes.load(i++) & 0x3f);
    else { text += "\ufffd"; break; }
    if (cp <= 0xffff) text += String.fromCharCode(cp);
    else {
      cp -= 0x10000;
      text += String.fromCharCode(0xd800 | (cp >> 10), 0xdc00 | (cp & 0x3ff));
    }
  }
  return text;
}

// ─── interned names ──────────────────────────────────────────────────────
// Compile-time names (the builtin names and the import bindings that refer to
// them) live as bytes: the characters go in symbolPool, and each name's
// (start, length) is recorded in the parallel internStarts / internLengths
// arrays. A name's id is its index in those arrays, so resolution is a plain
// byte comparison — no separate JS string table to keep in step.

// Find an interned name's id, or -1 when it was never interned.
export function readIntern(name: string, ctx: CompilerContext): number {
  // Compare encoded bytes in place without allocating an encoded string buffer.
  const encodedLength = utf8ByteLength(name);
  for (let id = 0; id < ctx.internStarts.length; id++) {
    const start = ctx.internStarts[id];
    const length = ctx.internLengths[id];
    if (length !== encodedLength) continue;
    let same = true;
    let at = start;
    for (let i = 0; i < name.length; i++) {
      let cp = name.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < name.length) {
        const low = name.charCodeAt(i + 1);
        if (low >= 0xdc00 && low <= 0xdfff) { cp = 0x10000 + ((cp - 0xd800) << 10) + low - 0xdc00; i++; }
        else cp = 0xfffd;
      } else if (cp >= 0xdc00 && cp <= 0xdfff) cp = 0xfffd;
      if (cp < 0x80) { if (ctx.symbolPool.load(at++) !== cp) { same = false; break; } }
      else if (cp < 0x800) {
        if (ctx.symbolPool.load(at++) !== (0xc0 | (cp >> 6)) || ctx.symbolPool.load(at++) !== (0x80 | (cp & 0x3f))) { same = false; break; }
      } else if (cp < 0x10000) {
        if (ctx.symbolPool.load(at++) !== (0xe0 | (cp >> 12)) || ctx.symbolPool.load(at++) !== (0x80 | ((cp >> 6) & 0x3f)) || ctx.symbolPool.load(at++) !== (0x80 | (cp & 0x3f))) { same = false; break; }
      } else if (ctx.symbolPool.load(at++) !== (0xf0 | (cp >> 18)) || ctx.symbolPool.load(at++) !== (0x80 | ((cp >> 12) & 0x3f)) || ctx.symbolPool.load(at++) !== (0x80 | ((cp >> 6) & 0x3f)) || ctx.symbolPool.load(at++) !== (0x80 | (cp & 0x3f))) { same = false; break; }
    }
    if (same) return id;
  }
  return -1;
}

// Intern a name, returning its id. Idempotent: an already-interned name keeps
// its id. Bytes live in symbolPool and are omitted from emitted binaries unless
// a runtime data address is explicitly requested by the emitter.
export function writeIntern(name: string, ctx: CompilerContext): number {
  const existing = readIntern(name, ctx);
  if (existing !== -1) return existing;

  const id = ctx.internStarts.length;
  const start = appendCString(name, ctx.symbolPool);
  ctx.internStarts.push(start);
  ctx.internLengths.push(ctx.symbolPool.length - start - 1);
  return id;
}

export function readInternText(id: number, ctx: CompilerContext): string | undefined {
  const start = ctx.internStarts[id];
  const length = ctx.internLengths[id];
  if (start === undefined || length === undefined) return undefined;
  return decodeUtf8(ctx.symbolPool, start, length);
}
