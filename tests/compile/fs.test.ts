import { test, expect, beforeAll, afterAll } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";
import { SYS_OPEN, SYS_WRITE, SYS_CLOSE, SYS_WRITEV } from "../../src/syscall";

const MOV_RAX_IMM32 = 0xB8;
let outbin, elf: Buffer;

beforeAll(async () => {
  outbin = await compile(`import { openSync } from "fs";\nopenSync("out.txt", "w");`, "tests/bin/fs_open");
  elf = readFileSync(outbin);
});

afterAll(() => {
  rmSync(outbin, { force: true });
});

test("openSync: syscall SYS_OPEN", () => {
  expect(elf[0x78]).toBe(MOV_RAX_IMM32);
  expect(elf.readUInt32LE(0x79)).toBe(SYS_OPEN);
});

test("openSync: path 'out.txt' in .rodata", () => {
  const idx = elf.indexOf(Buffer.from("out.txt"));
  expect(idx).toBeGreaterThan(0x78);
});

test("openSync: flags O_WRONLY|O_CREAT|O_TRUNC = 0x241", () => {
  const flagBytes = Buffer.from([0xbe, 0x41, 0x02, 0x00, 0x00]);
  const idx = elf.indexOf(flagBytes);
  expect(idx).toBeGreaterThanOrEqual(0x78);
});

test("writeSync & closeSync: bytecode structure", async () => {
  const src = `
    import { writeSync, closeSync } from "fs";
    writeSync(0, "halo");
    closeSync(0);
  `;
  const bin = await compile(src, "tests/bin/test_wc_bytes");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // SYS_WRITE = 1, mov rdi, r12 = 4c 89 e7
  expect(bytes.indexOf(Buffer.from([0xb8, SYS_WRITE, 0, 0, 0, 0x4c, 0x89, 0xe7]))).toBeGreaterThanOrEqual(0x78);
  // SYS_CLOSE = 3, mov rdi, r12 = 4c 89 e7
  expect(bytes.indexOf(Buffer.from([0xb8, SYS_CLOSE, 0, 0, 0, 0x4c, 0x89, 0xe7]))).toBeGreaterThanOrEqual(0x78);
});

test("fs full cycle: openSync + writeSync + closeSync writes file to disk", async () => {
  const targetFile = "tests/bin/hello_fs.txt";
  rmSync(targetFile, { force: true });

  const src = `
    import { openSync, writeSync, closeSync } from "fs";
    openSync("${targetFile}", "w");
    writeSync(0, "onde writeSync berhasil!");
    closeSync(0);
  `;
  const bin = await compile(src, "tests/bin/test_full_fs");
  await Bun.$`./${bin}`;
  const content = readFileSync(targetFile, "utf-8");

  rmSync(bin, { force: true });
  rmSync(targetFile, { force: true });

  expect(content).toBe("onde writeSync berhasil!");
});

test("openSync + writeSync + closeSync with fd variable", async () => {
  const targetFile = "tests/bin/hello_fs_fd.txt";
  rmSync(targetFile, { force: true });

  const src = `
    import { openSync, writeSync, closeSync } from "fs";
    const fd = openSync("${targetFile}", "w");
    writeSync(fd, "onde writeSync with fd works!");
    closeSync(fd);
  `;
  const bin = await compile(src, "tests/bin/test_fs_fd");
  await Bun.$`./${bin}`;
  const content = readFileSync(targetFile, "utf-8");

  rmSync(bin, { force: true });
  rmSync(targetFile, { force: true });

  expect(content).toBe("onde writeSync with fd works!");
});

test("writevSync: bytecode structure", async () => {
  const src = `
    import { writevSync } from "fs";
    writevSync(1, ["alpha", "beta"]);
  `;
  const bin = await compile(src, "tests/bin/test_writev_bytes");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // sub rsp, 64 = 48 83 ec 40
  expect(bytes.indexOf(Buffer.from([0x48, 0x83, 0xec, 0x40]))).toBeGreaterThanOrEqual(0x78);
  // SYS_WRITEV = 20 = b8 14 00 00 00
  expect(bytes.indexOf(Buffer.from([0xb8, SYS_WRITEV, 0, 0, 0]))).toBeGreaterThanOrEqual(0x78);
  // add rsp, 64 = 48 83 c4 40
  expect(bytes.indexOf(Buffer.from([0x48, 0x83, 0xc4, 0x40]))).toBeGreaterThanOrEqual(0x78);
});

test("writevSync: writes scatter-gather chunks to stdout", async () => {
  const src = `
    import { writevSync } from "fs";
    writevSync(1, ["zero-copy ", "writev ", "works!\\n"]);
  `;
  const bin = await compile(src, "tests/bin/test_writev_stdout");
  const result = await Bun.$`./${bin}`.text();
  rmSync(bin, { force: true });

  expect(result).toBe("zero-copy writev works!\n");
});
