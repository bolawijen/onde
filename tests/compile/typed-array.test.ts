import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";

// ─── Bytecode structure
test("typed array: `new Uint8Array(n)` lowers to mmap and parks the base in a register", async () => {
  const bin = await compile(`let buf = new Uint8Array(8);`, "tests/bin/test_ta_alloc");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // mmap syscall ... mov r12, rax
  expect(bytes.indexOf(Buffer.from([0x0f, 0x05]))).toBeGreaterThanOrEqual(0xb0);
  expect(bytes.indexOf(Buffer.from([0x49, 0x89, 0xc4]))).toBeGreaterThanOrEqual(0xb0);
});

test("typed array: `buf[0] = 42` emits a byte store [r12+0], 42", async () => {
  const bin = await compile(`let buf = new Uint8Array(8);\nbuf[0] = 42;`, "tests/bin/test_ta_store");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // mov byte [r12+0], 42  (rex 41 / c6 / modrm 04 / sib 24 / imm 2a)
  expect(bytes.indexOf(Buffer.from([0x41, 0xc6, 0x04, 0x24, 0x2a]))).toBeGreaterThanOrEqual(0xb0);
});

// ─── End-to-End
test("typed array: an element round-trips through memory", async () => {
  const src = `
    let buf = new Uint8Array(8);
    buf[0] = 42;
    if (buf[0] == 42) console.log("ok");
  `;
  const out = await compile(src, "tests/bin/test_ta_roundtrip");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("ok");
});

test("typed array: `.length` reports the element count", async () => {
  const src = `
    let buf = new Uint8Array(8);
    let n = buf.length;
    if (n == 8) console.log("len");
  `;
  const out = await compile(src, "tests/bin/test_ta_length");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("len");
});

test("typed array: 16/32-bit widths round-trip", async () => {
  // All buffers are declared before the first log, so each keeps its own slot.
  const src = `
    let u16 = new Uint16Array(4);
    u16[2] = 1000;
    let u32 = new Uint32Array(4);
    u32[3] = 70000;
    let a = u16[2];
    let b = u32[3];
    if (a == 1000) console.log("u16");
    if (b == 70000) console.log("u32");
  `;
  const out = await compile(src, "tests/bin/test_ta_widths");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("u16\nu32");
});

test("typed array: a signed element keeps its sign", async () => {
  const src = `
    let i16 = new Int16Array(4);
    i16[0] = -3;
    let back = i16[0] + 3;
    if (back == 0) console.log("neg");
  `;
  const out = await compile(src, "tests/bin/test_ta_signed");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("neg");
});

test("typed array: a runtime index selects the element", async () => {
  const src = `
    let u16 = new Uint16Array(4);
    let i = 2;
    u16[i] = 9;
    let dyn = u16[i];
    if (dyn == 9) console.log("dyn");
  `;
  const out = await compile(src, "tests/bin/test_ta_indexed");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("dyn");
});

test("typed array: Int8Array sign-extends a negative element", async () => {
  const src = `
    let values = new Int8Array(2);
    values[0] = -5;
    let result = values[0] + 5;
    if (result == 0) console.log("signed");
  `;
  const out = await compile(src, "tests/bin/test_ta_int8");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("signed");
});

test("typed array: Uint64Array stores and loads a value", async () => {
  const src = `
    let values = new Uint64Array(2);
    values[1] = 1234;
    if (values[1] == 1234) console.log("wide");
  `;
  const out = await compile(src, "tests/bin/test_ta_uint64");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("wide");
});
