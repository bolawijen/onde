import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";
import { readNameId, writeNameId } from "../../src/name";
import { createContext } from "../../src/internals";
import { readIntern, writeIntern } from "../../src/internals/name";

// ─── Unit: writeNameId
test("writeNameId: stores intern ids in register slots", () => {
  const ctx = createContext();
  const a = writeIntern("a", ctx);
  const b = writeIntern("b", ctx);
  const reg1 = writeNameId(a, ctx);
  const reg2 = writeNameId(b, ctx);
  expect(reg1).toBe(12); // r12
  expect(reg2).toBe(13); // r13
  expect(ctx.vars).toEqual([a, b]);
});

test("writeNameId: repeated name keeps the same register", () => {
  const ctx = createContext();
  const id = writeIntern("value", ctx);

  expect(writeNameId(id, ctx)).toBe(12);
  expect(writeNameId(id, ctx)).toBe(12);
  expect(ctx.vars).toEqual([id]);
});

test("writeNameId: rejects the fifth variable with a clear error", () => {
  const ctx = createContext();
  const ids = ["a", "b", "c", "d", "e"].map((name) => writeIntern(name, ctx));

  expect(ids.slice(0, 4).map((id) => writeNameId(id, ctx))).toEqual([12, 13, 14, 15]);
  expect(() => writeNameId(ids[4], ctx)).toThrow('cannot allocate variable "e": only four variable registers (r12-r15) are supported');
});

test("compile: rejects a fifth variable with a clear error", async () => {
  const { parse } = await import("../harness");
  // This checks the compiler's behavior through the CLI, which currently
  // bubbles the allocator's RangeError as a compile failure.
  const src = "let a = 1; let b = 2; let c = 3; let d = 4; let e = 5;";
  const { writeFileSync, rmSync } = await import("fs");
  const { spawnSync } = await import("child_process");
  const path = `tests/bin/five-vars-${Bun.nanoseconds()}.ts`;
  writeFileSync(path, src);
  try {
    const result = spawnSync("bun", ["src/onde.ts", path, "-o", `${path}.onde`], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Compile error: cannot allocate variable "e": only four variable registers (r12-r15) are supported');
  } finally {
    rmSync(path, { force: true });
    rmSync(`${path}.onde`, { force: true });
  }
});

test("compile: standalone mmap does not consume a variable register", async () => {
  const { parse } = await import("../harness");
  const ctx = parse("Bun.mmap(32);");
  expect(ctx.vars).toHaveLength(0);
});

// ─── Unit: readNameId
test("readNameId: resolves intern ids to register slots", () => {
  const ctx = createContext();
  const foo = writeIntern("foo", ctx);
  const bar = writeIntern("bar", ctx);
  ctx.vars.push(foo, bar);
  expect(readNameId(foo, ctx)).toBe(12); // r12
  expect(readNameId(bar, ctx)).toBe(13); // r13
  expect(readNameId(readIntern("unknown", ctx), ctx)).toBeUndefined();
});

test("readNameId: checks function locals before global slots", () => {
  const ctx = createContext();
  const global = writeIntern("global", ctx);
  const local = writeIntern("local", ctx);
  const other = writeIntern("other", ctx);
  ctx.vars.push(global, local, other);
  ctx.localNames = [local];

  expect(readNameId(local, ctx)).toBe(12);
  expect(readNameId(global, ctx)).toBe(12);
  expect(readNameId(other, ctx)).toBe(14);
});

test("readNameId: negative and unknown ids do not resolve", () => {
  const ctx = createContext();
  expect(readNameId(-1, ctx)).toBeUndefined();
  expect(readNameId(99, ctx)).toBeUndefined();
});

test("writeIntern: repeated names reuse the intern id", () => {
  const ctx = createContext();
  const first = writeIntern("same", ctx);
  const bytesAfterFirst = ctx.symbolPool.length;

  expect(writeIntern("same", ctx)).toBe(first);
  expect(ctx.symbolPool.length).toBe(bytesAfterFirst);
  expect(readIntern("same", ctx)).toBe(first);
});

// ─── End-to-End: Variable Declaration / Assignment
test("variable declaration: const x = 42 emits mov r12d, 42", async () => {
  const src = `const x = 42;`;
  const bin = await compile(src, "tests/bin/test_write_var");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // 0x41, 0xbc (mov r12d, 42) -> [0x41, 0xbc, 42, 0, 0, 0]
  const pattern = Buffer.from([0x41, 0xbc, 42, 0, 0, 0]);
  expect(bytes.indexOf(pattern)).toBeGreaterThanOrEqual(0xb0);
});

// ─── End-to-End: Variable Read / Copy
test("variable read: const y = x emits mov r13, r12", async () => {
  const src = `
    const x = 42;
    const y = x;
  `;
  const bin = await compile(src, "tests/bin/test_read_var");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // mov r13, r12 -> [0x4d, 0x89, 0xe5]
  const pattern = Buffer.from([0x4d, 0x89, 0xe5]);
  expect(bytes.indexOf(pattern)).toBeGreaterThanOrEqual(0xb0);
});
