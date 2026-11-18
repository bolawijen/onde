import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";
import { parse } from "../harness";
import {
  ARG_LIST, ARG_NUMBER, ARG_REGISTER, ARG_STRING, readArgCount, readArgKind,
  readArgNumber, readArgString, readArgValue, readU32, writeArg, writeArgList, writeU32,
} from "../../src/internals/args";
import { appendBytes, appendCString, readIntern, readInternText, utf8ByteLength, writeIntern } from "../../src/internals/name";
import { Bytes } from "../../src/internals/bytes";

// ─── Compile-Time Constant Folding
test("constant folding: binary + folds literals into single .rodata entry", async () => {
  const src = `console.log("hello " + "world");`;
  const bin = await compile(src, "tests/bin/test_cf_binary");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // Folded string "hello world" must exist in .rodata
  expect(bytes.indexOf(Buffer.from("hello world"))).toBeGreaterThanOrEqual(0xb0);
});

test("constant folding: chained binary + expressions", async () => {
  const src = `console.log("foo" + "_" + "bar" + "_" + "baz");`;
  const bin = await compile(src, "tests/bin/test_cf_chain");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // Fully folded chained string must exist as single entry in .rodata
  expect(bytes.indexOf(Buffer.from("foo_bar_baz"))).toBeGreaterThanOrEqual(0xb0);
});

test("constant folding: string variables resolved at compile-time", async () => {
  const src = `
    const prefix = "onde_";
    const suffix = "native";
    console.log(prefix + suffix);
  `;
  const bin = await compile(src, "tests/bin/test_cf_vars");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // Resolved variable concatenation in .rodata
  expect(bytes.indexOf(Buffer.from("onde_native"))).toBeGreaterThanOrEqual(0xb0);
});

test("constant folding: template literal expression", async () => {
  const src = `
    const target = "onde";
    console.log(\`compiled_\${target}\`);
  `;
  const bin = await compile(src, "tests/bin/test_cf_template");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // Template expression folded in .rodata
  expect(bytes.indexOf(Buffer.from("compiled_onde"))).toBeGreaterThanOrEqual(0xb0);
});

// ─── Unit: byte and argument SoA
test("Bytes grows and keeps stored bytes", () => {
  const bytes = new Bytes(2);
  bytes.push(1, 2, 3);
  bytes.store(1, 9);

  expect(bytes.length).toBe(3);
  expect([...bytes.bytes()]).toEqual([1, 9, 3]);
  expect(bytes.load(2)).toBe(3);
});

test("Bytes.push rejects values that would silently truncate", () => {
  const bytes = new Bytes(2);
  expect(() => bytes.push(0x100)).toThrow(RangeError);
  expect(bytes.length).toBe(0);
});

test("Bytes.store rejects invalid offsets instead of silently ignoring them", () => {
  const bytes = new Bytes(2);
  bytes.push(0x7f);
  expect(() => bytes.store(0, -1)).toThrow(RangeError);
  expect(() => bytes.store(1, 0)).toThrow(RangeError);
  expect([...bytes.bytes()]).toEqual([0x7f]);
});

test("intern table stores UTF-8 bytes and reads the original Unicode string", () => {
  const ctx = parse(`console.log("Ā😀");`);
  const id = writeIntern("Ā😀", ctx);
  const start = ctx.internStarts[id];
  const length = ctx.internLengths[id];

  expect([...ctx.symbolPool.bytes().slice(start, start + length)]).toEqual([0xc4, 0x80, 0xf0, 0x9f, 0x98, 0x80]);
  expect(readIntern("Ā😀", ctx)).toBe(id);
  expect(readInternText(id, ctx)).toBe("Ā😀");
});

test("string pool helpers distinguish length-delimited bytes from C strings", () => {
  const pool = new Bytes();
  const raw = appendBytes("raw", pool);
  const cstr = appendCString("path", pool);
  expect(raw).toBe(0);
  expect(cstr).toBe(3);
  expect([...pool.bytes()]).toEqual([0x72, 0x61, 0x77, 0x70, 0x61, 0x74, 0x68, 0]);
});

test("UTF-8 byte length matches encoded supplementary and replacement characters", () => {
  expect(utf8ByteLength("Ā😀\ud800")).toBe(2 + 4 + 3);
});

test("U32 values use four little-endian bytes per slot", () => {
  const bytes = new Bytes();
  writeU32(bytes, 0, 0x12345678);
  writeU32(bytes, 1, -1);

  expect([...bytes.bytes()]).toEqual([0x78, 0x56, 0x34, 0x12, 0xff, 0xff, 0xff, 0xff]);
  expect(readU32(bytes, 0)).toBe(0x12345678);
  expect(readU32(bytes, 1)).toBe(0xffffffff);
  expect(readU32(bytes, 2)).toBeUndefined();
});

test("U32 writer rejects values that cannot fit its four-byte field", () => {
  const bytes = new Bytes();
  expect(() => writeU32(bytes, 0, 0x1_0000_0000)).toThrow(RangeError);
  expect(bytes.length).toBe(0);
});

test("literal call arguments are stored as intern ids", () => {
  const ctx = parse('console.log("alpha", 42, -7);');

  expect(ctx.callArgCounts[0]).toBe(3);
  expect(readArgKind(0, 0, ctx)).toBe(ARG_STRING);
  expect(readArgString(0, 0, ctx)).toBe("alpha");
  expect(readArgKind(0, 1, ctx)).toBe(ARG_NUMBER);
  expect(readArgValue(0, 1, ctx)).toBe(42);
  expect(readArgKind(0, 2, ctx)).toBe(ARG_NUMBER);
  expect(readArgValue(0, 2, ctx)).toBe(-7);
});

test("numeric call argument keeps its full value beyond the U32 mirror", () => {
  const ctx = parse("console.log(4294967296);");
  expect(readArgValue(0, 0, ctx)).toBe(4294967296);
});

test("compile-time string variable passes its existing intern id", () => {
  const ctx = parse('const message = "hello"; console.log(message);');
  const messageId = readIntern("message", ctx);
  const helloId = readIntern("hello", ctx);

  expect(readU32(ctx.stringVals, messageId)).toBe(helloId + 1);
  expect(readArgKind(0, 0, ctx)).toBe(ARG_STRING);
  expect(readArgValue(0, 0, ctx)).toBe(helloId);
  expect(readArgString(0, 0, ctx)).toBe("hello");
});

test("folded template argument is interned once as a string id", () => {
  const ctx = parse('const target = "onde"; console.log(`compiled_${target}`);');
  const resultId = readIntern("compiled_onde", ctx);

  expect(resultId).not.toBe(-1);
  expect(readArgKind(0, 0, ctx)).toBe(ARG_STRING);
  expect(readArgValue(0, 0, ctx)).toBe(resultId);
  expect(readInternText(resultId, ctx)).toBe("compiled_onde");
});

test("nested array call arguments use a child SoA list", () => {
  const ctx = parse('import { writevSync } from "fs"; writevSync(1, ["a", "b"]);');
  const child = readArgValue(0, 1, ctx);

  expect(readArgKind(0, 1, ctx)).toBe(ARG_LIST);
  expect(ctx.callArgCounts[child]).toBe(2);
  expect(readArgString(child, 0, ctx)).toBe("a");
  expect(readArgString(child, 1, ctx)).toBe("b");
});

test("numeric variable call arguments carry a register id", () => {
  const ctx = parse("console.log(42);");
  const list = writeArgList(1, ctx);
  writeArg(list, 0, ARG_REGISTER, 12, ctx);
  expect(readArgKind(list, 0, ctx)).toBe(ARG_REGISTER);
  expect(readArgValue(list, 0, ctx)).toBe(12);
});

test("argument readers return undefined for out-of-range list and argument indexes", () => {
  const ctx = parse('console.log("x");');
  expect(readArgCount(-1, ctx)).toBeUndefined();
  expect(readArgCount(ctx.callArgCounts.length, ctx)).toBeUndefined();
  expect(readArgKind(0, -1, ctx)).toBeUndefined();
  expect(readArgValue(0, 1, ctx)).toBeUndefined();
  expect(readArgNumber(0, 0, ctx)).toBeUndefined();
  expect(readArgString(0, 1, ctx)).toBeUndefined();
});

test("argument readers return undefined when the requested type does not match", () => {
  const ctx = parse('console.log("x", 7);');
  expect(readArgNumber(0, 0, ctx)).toBeUndefined();
  expect(readArgString(0, 1, ctx)).toBeUndefined();
});

test("argument count rejects corrupt parallel list metadata", () => {
  const ctx = parse('console.log("x");');
  ctx.callArgCounts[0] = 2;
  expect(readArgCount(0, ctx)).toBeUndefined();
});

test("writeArg rejects invalid payloads without partially changing the slot", () => {
  const ctx = parse("console.log(1);");
  expect(() => writeArg(0, 0, ARG_STRING, 0xffffffff, ctx)).toThrow(RangeError);
  expect(readArgKind(0, 0, ctx)).toBe(ARG_NUMBER);
  expect(readArgValue(0, 0, ctx)).toBe(1);
});
