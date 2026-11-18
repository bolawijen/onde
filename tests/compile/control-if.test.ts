import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";

// ─── End-to-End: branch selection
test("if: then branch taken when condition holds", async () => {
  const src = `
    const x = 3;
    if (x < 5) {
      console.log("then");
    } else {
      console.log("else");
    }
  `;
  const out = await compile(src, "tests/bin/test_if_then");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("then");
});

test("if: else branch taken when condition fails", async () => {
  const src = `
    const x = 10;
    if (x < 5) {
      console.log("then");
    } else {
      console.log("else");
    }
  `;
  const out = await compile(src, "tests/bin/test_if_else");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("else");
});

test("if: if without else skips the body", async () => {
  const src = `
    const x = 10;
    if (x < 5) {
      console.log("body");
    }
    console.log("after");
  `;
  const out = await compile(src, "tests/bin/test_if_noelse");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("after");
});

test("if: immediate on the left is normalised", async () => {
  const src = `
    const x = 3;
    if (5 > x) {
      console.log("yes");
    }
  `;
  const out = await compile(src, "tests/bin/test_if_immlhs");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("yes");
});

test("if: equality selects the then branch", async () => {
  const src = `let value = 7; if (value == 7) console.log("equal");`;
  const out = await compile(src, "tests/bin/test_if_equal");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("equal");
});

test("if: inequality skips the then branch", async () => {
  const src = `let value = 7; if (value != 7) console.log("wrong"); else console.log("equal");`;
  const out = await compile(src, "tests/bin/test_if_not_equal");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("equal");
});

test("if: nested branches select the inner else", async () => {
  const src = `
    let value = 2;
    if (value > 0) {
      if (value > 3) console.log("large");
      else console.log("small");
    }
  `;
  const out = await compile(src, "tests/bin/test_if_nested");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("small");
});

// ─── Bytecode structure
test("if: emits cmp followed by a conditional jump", async () => {
  const src = `
    const x = 3;
    if (x < 5) {
      console.log("hi");
    }
  `;
  const bin = await compile(src, "tests/bin/test_if_bytes");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // cmp r12, imm32  -> [0x49, 0x81, 0xfc, 5, 0, 0, 0]
  expect(bytes.indexOf(Buffer.from([0x49, 0x81, 0xfc, 5, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
  // jge rel32       -> [0x0f, 0x8d, .., .., .., ..]
  const cmp = bytes.indexOf(Buffer.from([0x49, 0x81, 0xfc, 5, 0, 0, 0]));
  expect(bytes[cmp + 7]).toBe(0x0f);
  expect(bytes[cmp + 8]).toBe(0x8d);
});
