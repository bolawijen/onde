import * as ts from "typescript";
import { CompilerContext } from "./internals/context";
import { appendCString, readIntern, readInternText, writeIntern } from "./internals/name";
import { readU32, writeU32 } from "./internals/args";
import { readNameId, writeNameId } from "./name";
import { emitMmap } from "./syscall";
import { emitMovPatch } from "./internals/patch";

// ─── string constants ────────────────────────────────────────────────────
export function evalString(expr: ts.Expression, ctx: CompilerContext): string | null {
  switch (expr.kind) {
    case ts.SyntaxKind.StringLiteral:
      return (expr as ts.StringLiteral).text;

    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return (expr as ts.NoSubstitutionTemplateLiteral).text;

    case ts.SyntaxKind.Identifier: {
      const name = (expr as ts.Identifier).text;
      const nameId = readIntern(name, ctx);
      const valueId = nameId === -1 ? undefined : readU32(ctx.stringVals, nameId);
      return valueId === undefined || valueId === 0 ? null : readInternText(valueId - 1, ctx) ?? null;
    }

    case ts.SyntaxKind.BinaryExpression: {
      const be = expr as ts.BinaryExpression;
      if (be.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = evalString(be.left, ctx);
        const right = evalString(be.right, ctx);
        if (left !== null && right !== null) {
          return left + right;
        }
      }
      return null;
    }

    case ts.SyntaxKind.TemplateExpression: {
      const te = expr as ts.TemplateExpression;
      let result = te.head.text;
      for (const span of te.templateSpans) {
        const val = evalString(span.expression, ctx);
        if (val === null) return null;
        result += val + span.literal.text;
      }
      return result;
    }

    default:
      return null;
  }
}

// ─── typed arrays (byte buffers) ─────────────────────────────────────────
// `new Uint8Array(n)` (and friends) lowers to an anonymous mmap; the buffer
// variable's register holds the base pointer. Element indexing then reads/writes
// straight through the memory operands, using the width from the constructor.
const TYPED_ARRAYS: { [name: string]: { size: number; signed: boolean } } = {
  Uint8Array: { size: 1, signed: false },
  Uint16Array: { size: 2, signed: false },
  Uint32Array: { size: 4, signed: false },
  Uint64Array: { size: 8, signed: false },
  Int8Array: { size: 1, signed: true },
  Int16Array: { size: 2, signed: true },
  Int32Array: { size: 4, signed: true },
};

// Flat arrays indexed by the name's interned id: element width / signedness /
// element count. An id whose element width is unset was never a buffer.
export function getBuffer(name: string, ctx: CompilerContext): number {
  const id = readIntern(name, ctx);
  return id === -1 || ctx.bufferSizes[id] === undefined ? -1 : id;
}

function setBuffer(name: string, size: number, signed: boolean, len: number, ctx: CompilerContext): void {
  const id = writeIntern(name, ctx);
  ctx.bufferSizes[id] = size;
  ctx.bufferSigned[id] = signed ? 1 : 0;
  ctx.bufferLengths[id] = len;
}

export function bufferSize(id: number, ctx: CompilerContext): number { return ctx.bufferSizes[id]; }
export function bufferSigned(id: number, ctx: CompilerContext): boolean { return ctx.bufferSigned[id] === 1; }
export function bufferLength(id: number, ctx: CompilerContext): number { return ctx.bufferLengths[id]; }

// Fold a literal (or negated literal) to a number.
export function numericLiteral(expr: ts.Expression | undefined): number | undefined {
  if (!expr) return undefined;
  if (expr.kind === ts.SyntaxKind.NumericLiteral) return Number((expr as ts.NumericLiteral).text);
  if (expr.kind === ts.SyntaxKind.PrefixUnaryExpression) {
    const ue = expr as ts.PrefixUnaryExpression;
    if (ue.operator === ts.SyntaxKind.MinusToken && ue.operand.kind === ts.SyntaxKind.NumericLiteral)
      return -Number((ue.operand as ts.NumericLiteral).text);
  }
  return undefined;
}

// `new Uint8Array(count)` -> mmap(count * width); bind the pointer to `name`.
export function allocTypedArray(name: string, newExpr: ts.NewExpression, ctx: CompilerContext): boolean {
  const callee = newExpr.expression;
  if (callee.kind !== ts.SyntaxKind.Identifier) return false;
  const spec = TYPED_ARRAYS[(callee as ts.Identifier).text];
  if (!spec) return false;

  const count = numericLiteral(newExpr.arguments?.[0]);
  if (count === undefined) return false;

  const reg = writeNameId(writeIntern(name, ctx), ctx);
  if (reg === undefined) return false;

  emitMmap(Math.max(1, count * spec.size), reg, ctx);
  setBuffer(name, spec.size, spec.signed, count, ctx);
  return true;
}

// `let values = [..]` uses the same indexed-memory representation as typed
// arrays, with one 64-bit slot per element.
export function allocArray(name: string, len: number, ctx: CompilerContext): number | undefined {
  const reg = writeNameId(writeIntern(name, ctx), ctx);
  if (reg === undefined) return undefined;
  emitMmap(Math.max(8, len * 8), reg, ctx);
  setBuffer(name, 8, false, len, ctx);
  return reg;
}

// Object literals currently store property values in fixed 64-bit slots; the
// parallel name table maps each property name to its slot without runtime keys.
export function allocObject(name: string, propertyNames: number[], ctx: CompilerContext): number | undefined {
  const reg = writeNameId(writeIntern(name, ctx), ctx);
  if (reg === undefined) return undefined;
  emitMmap(Math.max(8, propertyNames.length * 8), reg, ctx);
  const id = writeIntern(name, ctx);
  ctx.objectPropStarts[id] = ctx.objectPropNames.length;
  ctx.objectPropCounts[id] = propertyNames.length;
  for (const property of propertyNames) ctx.objectPropNames.push(property);
  return reg;
}

export function objectPropertyOffset(name: string, property: string, ctx: CompilerContext): number {
  const id = readIntern(name, ctx);
  const start = id === -1 ? undefined : ctx.objectPropStarts[id];
  const count = id === -1 ? undefined : ctx.objectPropCounts[id];
  if (start === undefined || count === undefined) return -1;
  const propertyId = readIntern(property, ctx);
  for (let i = 0; i < count; i++)
    if (ctx.objectPropNames[start + i] === propertyId) return i * 8;
  return -1;
}

// Append a byte string to the data segment and return its start offset.
function internBytes(bytes: string, ctx: CompilerContext): number {
  const id = writeIntern(bytes, ctx);
  let offset = ctx.dataOffsets[id];
  if (offset === undefined) {
    offset = appendCString(bytes, ctx.internPool);
    ctx.dataOffsets[id] = offset;
  }
  return offset;
}

// Materialise the runtime address of the data at `index` into `reg` via
// mov imm32 + a deferred patch (absolute, non-PIE).
export function emitDataAddr(reg: number, index: number, ctx: CompilerContext): void {
  emitMovPatch(reg, index, ctx);
}

// Intern a string literal's bytes and materialise its address into `reg`.
export function emitStringAddr(reg: number, text: string, ctx: CompilerContext): void {
  emitDataAddr(reg, internBytes(text, ctx), ctx);
}

// ─── Blob ────────────────────────────────────────────────────────────────
// Minimal Blob: `new Blob([...strings])` interns the concatenated bytes into the
// data segment and points the variable's register at them. `.size` folds to the
// byte count; `.text()` / `.bytes()` hand back the data pointer. Blob members we
// do not accommodate yet (slice / stream / ...) emit a no-op instead of failing.
// Flat arrays indexed by the name's interned id: byte length / data offset /
// MIME-type offset (-1 when none). An id whose length is unset was never a blob.
export function getBlob(name: string, ctx: CompilerContext): number {
  const id = readIntern(name, ctx);
  return id === -1 || ctx.blobLengths[id] === undefined ? -1 : id;
}

function setBlob(name: string, len: number, offset: number, type: number, ctx: CompilerContext): void {
  const id = writeIntern(name, ctx);
  ctx.blobLengths[id] = len;
  ctx.blobOffsets[id] = offset;
  ctx.blobTypes[id] = type;
}

export function blobLength(id: number, ctx: CompilerContext): number { return ctx.blobLengths[id]; }
export function blobOffset(id: number, ctx: CompilerContext): number { return ctx.blobOffsets[id]; }
export function blobType(id: number, ctx: CompilerContext): number { return ctx.blobTypes[id]; }

// `new Blob([...strings][, { type }])` -> intern the bytes; bind the pointer to
// `name`. Parts must fold to compile-time strings.
export function allocBlob(name: string, newExpr: ts.NewExpression, ctx: CompilerContext): boolean {
  const callee = newExpr.expression;
  if (callee.kind !== ts.SyntaxKind.Identifier || (callee as ts.Identifier).text !== "Blob") return false;

  const args = newExpr.arguments;
  let data = "";
  const parts = args?.[0];
  if (parts) {
    if (parts.kind !== ts.SyntaxKind.ArrayLiteralExpression) return false;
    for (const el of (parts as ts.ArrayLiteralExpression).elements) {
      const s = evalString(el, ctx);
      if (s === null) return false;
      data += s;
    }
  }

  let type = -1;
  const opts = args?.[1];
  if (opts && opts.kind === ts.SyntaxKind.ObjectLiteralExpression) {
    for (const prop of (opts as ts.ObjectLiteralExpression).properties) {
      if (prop.kind !== ts.SyntaxKind.PropertyAssignment) continue;
      if ((prop.name as ts.Identifier).text !== "type") continue;
      const s = evalString((prop as ts.PropertyAssignment).initializer, ctx);
      if (s !== null) type = internBytes(s, ctx);
      break;
    }
  }

  const reg = writeNameId(writeIntern(name, ctx), ctx);
  if (reg === undefined) return false;

  const offset = internBytes(data, ctx);
  emitDataAddr(reg, offset, ctx);
  setBlob(name, data.length, offset, type, ctx);
  return true;
}

// Blob member calls. `.text()` / `.bytes()` / `.arrayBuffer()` hand back the data
// pointer; members not accommodated yet (slice / stream / ...) emit nothing.
export function emitBlobCall(name: string, method: string, ctx: CompilerContext): number | undefined {
  switch (method) {
    case "text":
    case "bytes":
    case "arrayBuffer":
      return readNameId(readIntern(name, ctx), ctx);
    default:
      return undefined;
  }
}

// Drop every entry in the compile-time tables. Called once per source file so
// successive compilations in the same process do not see stale bindings. The
// intern pool is left intact: ids stay stable, only the value arrays reset.
export function resetTables(ctx: CompilerContext): void {
  ctx.stringVals.length = 0;
  ctx.bufferSizes.length = 0;
  ctx.bufferSigned.length = 0;
  ctx.bufferLengths.length = 0;
  ctx.objectPropStarts.length = 0;
  ctx.objectPropCounts.length = 0;
  ctx.objectPropNames.length = 0;
  ctx.blobLengths.length = 0;
  ctx.blobOffsets.length = 0;
  ctx.blobTypes.length = 0;
}
