import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";

// ─── Bytecode structure
test("function: prologue saves the variable registers, epilogue restores them", async () => {
  const bin = await compile(
    `function add(a, b) { return a + b; }\nlet x = add(2, 3);`,
    "tests/bin/test_fn_frame",
  );
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // push r12 / r13 / r14 / r15
  const prologue = Buffer.from([0x41, 0x54, 0x41, 0x55, 0x41, 0x56, 0x41, 0x57]);
  expect(bytes.indexOf(prologue)).toBeGreaterThanOrEqual(0xb0);

  // mov r12, rdi  (bind the first parameter)
  expect(bytes.indexOf(Buffer.from([0x49, 0x89, 0xfc]))).toBeGreaterThanOrEqual(0xb0);

  // pop r15 / r14 / r13 / r12 ; ret
  const epilogue = Buffer.from([0x41, 0x5f, 0x41, 0x5e, 0x41, 0x5d, 0x41, 0x5c, 0xc3]);
  expect(bytes.indexOf(epilogue)).toBeGreaterThanOrEqual(0xb0);

  // near call (e8 + rel32)
  expect(bytes.includes(0xe8)).toBe(true);
});

// ─── End-to-End
test("function: call with literal arguments returns through rax", async () => {
  const src = `
    function add(a, b) { return a + b; }
    let x = add(2, 3);
    if (x == 5) console.log("five");
  `;
  const out = await compile(src, "tests/bin/test_fn_add");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("five");
});

test("function: local variables and a call made from inside a function", async () => {
  const src = `
    function double(n) { return n * 2; }
    function quad(n) { let d = double(n); return d * 2; }
    let r = quad(5);
    if (r == 20) console.log("twenty");
  `;
  const out = await compile(src, "tests/bin/test_fn_nested");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("twenty");
});

test("function: recursion terminates and returns the base case", async () => {
  const src = `
    function down(n) { if (n == 0) return; down(n - 1); }
    down(3);
    function one() { return 1; }
    let r = one();
    if (r == 1) console.log("bottom");
  `;
  const out = await compile(src, "tests/bin/test_fn_recurse");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("bottom");
});

test("function: the caller's variables survive a call", async () => {
  const src = `
    function inc(n) { return n + 1; }
    let x = 7;
    let y = inc(x);
    if (y == 8) console.log("eight");
    if (x == 7) console.log("kept");
  `;
  const out = await compile(src, "tests/bin/test_fn_caller");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("eight\nkept");
});

test("function args: binds four positional arguments", async () => {
  const src = `
    function sum(a, b, c, d) { return a + b + c + d; }
    let result = sum(1, 2, 3, 4);
    if (result == 10) console.log("ten");
  `;
  const out = await compile(src, "tests/bin/test_fn_args_four");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("ten");
});

test("function args: passes a variable as an argument", async () => {
  const src = `
    function inc(value) { return value + 1; }
    let input = 8;
    let result = inc(input);
    if (result == 9) console.log("nine");
  `;
  const out = await compile(src, "tests/bin/test_fn_args_variable");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("nine");
});

test("function args: zero-argument function returns a value", async () => {
  const src = `
    function answer() { return 42; }
    let result = answer();
    if (result == 42) console.log("answer");
  `;
  const out = await compile(src, "tests/bin/test_fn_args_zero");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("answer");
});
