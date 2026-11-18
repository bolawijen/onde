import { test, expect } from "bun:test";
import { parse } from "../harness";
import { bufferLength, bufferSize, getBuffer } from "../../src/tables";

function findBytes(bytes: { length: number; load(index: number): number }, pattern: number[], start = 0): number {
  for (let i = start; i <= bytes.length - pattern.length; i++) {
    let found = true;
    for (let j = 0; j < pattern.length; j++) {
      if (bytes.load(i + j) !== pattern[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

test("array literal: allocates eight bytes per element", () => {
  const ctx = parse(`let values = [7, 12];`);
  const id = getBuffer("values", ctx);
  expect(id).toBeGreaterThanOrEqual(0);
  expect(bufferSize(id, ctx)).toBe(8);
  expect(bufferLength(id, ctx)).toBe(2);
});

test("array read: fixed index emits a 64-bit load", () => {
  const ctx = parse(`let values = [7, 12]; let first = values[0];`);
  expect(findBytes(ctx.instructs, [0x4d, 0x8b, 0x2c, 0x24])).toBeGreaterThanOrEqual(0);
});

test("array write: fixed index emits a 64-bit immediate store", () => {
  const ctx = parse(`let values = [1, 2]; values[1] = 9;`);
  expect(findBytes(ctx.instructs, [0x49, 0xc7, 0x44, 0x24, 0x08, 0x09, 0, 0, 0])).toBeGreaterThanOrEqual(0);
});

test("array indexed access: variable index uses the scaled slot address", () => {
  const ctx = parse(`let values = [3, 4, 5]; let index = 1; let selected = values[index];`);
  expect(findBytes(ctx.instructs, [0x4f, 0x8b, 0x34, 0xd4])).toBeGreaterThanOrEqual(0);
});

test("array length: retains the literal element count", () => {
  const ctx = parse(`let values = [10, 20, 30]; let len = values.length;`);
  const id = getBuffer("values", ctx);
  expect(bufferLength(id, ctx)).toBe(3);
});

test("array initialization: variable values are stored in element slots", () => {
  const ctx = parse(`let value = 6; let values = [value, 2];`);
  expect(findBytes(ctx.instructs, [0x49, 0x89])).toBeGreaterThanOrEqual(0);
});

test("array initialization: 64-bit data value is emitted without narrowing", () => {
  const ctx = parse(`let values = [4294967296];`);
  expect(findBytes(ctx.instructs, [0x48, 0xb8, 0, 0, 0, 0, 1, 0, 0, 0])).toBeGreaterThanOrEqual(0);
  expect(findBytes(ctx.instructs, [0x49, 0x89, 0x04, 0x24])).toBeGreaterThanOrEqual(0);
});

test("array initialization: string constants are emitted into the intern pool", () => {
  const ctx = parse(`let values = ["alpha", "alpha", "beta"];`);
  const alpha = [97, 108, 112, 104, 97, 0];
  const firstAlpha = findBytes(ctx.internPool, alpha);
  expect(firstAlpha).toBeGreaterThanOrEqual(0);
  expect(findBytes(ctx.internPool, [98, 101, 116, 97, 0])).toBeGreaterThanOrEqual(0);
  expect(findBytes(ctx.internPool, alpha, firstAlpha + 1)).toBe(-1);
});
