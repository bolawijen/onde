import { CompilerContext } from "../internals/context";
import { plugin } from "../plugin";
import { emitMmap } from "../syscall";
import { ARG_NUMBER, readArgCount, readArgKind, readArgNumber } from "../internals/args";
import { MAX_MMAP_SIZE } from "../syscall";

// Bun.mmap(size) — the Bun global namespace. Registered under both its module
// specifier ("bun") and the global name user code calls it through ("Bun").
const REG_RAX = 0;
const PAGE_SIZE = 4096;

export function mmap(argList: number, ctx: CompilerContext): number {
  const count = readArgCount(argList, ctx);
  if (count === undefined || count > 1) throw new TypeError("Bun.mmap accepts at most one size argument");
  const kind = readArgKind(argList, 0, ctx);
  if (count === 1 && kind !== ARG_NUMBER)
    throw new TypeError("Bun.mmap size must be a numeric literal");
  const requestedSize = count === 1 ? readArgNumber(argList, 0, ctx) : PAGE_SIZE;
  if (requestedSize === undefined || !Number.isSafeInteger(requestedSize) || requestedSize < 0 || requestedSize > MAX_MMAP_SIZE)
    throw new RangeError(`Bun.mmap size must be an integer in [0, ${MAX_MMAP_SIZE}]`);
  const size = requestedSize === 0 ? PAGE_SIZE : requestedSize;
  emitMmap(size, REG_RAX, ctx);
  return REG_RAX;
}

const members = { mmap };

plugin({
  name: "bun",
  setup(build) {
    build.module("bun", "object", members);
    build.module("Bun", "object", members);
  },
});
