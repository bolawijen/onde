import { test, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { compile } from "../harness";

test("ELF: program header keeps p_align at 0x1000", async () => {
  const out = await compile(`console.log("align");`, "tests/bin/test_elf_align");
  try {
    const bytes = readFileSync(out);
    expect(bytes.readBigUInt64LE(0x70)).toBe(0x1000n);
  } finally {
    rmSync(out, { force: true });
  }
});

test("ELF: GNU stack is readable and writable but not executable", async () => {
  const out = await compile(`console.log("stack");`, "tests/bin/test_elf_gnu_stack");
  try {
    const bytes = readFileSync(out);
    expect(bytes.readUInt32LE(0x78)).toBe(0x6474e551);
    expect(bytes.readUInt32LE(0x7c)).toBe(6);
  } finally {
    rmSync(out, { force: true });
  }
});

test("ELF: symbol names are not emitted and logged text occurs once", async () => {
  const out = await compile(`console.log("runtime-only");`, "tests/bin/test_elf_symbol_pool");
  try {
    const bytes = readFileSync(out);
    const text = Buffer.from("runtime-only\n");
    expect(bytes.indexOf(text)).toBeGreaterThanOrEqual(0);
    expect(bytes.indexOf(text, bytes.indexOf(text) + 1)).toBe(-1);
    expect(bytes.indexOf(Buffer.from("writeSync\0"))).toBe(-1);
  } finally {
    rmSync(out, { force: true });
  }
});
