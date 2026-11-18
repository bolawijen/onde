import { CompilerContext } from "../internals/context";
import { plugin } from "../plugin";
import { SYS_WRITE } from "../syscall";
import { ARG_NUMBER, ARG_STRING, readArgCount, readArgKind, readArgString, readArgValue } from "../internals/args";
import { utf8ByteLength, writeUtf8 } from "../internals/name";
import { emitPatchImm32 } from "../internals/patch";

const STDOUT = 0x01;

export function log(argList: number, ctx: CompilerContext): void {
  let length = 0;
  const count = readArgCount(argList, ctx);
  if (count === undefined) return;
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    const kind = readArgKind(argList, i, ctx);
    if (kind !== ARG_STRING && kind !== ARG_NUMBER)
      throw new TypeError(`console.log argument ${i} must be a compile-time string or number`);
    const value = readArgValue(argList, i, ctx);
    const text = kind === ARG_STRING ? readArgString(argList, i, ctx) : String(value);
    if (text === undefined) throw new TypeError(`console.log argument ${i} has an invalid string id`);
    texts.push(text);
    length += utf8ByteLength(text) + 1;
    if (!Number.isSafeInteger(length) || length > 0xffffffff) return;
  }
  const index = ctx.internPool.length;
  if (count === 0) {
    ctx.internPool.push(0x0a);
    length = 1;
  }
  for (const text of texts) {
    writeUtf8(text, ctx.internPool);
    ctx.internPool.push(0x20)
  }

  // overwrite last whitespace
  if (count) ctx.internPool.store(ctx.internPool.length - 1, 0x0a);
  ctx.instructs.push(
    0xb8, SYS_WRITE, 0x00, 0x00, 0x00,
    0xbf, STDOUT, 0x00, 0x00, 0x00,
    0xbe,
  );
  emitPatchImm32(ctx, index);
  ctx.instructs.push(
    0xba, length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >> 24) & 0xff,
    0x0f, 0x05,
  )
}

plugin({
  name: "console",
  setup(build) {
    build.module("console", "object", { log });
  },
});
