import { test, expect, beforeAll, afterAll } from "bun:test";
import { compile, parse } from "../harness";
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
  expect(elf[0xb0]).toBe(MOV_RAX_IMM32);
  expect(elf.readUInt32LE(0xb1)).toBe(SYS_OPEN);
});

test("openSync: path 'out.txt' in .rodata", () => {
  const idx = elf.indexOf(Buffer.from("out.txt"));
  expect(idx).toBeGreaterThan(0xb0);
});

test("openSync: flags O_WRONLY|O_CREAT|O_TRUNC = 0x241", () => {
  const flagBytes = Buffer.from([0xbe, 0x41, 0x02, 0x00, 0x00]);
  const idx = elf.indexOf(flagBytes);
  expect(idx).toBeGreaterThanOrEqual(0xb0);
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

  // Explicit fd 0 remains stdin: mov edi, 0.
  expect(bytes.indexOf(Buffer.from([0xb8, SYS_WRITE, 0, 0, 0, 0xbf, 0, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
  expect(bytes.indexOf(Buffer.from([0xb8, SYS_CLOSE, 0, 0, 0, 0xbf, 0, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
});

test("fs full cycle: openSync + writeSync + closeSync writes file to disk", async () => {
  const targetFile = "tests/bin/hello_fs.txt";
  rmSync(targetFile, { force: true });

  const src = `
    import { openSync, writeSync, closeSync } from "fs";
    const fd = openSync("${targetFile}", "w");
    writeSync(fd, "onde writeSync berhasil!");
    closeSync(fd);
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

test("openSync: default flags read without truncating the file", async () => {
  const target = "tests/bin/fs_read_preserves.txt";
  const original = "keep this content";
  await Bun.write(target, original);
  const bin = await compile(`import { openSync, closeSync } from "fs"; const fd = openSync("${target}"); closeSync(fd);`, "tests/bin/fs_open_default_read");
  try {
    await Bun.$`./${bin}`;
    expect(readFileSync(target, "utf8")).toBe(original);
  } finally {
    rmSync(bin, { force: true });
    rmSync(target, { force: true });
  }
});

test('openSync: explicit "r" flags read without truncating the file', async () => {
  const target = "tests/bin/fs_read_explicit.txt";
  const original = "keep this content";
  await Bun.write(target, original);
  const bin = await compile(`import { openSync, closeSync } from "fs"; const fd = openSync("${target}", "r"); closeSync(fd);`, "tests/bin/fs_open_explicit_read");
  try {
    await Bun.$`./${bin}`;
    expect(readFileSync(target, "utf8")).toBe(original);
  } finally {
    rmSync(bin, { force: true });
    rmSync(target, { force: true });
  }
});

test("openSync: two open descriptors remain distinct", async () => {
  const firstPath = "tests/bin/fs_fd_first.txt";
  const secondPath = "tests/bin/fs_fd_second.txt";
  const bin = await compile(`import { openSync, writeSync, closeSync } from "fs"; const first = openSync("${firstPath}", "w"); const second = openSync("${secondPath}", "w"); writeSync(first, "first"); writeSync(second, "second"); closeSync(first); closeSync(second);`, "tests/bin/fs_two_fds");
  try {
    await Bun.$`./${bin}`;
    expect(readFileSync(firstPath, "utf8")).toBe("first");
    expect(readFileSync(secondPath, "utf8")).toBe("second");
  } finally {
    rmSync(bin, { force: true });
    rmSync(firstPath, { force: true });
    rmSync(secondPath, { force: true });
  }
});

test("openSync: invalid flags fail compilation", () => {
  expect(() => parse(`import { openSync } from "fs"; openSync("out.txt", "wr");`)).toThrow(TypeError);
});

test("openSync: failed open exits instead of passing a negative fd onward", async () => {
  const bin = await compile(`import { openSync } from "fs"; openSync("tests/bin/no-such-parent/file", "r");`, "tests/bin/fs_open_error");
  try {
    const proc = Bun.spawn([`./${bin}`], { stdout: "ignore", stderr: "ignore" });
    expect(await proc.exited).toBe(1);
  } finally {
    rmSync(bin, { force: true });
  }
});

test("writevSync: bytecode structure", async () => {
  const src = `
    import { writevSync } from "fs";
    writevSync(1, ["alpha", "beta"]);
  `;
  const bin = await compile(src, "tests/bin/test_writev_bytes");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  // sub rsp, 64 = 48 81 ec 40 00 00 00
  expect(bytes.indexOf(Buffer.from([0x48, 0x81, 0xec, 0x40, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
  // SYS_WRITEV = 20 = b8 14 00 00 00
  expect(bytes.indexOf(Buffer.from([0xb8, SYS_WRITEV, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
  // add rsp, 64 = 48 81 c4 40 00 00 00
  expect(bytes.indexOf(Buffer.from([0x48, 0x81, 0xc4, 0x40, 0, 0, 0]))).toBeGreaterThanOrEqual(0xb0);
});

test("writevSync: ninth iovec uses an untruncated disp32", () => {
  const chunks = Array.from({ length: 9 }, (_, i) => `"${i}"`).join(", ");
  const ctx = parse(`import { writevSync } from "fs"; writevSync(1, [${chunks}]);`);
  const code = Buffer.from(ctx.instructs.bytes());
  // iovec 8 starts at rsp + 128, encoded as a signed disp32.
  expect(code.indexOf(Buffer.from([0x48, 0xc7, 0x84, 0x24, 0x80, 0, 0, 0]))).toBeGreaterThanOrEqual(0);
});

test("openSync: setuid mode is rejected before syscall emission", () => {
  expect(() => parse(`import { openSync } from "fs"; openSync("out.txt", "w", 0o4755);`)).toThrow(RangeError);
});

test("openSync: mode above 0777 is rejected before syscall emission", () => {
  expect(() => parse(`import { openSync } from "fs"; openSync("out.txt", "w", 4294971392);`)).toThrow(RangeError);
});

test("chmodSync: setuid mode is rejected before syscall emission", () => {
  expect(() => parse(`import { chmodSync } from "fs"; chmodSync("target", 0o4755);`)).toThrow(RangeError);
});

test("writeSync: fd above signed syscall range is rejected", () => {
  expect(() => parse(`import { writeSync } from "fs"; writeSync(4294967296, "x");`)).toThrow(TypeError);
});

test("writevSync: rejects more than the Linux iovec limit", () => {
  const chunks = Array.from({ length: 1025 }, () => `"x"`).join(", ");
  expect(() => parse(`import { writevSync } from "fs"; writevSync(1, [${chunks}]);`)).toThrow(RangeError);
});

test("writeSync: UTF-8 byte length matches emitted data", async () => {
  const target = "tests/bin/fs_utf8.txt";
  rmSync(target, { force: true });
  const out = await compile(`import { openSync, writeSync, closeSync } from "fs"; const fd = openSync("${target}", "w"); writeSync(fd, "café"); closeSync(fd);`, "tests/bin/test_fs_utf8");
  await Bun.$`./${out}`;
  const content = readFileSync(target, "utf8");
  rmSync(out, { force: true });
  rmSync(target, { force: true });
  expect(content).toBe("café");
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
