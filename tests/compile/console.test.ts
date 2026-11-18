import { test, expect } from "bun:test";
import { compile } from "../harness";
import { rmSync } from "fs";

test("console.log single", async () => {
  const src = `console.log("hello");`;
  const out = await compile(src, "tests/bin/test-console-1");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("hello");
});

test("console.log multiple", async () => {
  const src = `console.log("a"); console.log("b"); console.log("c");`;
  const out = await compile(src, "tests/bin/test-console-2");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("a\nb\nc");
});

test("console.log with newline", async () => {
  const src = `console.log("halo");`;
  const out = await compile(src, "tests/bin/test-console-3");
  const result = await Bun.$`./${out}`.text();
  rmSync(out, { force: true });
  expect(result).toBe("halo\n");
});

test("console.log without arguments writes one newline", async () => {
  const out = await compile(`console.log();`, "tests/bin/test-console-empty");
  const result = await Bun.$`./${out}`.text();
  rmSync(out, { force: true });
  expect(result).toBe("\n");
});

test("console.log + process.exit", async () => {
  const src = `console.log("done"); process.exit(0);`;
  const out = await compile(src, "tests/bin/test-console-4");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("done");
});

test("implicit exit remains after a statically false process.exit branch", async () => {
  const out = await compile(`let condition = 0; if (condition == 1) process.exit(7); console.log("alive");`, "tests/bin/test-process-exit-false");
  const result = await Bun.$`./${out}`.text();
  rmSync(out, { force: true });
  expect(result).toBe("alive\n");
});

test("console.log preserves characters above one byte", async () => {
  const out = await compile(`console.log("Ā");`, "tests/bin/test-console-unicode-bmp");
  const result = await Bun.$`./${out}`.text();
  rmSync(out, { force: true });
  expect(result).toBe("Ā\n");
});

test("console.log preserves supplementary Unicode characters", async () => {
  const out = await compile(`console.log("😀");`, "tests/bin/test-console-unicode-supplementary");
  const result = await Bun.$`./${out}`.text();
  rmSync(out, { force: true });
  expect(result).toBe("😀\n");
});
