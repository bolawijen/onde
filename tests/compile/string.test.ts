import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";

// ─── Compile-Time Constant Folding
test("constant folding: binary + folds literals into single .rodata entry", async () => {
  const src = `console.log("hello " + "world");`;
  const bin = await compile(src, "tests/bin/test_cf_binary");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // Folded string "hello world" must exist in .rodata
  expect(bytes.indexOf(Buffer.from("hello world"))).toBeGreaterThanOrEqual(0x78);
});

test("constant folding: chained binary + expressions", async () => {
  const src = `console.log("foo" + "_" + "bar" + "_" + "baz");`;
  const bin = await compile(src, "tests/bin/test_cf_chain");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // Fully folded chained string must exist as single entry in .rodata
  expect(bytes.indexOf(Buffer.from("foo_bar_baz"))).toBeGreaterThanOrEqual(0x78);
});

test("constant folding: string variables resolved at compile-time", async () => {
  const src = `
    const prefix = "onde_";
    const suffix = "native";
    console.log(prefix + suffix);
  `;
  const bin = await compile(src, "tests/bin/test_cf_vars");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // Resolved variable concatenation in .rodata
  expect(bytes.indexOf(Buffer.from("onde_native"))).toBeGreaterThanOrEqual(0x78);
});

test("constant folding: template literal expression", async () => {
  const src = `
    const target = "onde";
    console.log(\`compiled_\${target}\`);
  `;
  const bin = await compile(src, "tests/bin/test_cf_template");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // Template expression folded in .rodata
  expect(bytes.indexOf(Buffer.from("compiled_onde"))).toBeGreaterThanOrEqual(0x78);
});

// ─── Granular: Runtime Concat Bytecode Structure
test("runtime concat: bytecode emits sub rsp, 256 and rep movsb", async () => {
  const src = `
    import { concat } from "string";
    concat("partA", "partB");
  `;
  const bin = await compile(src, "tests/bin/test_rt_concat_bytes");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // sub rsp, 256 = 48 81 ec 00 01 00 00 (64-byte aligned stack frame)
  expect(bytes.indexOf(Buffer.from([0x48, 0x81, 0xec, 0x00, 0x01, 0x00, 0x00]))).toBeGreaterThanOrEqual(0x78);
  // cld = fc
  expect(bytes.indexOf(Buffer.from([0xfc]))).toBeGreaterThanOrEqual(0x78);
  // rep movsb = f3 a4
  expect(bytes.indexOf(Buffer.from([0xf3, 0xa4]))).toBeGreaterThanOrEqual(0x78);
});
