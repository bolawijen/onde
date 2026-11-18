import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";

// ─── for..of ─────────────────────────────────────────────────────────────
test("for..of: unrolls array elements", async () => {
  const src = `for (const s of ["a", "b", "c"]) { console.log(s); }`;
  const out = await compile(src, "tests/bin/test_forof_arr");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("a\nb\nc");
});

test("for..of: unrolls string characters", async () => {
  const src = `for (const c of "hi") { console.log(c); }`;
  const out = await compile(src, "tests/bin/test_forof_str");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("h\ni");
});

test("for..of: numeric elements bind to registers", async () => {
  const src = `for (const n of [1, 2, 3]) { console.log("x"); }`;
  const bin = await compile(src, "tests/bin/test_forof_num");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // mov r12d, imm32 for each element
  expect(bytes.indexOf(Buffer.from([0x41, 0xbc, 1, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
  expect(bytes.indexOf(Buffer.from([0x41, 0xbc, 2, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
  expect(bytes.indexOf(Buffer.from([0x41, 0xbc, 3, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
});

test("for..of break: stops emitting runtime iterations after the break", async () => {
  const src = `
    for (const value of [1, 2, 3]) {
      if (value == 2) break;
      console.log("item");
    }
    console.log("done");
  `;
  const out = await compile(src, "tests/bin/test_forof_break");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("item\ndone");
});

test("for..of continue: skips the rest of the current unrolled iteration", async () => {
  const src = `
    for (const value of [1, 2, 3]) {
      if (value == 2) continue;
      console.log("item");
    }
    console.log("done");
  `;
  const out = await compile(src, "tests/bin/test_forof_continue");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("item\nitem\ndone");
});

// ─── for..in ─────────────────────────────────────────────────────────────
test("for..in: unrolls object keys", async () => {
  const src = `for (const k in { a: 1, b: 2 }) { console.log(k); }`;
  const out = await compile(src, "tests/bin/test_forin_obj");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("a\nb");
});

test("for..in: unrolls array index keys", async () => {
  const src = `for (const i in ["a", "b", "c"]) { console.log(i); }`;
  const out = await compile(src, "tests/bin/test_forin_arr");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("0\n1\n2");
});

test("for..in break: exits the unrolled loop", async () => {
  const src = `
    for (const key in { a: 1, b: 2, c: 3 }) {
      console.log(key);
      break;
    }
    console.log("done");
  `;
  const out = await compile(src, "tests/bin/test_forin_break");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("a\ndone");
});

test("for..in continue: skips only the current unrolled iteration", async () => {
  const src = `
    for (const key in { a: 1, b: 2, c: 3 }) {
      console.log(key);
      continue;
      console.log("unreachable");
    }
  `;
  const out = await compile(src, "tests/bin/test_forin_continue");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("a\nb\nc");
});
