import { test, expect } from "bun:test";
import { compile, parse } from "../harness";
import { readFileSync, rmSync } from "fs";

// ─── Bytecode structure
test("mmap: emits the anonymous mmap syscall and parks the pointer in r12", async () => {
  const bin = await compile(`const buf = Bun.mmap(4096);`, "tests/bin/test_mmap");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // mov eax, 9 ; xor edi, edi ; mov esi, 4096
  const head = Buffer.from([
    0xb8, 0x09, 0x00, 0x00, 0x00,
    0x31, 0xff,
    0xbe, 0x00, 0x10, 0x00, 0x00,
  ]);
  expect(bytes.indexOf(head)).toBeGreaterThanOrEqual(0xb0);
  // mmap protection flags are read|write (3), never write|execute (6).
  expect(bytes.indexOf(Buffer.from([0xba, 0x03, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
  expect(bytes.indexOf(Buffer.from([0xba, 0x06, 0, 0, 0]))).toBe(-1);

  // mov r10d, MAP_PRIVATE | MAP_ANONYMOUS ; mov r8, -1 ; syscall
  const tail = Buffer.from([
    0x41, 0xba, 0x22, 0x00, 0x00, 0x00,
    0x49, 0xc7, 0xc0, 0xff, 0xff, 0xff, 0xff,
    0x45, 0x31, 0xc9,
    0x0f, 0x05,
  ]);
  expect(bytes.indexOf(tail)).toBeGreaterThanOrEqual(0xb0);
  expect(bytes.indexOf(Buffer.from([0x49, 0x89, 0xc4]))).toBeGreaterThanOrEqual(0xb0);
});

test("mmap: rejects negative sizes before emitting instructions", () => {
  expect(() => parse(`const buf = Bun.mmap(-1);`)).toThrow(RangeError);
});

test("mmap: rejects sizes above the supported imm32 allocation limit", () => {
  expect(() => parse(`const buf = Bun.mmap(4294967296);`)).toThrow(RangeError);
});

test("mmap: rejects typed-array byte-size overflow before emitting instructions", () => {
  expect(() => parse(`const buf = new Uint32Array(536870913);`)).toThrow(RangeError);
});

test("mmap: rejects an unresolved size expression instead of defaulting it", () => {
  expect(() => parse(`let n = 8; const buf = Bun.mmap(n * 2);`)).toThrow(TypeError);
});

// ─── End-to-End
test("mmap: mapping succeeds and the program keeps running", async () => {
  const src = `
    const buf = Bun.mmap(4096);
    console.log("mmap ok");
  `;
  const out = await compile(src, "tests/bin/test_mmap_run");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("mmap ok");
});
