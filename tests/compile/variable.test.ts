import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";
import { writeVar, readVar } from "../../src/zimmerframe";
import { CompilerContext } from "../../src/types";

// ─── Unit: writeVar
test("writeVar: allocates register slots in internPool", () => {
  const ctx: CompilerContext = {
    instructs: [],
    internPool: [],
    patchOffsets: [],
    patchIndexes: [],
    codeLength: 0,
    imports: {},
    exitCall: false,
  };

  const reg1 = writeVar(ctx, "a");
  const reg2 = writeVar(ctx, "b");

  expect(reg1).toBe(12); // r12
  expect(reg2).toBe(13); // r13
  expect(ctx.internPool).toEqual(["a", "b"]);
});

// ─── Unit: readVar
test("readVar: resolves registered register slots", () => {
  const ctx: CompilerContext = {
    instructs: [],
    internPool: ["foo", "bar"],
    patchOffsets: [],
    patchIndexes: [],
    codeLength: 0,
    imports: {},
    exitCall: false,
  };

  expect(readVar(ctx, "foo")).toBe(12); // r12
  expect(readVar(ctx, "bar")).toBe(13); // r13
  expect(readVar(ctx, "unknown")).toBeUndefined();
});

// ─── End-to-End: Variable Declaration / Assignment
test("variable declaration: const x = 42 emits mov r12d, 42", async () => {
  const src = `const x = 42;`;
  const bin = await compile(src, "tests/bin/test_write_var");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // 0x41, 0xbc (mov r12d, 42) -> [0x41, 0xbc, 42, 0, 0, 0]
  const pattern = Buffer.from([0x41, 0xbc, 42, 0, 0, 0]);
  expect(bytes.indexOf(pattern)).toBeGreaterThanOrEqual(0x78);
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
  expect(bytes.indexOf(pattern)).toBeGreaterThanOrEqual(0x78);
});
