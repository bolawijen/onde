import path from "path";
import * as ts from "typescript";
import { openSync, closeSync, chmodSync, writeSync } from "fs";
import "./plugins/console";
import "./plugins/process";
import "./plugins/fs";
import "./plugins/bun";
import zimmerframe from "./zimmerframe.ts";
import { ELF_CODE_OFFSET, writeHeader } from "./elf";
import { loadModules } from "./plugin.ts";
import { emitExit } from "./syscall.ts";
import * as internals from "./internals";
import { validatePatches } from "./internals/patch";


// ─── Commands ────────────────────────────────────────────────────────────
// self compile. using bun bundler for now
if (["build", "compile"].includes(Bun.argv[2])) {
  const proc = Bun.spawn(["./bin/onde", "./src/onde.ts", "-o", "./bin/onde"], {
  // const proc = Bun.spawn(["bun", "build", "./src/onde.ts", "--outfile=./bin/onde", "--compile"], {
    stdio: ["inherit", "inherit", "inherit"],
  });
  process.exit(await proc.exited);
}

const inputPath = path.resolve(Bun.argv[2]);
const src = await Bun.file(inputPath).text();
const oIdx = Bun.argv.indexOf("-o");
const out = oIdx !== -1 && Bun.argv[oIdx + 1] ? Bun.argv[oIdx + 1] : (Bun.argv[4] ?? "out");

console.log(`== ONDE ==\nCompiling ${inputPath} ...`);

// ─── Parse ───────────────────────────────────────────────────────────────
const sf = ts.createSourceFile(path.basename(inputPath), src, ts.ScriptTarget.Latest, true);

const context = internals.createContext()
context.modules = loadModules()
try {
  zimmerframe(context).walk(sf)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Compile error: ${message}`);
  process.exit(1);
}


// ─── Data ────────────────────────────────────────────────────────────────
emitExit(context);
const codeLen = context.instructs.length;
const dataLen = context.internPool.length;
const fileSize = ELF_CODE_OFFSET + codeLen + dataLen;
const dataVaddr = 0x400000 + ELF_CODE_OFFSET + codeLen;

// ELF32-sized header fields and absolute imm32 data relocations must never
// silently wrap. Reject the image before opening/truncating the output file.
if (!Number.isSafeInteger(fileSize) || fileSize > 0xffffffff || dataVaddr + dataLen > 0x1_0000_0000)
  throw new RangeError("compiled image exceeds the ELF/imm32 address range");
validatePatches(context, dataVaddr);

// ─── ELF ─────────────────────────────────────────────────────────────────
const fd = openSync(out, "w");

writeHeader(fd, fileSize)

for (let i=0; i < context.patchOffsets.length; i++) {
  const off = context.patchOffsets[i];
  const addr = dataVaddr + context.patchIndexes[i];
  context.instructs.store(off,     addr & 0xff);
  context.instructs.store(off + 1, (addr >> 8) & 0xff);
  context.instructs.store(off + 2, (addr >> 16) & 0xff);
  context.instructs.store(off + 3, (addr >> 24) & 0xff);
}

writeSync(fd, context.instructs.bytes());
writeSync(fd, context.internPool.bytes());
closeSync(fd);
chmodSync(out, 0o755);

if (process.env.NODE_ENV !== 'test')
  console.log(`wrote ${out} (${fileSize} bytes)`);
