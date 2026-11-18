import { CompilerContext } from "./context";
import { readArgCount, readArgString } from "./args";
import { emitStringAddr } from "../tables";

// Concatenate only compile-time strings. The result lives in internPool for the
// lifetime of the generated program, so this emits no stack allocation or
// per-call runtime leak.
export function concat(args: number, ctx: CompilerContext): number {
  if (readArgCount(args, ctx) !== 2)
    throw new TypeError("string.concat requires exactly two compile-time string arguments");
  const left = readArgString(args, 0, ctx);
  const right = readArgString(args, 1, ctx);
  if (left === undefined || right === undefined)
    throw new TypeError("string.concat arguments must be compile-time strings");

  const result = left + right;
  emitStringAddr(0, result, ctx);
  return 0;
}
