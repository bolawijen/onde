import { test, expect } from "bun:test";
import { compile, parse } from "../harness";
import { rmSync } from "fs";

test("object: literal property can be read", async () => {
  const out = await compile(`const point = { x: 7, y: 12 }; if (point.x == 7) console.log("read");`, "tests/bin/test_object_read");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("read");
});

test("object: a property can be reassigned", async () => {
  const out = await compile(`let point = { x: 1 }; point.x = 9; if (point.x == 9) console.log("write");`, "tests/bin/test_object_write");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("write");
});

test("object: properties initialize from variables", async () => {
  const out = await compile(`let value = 6; let point = { x: value }; if (point.x == 6) console.log("variable");`, "tests/bin/test_object_variable_init");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("variable");
});

test("object: object literal slots do not expose array length", async () => {
  const out = await compile(`let point = { x: 6 }; if (point.length == 0) console.log("length");`, "tests/bin/test_object_no_array_length");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("");
});

test("object: string constants are emitted into the intern pool", () => {
  const ctx = parse(`let record = { name: "alpha" };`);
  const pool = Buffer.from(ctx.internPool.bytes());
  expect(pool.indexOf(Buffer.from([...'alpha'].map((char) => char.charCodeAt(0)).concat(0)))).toBeGreaterThanOrEqual(0);
});
