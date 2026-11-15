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

test("console.log + process.exit", async () => {
  const src = `console.log("done"); process.exit(0);`;
  const out = await compile(src, "tests/bin/test-console-4");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("done");
});
