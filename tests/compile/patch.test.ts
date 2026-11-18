import { test, expect } from "bun:test";
import { parse } from "../harness";
import { validatePatches } from "../../src/internals/patch";

test("patch table accepts valid code offsets and data indexes", () => {
  const ctx = parse('console.log("x");');
  expect(() => validatePatches(ctx, 0x400000)).not.toThrow();
});

test("patch table rejects mismatched offset and index arrays", () => {
  const ctx = parse('console.log("x");');
  ctx.patchIndexes.pop();
  expect(() => validatePatches(ctx, 0x400000)).toThrow(RangeError);
});

test("patch table rejects offsets outside emitted instructions", () => {
  const ctx = parse('console.log("x");');
  ctx.patchOffsets.push(ctx.instructs.length - 3);
  ctx.patchIndexes.push(0);
  ctx.patchKinds.push(0);
  expect(() => validatePatches(ctx, 0x400000)).toThrow(RangeError);
});

test("patch table rejects indexes outside internPool", () => {
  const ctx = parse('console.log("x");');
  ctx.patchIndexes[0] = ctx.internPool.length;
  expect(() => validatePatches(ctx, 0x400000)).toThrow(RangeError);
});

test("patch table rejects addresses that do not fit imm32", () => {
  const ctx = parse('console.log("x");');
  expect(() => validatePatches(ctx, 0x1_0000_0000)).toThrow(RangeError);
});
