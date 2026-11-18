import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";
import { createContext } from "../../src/internals";
import { emitMovImm } from "../../src/control-flow";

async function run(src: string, name: string): Promise<string> {
  const out = await compile(src, `tests/bin/${name}`);
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  return result;
}

// ─── End-to-End: arithmetic on values
test("arith: adds two constants", async () => {
  const result = await run(`
    let x = 2 + 3;
    if (x == 5) console.log("five");
  `, "test_arith_add");
  expect(result).toBe("five");
});

test("arith: subtracts two variables", async () => {
  const result = await run(`
    let a = 10;
    let b = 4;
    let c = a - b;
    if (c == 6) console.log("six");
  `, "test_arith_sub");
  expect(result).toBe("six");
});

test("arith: multiplies two variables", async () => {
  const result = await run(`
    let a = 6;
    let b = 7;
    let c = a * b;
    if (c == 42) console.log("fortytwo");
  `, "test_arith_mul");
  expect(result).toBe("fortytwo");
});

test("arith: divides two variables", async () => {
  const result = await run(`
    let a = 20;
    let b = 4;
    let c = a / b;
    if (c == 5) console.log("five");
  `, "test_arith_div");
  expect(result).toBe("five");
});

test("arith: takes the remainder of two variables", async () => {
  const result = await run(`
    let a = 17;
    let b = 5;
    let c = a % b;
    if (c == 2) console.log("two");
  `, "test_arith_mod");
  expect(result).toBe("two");
});

test("arith: honours operator precedence in a nested expression", async () => {
  // a + b * 2 == 4 + 6 == 10
  const result = await run(`
    let a = 4;
    let b = 3;
    let c = a + b * 2;
    if (c == 10) console.log("ten");
  `, "test_arith_precedence");
  expect(result).toBe("ten");
});

test("arith: applies compound assignments", async () => {
  // 3 -> +4 = 7 -> *2 = 14 -> -5 = 9
  const result = await run(`
    let x = 3;
    x += 4;
    x *= 2;
    x -= 5;
    if (x == 9) console.log("nine");
  `, "test_arith_compound");
  expect(result).toBe("nine");
});

test("arith: reassigns from an expression", async () => {
  const result = await run(`
    let x = 10;
    x = x + 5;
    if (x == 15) console.log("fifteen");
  `, "test_arith_reassign");
  expect(result).toBe("fifteen");
});

test("arith: negates an operand", async () => {
  // -a + 8 == -3 + 8 == 5
  const result = await run(`
    let a = 3;
    let b = -a + 8;
    if (b == 5) console.log("five");
  `, "test_arith_neg");
  expect(result).toBe("five");
});

test("mov immediate sign-extends a negative value", () => {
  const ctx = createContext();
  emitMovImm(12, -5, ctx);
  expect([...ctx.instructs.bytes()]).toEqual([0x49, 0xbc, 0xfb, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
});

// ─── Bytecode structure
test("mov immediate preserves all bits above 32-bit range", () => {
  const ctx = createContext();
  emitMovImm(12, 0x1_0000_0000, ctx);
  expect([...ctx.instructs.bytes()]).toEqual([0x49, 0xbc, 0, 0, 0, 0, 1, 0, 0, 0]);
});

test("mov immediate rejects integers beyond JavaScript exact precision", () => {
  const ctx = createContext();
  expect(() => emitMovImm(12, Number.MAX_SAFE_INTEGER + 1, ctx)).toThrow(RangeError);
  expect(ctx.instructs.length).toBe(0);
});

test("arith: encodes imul and add-imm", async () => {
  const src = `
    let a = 6;
    let b = 7;
    let c = a * b + 3;
    if (c == 45) console.log("ok");
  `;
  const bin = await compile(src, "tests/bin/test_arith_bytes");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // imul r14, r13 -> [0x4d, 0x0f, 0xaf, 0xf5]
  expect(bytes.indexOf(Buffer.from([0x4d, 0x0f, 0xaf, 0xf5]))).toBeGreaterThanOrEqual(0xb0);

  // add r14, imm32 -> [0x49, 0x81, 0xc6, 3, 0, 0, 0]
  expect(bytes.indexOf(Buffer.from([0x49, 0x81, 0xc6, 3, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
});
