import { test, expect } from "bun:test";
import * as type from "../../src/internals/type";

// ─── Primitives
test("type data: primitives keep ids equal to their kind", () => {
  const t = type.create();

  expect(type.kindOf(t, type.TypeKind.Unknown)).toBe(type.TypeKind.Unknown);
  expect(type.kindOf(t, type.TypeKind.Number)).toBe(type.TypeKind.Number);
  expect(type.kindOf(t, type.TypeKind.String)).toBe(type.TypeKind.String);

  expect(type.isPrimitive(type.TypeKind.String)).toBe(true);
  expect(type.isPrimitive(type.TypeKind.Array)).toBe(false);
});

test("type data: boolean is a primitive", () => {
  const t = type.create();
  expect(type.kindOf(t, type.TypeKind.Boolean)).toBe(type.TypeKind.Boolean);
  expect(type.isPrimitive(type.TypeKind.Boolean)).toBe(true);
});

test("type data: undefined is a primitive", () => {
  const t = type.create();
  expect(type.kindOf(t, type.TypeKind.Undefined)).toBe(type.TypeKind.Undefined);
  expect(type.isPrimitive(type.TypeKind.Undefined)).toBe(true);
});

// ─── Array
test("type data: array type references its element type", () => {
  const t = type.create();
  const nums = type.arrayOf(t, type.TypeKind.Number);

  expect(type.kindOf(t, nums)).toBe(type.TypeKind.Array);
  expect(type.elementOf(t, nums)).toBe(type.TypeKind.Number);
});

test("type data: nested arrays retain the inner array id", () => {
  const t = type.create();
  const inner = type.arrayOf(t, type.TypeKind.String);
  const outer = type.arrayOf(t, inner);

  expect(type.elementOf(t, outer)).toBe(inner);
  expect(type.elementOf(t, type.elementOf(t, outer))).toBe(type.TypeKind.String);
});

// ─── Object
test("type data: object type slices its parallel prop arrays", () => {
  const t = type.create();
  const a = type.objectOf(t, [100, 101], [type.TypeKind.String, type.TypeKind.Number]);
  const b = type.objectOf(t, [102], [a]);

  expect(type.kindOf(t, a)).toBe(type.TypeKind.Object);
  expect(type.propCount(t, a)).toBe(2);
  expect(type.propNameOf(t, a, 0)).toBe(100);
  expect(type.propTypeOf(t, a, 0)).toBe(type.TypeKind.String);
  expect(type.propNameOf(t, a, 1)).toBe(101);
  expect(type.propTypeOf(t, a, 1)).toBe(type.TypeKind.Number);

  // second object starts after the first object's props
  expect(type.propCount(t, b)).toBe(1);
  expect(type.propNameOf(t, b, 0)).toBe(102);
  expect(type.propTypeOf(t, b, 0)).toBe(a);
});

test("type data: empty object has no property entries", () => {
  const t = type.create();
  const obj = type.objectOf(t, [], []);

  expect(type.kindOf(t, obj)).toBe(type.TypeKind.Object);
  expect(type.propCount(t, obj)).toBe(0);
});

// ─── Function
test("type data: function type stores params and return", () => {
  const t = type.create();
  const fn = type.funcOf(t, [type.TypeKind.String, type.TypeKind.Number], type.TypeKind.Void);

  expect(type.kindOf(t, fn)).toBe(type.TypeKind.Function);
  expect(type.paramCount(t, fn)).toBe(2);
  expect(type.paramTypeOf(t, fn, 0)).toBe(type.TypeKind.String);
  expect(type.paramTypeOf(t, fn, 1)).toBe(type.TypeKind.Number);
  expect(type.returnOf(t, fn)).toBe(type.TypeKind.Void);
});

test("type data: zero-parameter function stores its return type", () => {
  const t = type.create();
  const fn = type.funcOf(t, [], type.TypeKind.Number);

  expect(type.paramCount(t, fn)).toBe(0);
  expect(type.returnOf(t, fn)).toBe(type.TypeKind.Number);
});

// ─── Layout
test("type data: ids stay index-aligned across parallel arrays", () => {
  const t = type.create();
  const arr = type.arrayOf(t, type.TypeKind.Number);
  const obj = type.objectOf(t, [7], [arr]);

  expect(arr).toBe(type.PRIMITIVE_COUNT);
  expect(obj).toBe(arr + 1);
  expect(t.kinds.length).toBe(obj + 1);
  expect(t.elemTypes.length).toBe(obj + 1);
  expect(t.propStarts.length).toBe(obj + 1);
  expect(t.retTypes.length).toBe(obj + 1);
});
