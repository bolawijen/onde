import path from "path";
import * as ts from "typescript";
import { openSync, closeSync, chmodSync, writeSync } from "fs";
import * as OndeGlobals from "./globals.ts";
import { CompilerContext } from "./types.ts";
import { walkRoot } from "./zimmerframe.ts";
import { writeHeader } from "./elf";


const inputPath = path.resolve(Bun.argv[2]);
const src = await Bun.file(inputPath).text();
const oIdx = Bun.argv.indexOf("-o");
const out = oIdx !== -1 && Bun.argv[oIdx + 1] ? Bun.argv[oIdx + 1] : (Bun.argv[4] ?? "out");

// ─── Parse ───────────────────────────────────────────────────────────────
const sf = ts.createSourceFile(path.basename(inputPath), src, ts.ScriptTarget.Latest, true);

const compilerContext: CompilerContext = {
  internPool: [],
  instructs: [],
  patchIndexes: [],
  patchOffsets: [],
  codeLength: 0,
  imports: {},
}

walkRoot(sf, compilerContext)

// ─── Data ────────────────────────────────────────────────────────────────
compilerContext.exitCall || OndeGlobals.process.exit(compilerContext);
const codeLen = compilerContext.instructs.length;
const dataLen = compilerContext.internPool.length;
const fileSize = 0x78 + codeLen + dataLen;
const dataVaddr = 0x400000 + 0x78 + codeLen;

// ─── ELF ─────────────────────────────────────────────────────────────────
const fd = openSync(out, "w");

writeHeader(fd, fileSize)

const elf = new Uint8Array(compilerContext.instructs.length + compilerContext.internPool.length)
elf.set(compilerContext.instructs, 0)
elf.set(compilerContext.internPool, compilerContext.instructs.length)

for (let i=0; i < compilerContext.patchOffsets.length; i++) {
  const off = compilerContext.patchOffsets[i];
  const addr = dataVaddr + compilerContext.patchIndexes[i];
  elf[off]     = addr & 0xff;
  elf[off + 1] = (addr >> 8) & 0xff;
  elf[off + 2] = (addr >> 16) & 0xff;
  elf[off + 3] = (addr >> 24) & 0xff;
}

writeSync(fd, elf);
closeSync(fd);
chmodSync(out, 0o755);

if (process.env.NODE_ENV !== 'test')
  console.log(`wrote ${out} (${fileSize} bytes)`);
