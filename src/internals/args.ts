import { CompilerContext } from "./context";
import { readInternText } from "./name";

export const ARG_UNSUPPORTED = 0;
export const ARG_NUMBER = 1;
export const ARG_STRING = 2;
export const ARG_REGISTER = 3;
export const ARG_LIST = 4;

export function writeU32(bytes: CompilerContext["argVals"], index: number, value: number): void {
  if (!Number.isSafeInteger(index) || index < 0)
    throw new RangeError(`u32 index out of range: ${index}`);
  // Signed values are represented as two's-complement; reject values that
  // cannot be represented instead of silently keeping only their low 32 bits.
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0xffffffff)
    throw new RangeError(`u32 value out of range: ${value}`);
  const offset = index * 4;
  if (!Number.isSafeInteger(offset + 3)) throw new RangeError(`u32 offset out of range: ${offset}`);
  while (bytes.length < offset + 4) bytes.push(0);
  bytes.store(offset, value & 0xff);
  bytes.store(offset + 1, (value >>> 8) & 0xff);
  bytes.store(offset + 2, (value >>> 16) & 0xff);
  bytes.store(offset + 3, (value >>> 24) & 0xff);
}

export function readU32(bytes: CompilerContext["argVals"], index: number): number | undefined {
  if (!Number.isSafeInteger(index) || index < 0) return undefined;
  const offset = index * 4;
  if (!Number.isSafeInteger(offset + 3) || bytes.length < offset + 4) return undefined;
  return (bytes.load(offset) | (bytes.load(offset + 1) << 8) |
    (bytes.load(offset + 2) << 16) | (bytes.load(offset + 3) << 24)) >>> 0;
}

export function writeArgList(count: number, ctx: CompilerContext): number {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError(`argument count out of range: ${count}`);
  const id = ctx.callArgStarts.length;
  ctx.callArgStarts.push(ctx.argKinds.length);
  ctx.callArgCounts.push(count);
  for (let i = 0; i < count; i++) {
    ctx.argKinds.push(ARG_UNSUPPORTED);
    writeU32(ctx.argVals, ctx.argKinds.length - 1, 0);
  }
  return id;
}

export function writeArg(list: number, index: number, kind: number, value: number, ctx: CompilerContext): void {
  const count = readArgCount(list, ctx);
  if (count === undefined || !Number.isSafeInteger(index) || index < 0 || index >= count)
    throw new RangeError(`argument index out of range: list=${list}, index=${index}`);
  if (![ARG_NUMBER, ARG_STRING, ARG_REGISTER, ARG_LIST].includes(kind))
    throw new RangeError(`invalid argument kind: ${kind}`);
  if (!Number.isSafeInteger(value)) throw new RangeError(`argument value must be a safe integer: ${value}`);
  if (kind !== ARG_NUMBER && (value < 0 || value > 0xffffffff))
    throw new RangeError(`argument payload out of range: ${value}`);
  if (kind === ARG_STRING && value >= ctx.internStarts.length)
    throw new RangeError(`string argument id out of range: ${value}`);
  if (kind === ARG_REGISTER && value > 15)
    throw new RangeError(`register argument out of range: ${value}`);
  if (kind === ARG_LIST && readArgCount(value, ctx) === undefined)
    throw new RangeError(`argument list id out of range: ${value}`);
  const slot = ctx.callArgStarts[list] + index;
  ctx.argKinds.store(slot, kind);
  if (kind === ARG_NUMBER) {
    // Keep numeric arguments in the full-width number SoA. The U32 lane is
    // only a compact mirror when representable; use a sentinel otherwise.
    ctx.argNumbers[slot] = value;
    writeU32(ctx.argVals, slot,
      Number.isInteger(value) && value >= -0x80000000 && value <= 0xffffffff ? value : 0);
  } else {
    writeU32(ctx.argVals, slot, value);
  }
}

export function readArgCount(list: number, ctx: CompilerContext): number | undefined {
  if (!Number.isSafeInteger(list) || list < 0 || list >= ctx.callArgStarts.length || list >= ctx.callArgCounts.length)
    return undefined;
  const start = ctx.callArgStarts[list], count = ctx.callArgCounts[list];
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0 ||
      start + count > ctx.argKinds.length || (start + count) * 4 > ctx.argVals.length)
    return undefined;
  return count;
}

function argSlot(list: number, index: number, ctx: CompilerContext): number | undefined {
  const count = readArgCount(list, ctx);
  if (count === undefined || !Number.isSafeInteger(index) || index < 0 || index >= count) return undefined;
  return ctx.callArgStarts[list] + index;
}

export function readArgKind(list: number, index: number, ctx: CompilerContext): number | undefined {
  const slot = argSlot(list, index, ctx);
  return slot === undefined ? undefined : ctx.argKinds.load(slot);
}

export function readArgValue(list: number, index: number, ctx: CompilerContext): number | undefined {
  const slot = argSlot(list, index, ctx);
  if (slot === undefined) return undefined;
  const kind = ctx.argKinds.load(slot);
  if (kind === ARG_NUMBER) {
    const value = ctx.argNumbers[slot];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
  if (kind !== ARG_STRING && kind !== ARG_REGISTER && kind !== ARG_LIST) return undefined;
  return readU32(ctx.argVals, slot);
}

export function readArgNumber(list: number, index: number, ctx: CompilerContext): number | undefined {
  const slot = argSlot(list, index, ctx);
  if (slot === undefined || ctx.argKinds.load(slot) !== ARG_NUMBER) return undefined;
  const value = ctx.argNumbers[slot];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readArgString(list: number, index: number, ctx: CompilerContext): string | undefined {
  const value = readArgValue(list, index, ctx);
  if (readArgKind(list, index, ctx) !== ARG_STRING || value === undefined) return undefined;
  return readInternText(value, ctx);
}
