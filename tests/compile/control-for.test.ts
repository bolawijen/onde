import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";

// ─── End-to-End: iteration
test("for: runs the body while the condition holds", async () => {
  const src = `
    for (let i = 0; i < 3; i++) {
      console.log("x");
    }
  `;
  const out = await compile(src, "tests/bin/test_for_count");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("x\nx\nx");
});

test("for: skips the body when the condition is initially false", async () => {
  const src = `
    for (let i = 5; i < 3; i++) {
      console.log("x");
    }
    console.log("after");
  `;
  const out = await compile(src, "tests/bin/test_for_skip");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("after");
});

test("for: supports i += n as the increment", async () => {
  const src = `
    for (let i = 0; i < 2; i += 1) {
      console.log("y");
    }
  `;
  const out = await compile(src, "tests/bin/test_for_plusassign");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("y\ny");
});

test("for: supports an increment greater than one", async () => {
  const src = `
    let count = 0;
    for (let i = 0; i < 6; i += 2) count += 1;
    if (count == 3) console.log("three");
  `;
  const out = await compile(src, "tests/bin/test_for_step_two");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("three");
});

test("for: equality condition exits after the matching iteration", async () => {
  const src = `
    let count = 0;
    for (let i = 0; i != 3; i++) count += 1;
    if (count == 3) console.log("stopped");
  `;
  const out = await compile(src, "tests/bin/test_for_not_equal");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("stopped");
});

test("for break: exits at the matching iteration", async () => {
  const src = `
    for (let i = 0; i < 5; i++) {
      if (i == 2) break;
      console.log("tick");
    }
    console.log("done");
  `;
  const out = await compile(src, "tests/bin/test_for_break");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("tick\ntick\ndone");
});

test("for continue: runs the incrementor before the next condition", async () => {
  const src = `
    for (let i = 0; i < 3; i++) {
      if (i == 1) continue;
      console.log("body");
    }
    console.log("done");
  `;
  const out = await compile(src, "tests/bin/test_for_continue");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("body\nbody\ndone");
});

test("nested for break: only exits the innermost loop", async () => {
  const src = `
    let count = 0;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 3; j++) {
        if (j == 1) break;
        count += 1;
      }
    }
    if (count == 2) console.log("inner-only");
  `;
  const out = await compile(src, "tests/bin/test_for_nested_break");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("inner-only");
});

// ─── Bytecode structure
test("for: emits a backward jump to the condition", async () => {
  const src = `
    for (let i = 0; i < 3; i++) {
      console.log("hi");
    }
  `;
  const bin = await compile(src, "tests/bin/test_for_bytes");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // add r12, imm32 -> [0x49, 0x81, 0xc4, 1, 0, 0, 0]
  expect(bytes.indexOf(Buffer.from([0x49, 0x81, 0xc4, 1, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);

  // unconditional near jmp -> 0xe9 with a negative (backward) rel32
  const jmp = bytes.indexOf(0xe9, 0xb0);
  expect(jmp).toBeGreaterThanOrEqual(0xb0);
  const rel = bytes.readInt32LE(jmp + 1);
  expect(rel).toBeLessThan(0);
});
