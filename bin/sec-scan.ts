#!/bin/env bun

// scan.ts: bun scan.ts <binary> [codeLength]
//          node scan.ts <binary> [codeLength]   (Node 23.6+, atau --experimental-strip-types)
import { readFileSync } from "node:fs";

const ALLOWED: Record<number, string> = {
  1: "write", 2: "open", 3: "close", 9: "mmap", 20: "writev", 60: "exit", 90: "chmod",
};
const BASE = 0x400000;
const ENTRY = 0xb0;

const path = process.argv[2];
if (!path) { console.error("usage: scan.ts <binary> [codeLength]"); process.exit(2); }
const buf = new Uint8Array(readFileSync(path));
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const errors: string[] = [];
const err = (at: number, m: string) => errors.push(`0x${(BASE + at).toString(16)}: ${m}`);
const eq = (at: number, ...b: number[]) => b.every((v, k) => buf[at + k] === v);

// ── ELF header ──
if (buf.length < ENTRY) { console.error("file too small"); process.exit(1); }
if (!eq(0, 0x7f, 0x45, 0x4c, 0x46, 2, 1)) err(0, "not ELF64 little-endian");
if (dv.getUint32(0x18, true) !== BASE + ENTRY) err(0x18, "entry is not 0x4000b0");
if (dv.getUint16(0x38, true) !== 2) err(0x38, "expected two program headers");
if (dv.getUint32(0x40 + 4, true) !== 5) err(0x44, "segment flags are not R+X");
if (dv.getUint32(0x40 + 32, true) !== buf.length) err(0x60, "p_filesz != file size");
if (dv.getUint32(0x78, true) !== 0x6474e551) err(0x78, "missing PT_GNU_STACK");
if (dv.getUint32(0x7c, true) !== 6) err(0x7c, "GNU stack flags are not RW");

// Optional explicit code length (more reliable than guessing where data starts).
const givenCodeLen = process.argv[3] ? Number(process.argv[3]) : undefined;
const EXIT_TRAILER = [0xb8, 0x3c, 0, 0, 0, 0x31, 0xff, 0x0f, 0x05];
let finalExit = -1;
if (givenCodeLen === undefined) {
  for (let at = buf.length - EXIT_TRAILER.length; at >= ENTRY; at--) {
    if (EXIT_TRAILER.every((v, i) => buf[at + i] === v)) { finalExit = at; break; }
  }
}
const limit = givenCodeLen !== undefined
  ? ENTRY + givenCodeLen
  : finalExit >= 0 ? finalExit + EXIT_TRAILER.length : buf.length;

// ── linear decode ──
const starts = new Set<number>();
const jumps: [number, number][] = [];
let pc = ENTRY;
let eax: number | undefined;
let lastWasExit = false;

while (pc < limit) {
  const b = buf[pc];
  let len = 0;
  let isExit = false;

  if (b >= 0xb8 && b <= 0xbf) {                       // mov r32, imm32
    len = 5;
    if (b === 0xb8) eax = dv.getUint32(pc + 1, true);
  } else if (eq(pc, 0x41) && buf[pc + 1] >= 0xb8 && buf[pc + 1] <= 0xbf) { // mov r8d-r15d, imm32
    len = 6;
  } else if (eq(pc, 0x49, 0x81)) {                    // cmp/arithmetic r64, imm32
    len = 7;
  } else if (eq(pc, 0x0f, 0x84) || eq(pc, 0x0f, 0x85)) { // near conditional branch
    len = 6;
    jumps.push([pc, pc + 6 + dv.getInt32(pc + 2, true)]);
  } else if (eq(pc, 0x0f, 0x05)) {                    // syscall
    len = 2;
    if (eax === undefined) err(pc, "syscall with unknown eax");
    else if (!ALLOWED[eax]) err(pc, `syscall ${eax} not in whitelist`);
    isExit = eax === 60;
    eax = undefined;
  } else if (eq(pc, 0x48, 0x85, 0xc0) || eq(pc, 0x48, 0x89, 0xe6) || eq(pc, 0x48, 0x89, 0xe7) ||
             eq(pc, 0x49, 0x89, 0xc4) || eq(pc, 0x45, 0x31, 0xc9)) len = 3;
  else if (eq(pc, 0x44, 0x89) && [0xe7, 0xef, 0xf7, 0xff].includes(buf[pc + 2])) len = 3; // mov edi, r12d-r15d
  else if (b === 0x4c && buf[pc + 1] === 0x89 && [0xe7, 0xef, 0xf7, 0xff].includes(buf[pc + 2])) len = 3; // mov rdi, r12..r15
  else if (eq(pc, 0x31, 0xff) || eq(pc, 0xf3, 0xa4)) len = 2;   // xor edi,edi ; rep movsb
  else if (b === 0xfc) len = 1;                                 // cld
  else if (b === 0x79) {                                        // jns rel8
    len = 2;
    jumps.push([pc, pc + 2 + ((buf[pc + 1] << 24) >> 24)]);
  }
  else if (eq(pc, 0x48, 0x81, 0xec) || eq(pc, 0x48, 0x81, 0xc4)) len = 7; // sub/add rsp, imm32
  else if (eq(pc, 0x41, 0xba)) len = 6;                         // mov r10d, imm32
  else if (eq(pc, 0x49, 0xc7, 0xc0)) len = 7;                   // mov r8, imm32
  else if (eq(pc, 0x48, 0xc7, 0x84, 0x24)) len = 12;            // mov qword [rsp+disp32], imm32
  else {
    if (givenCodeLen !== undefined) err(pc, `unknown byte 0x${b.toString(16)} inside declared code`);
    break;                                                      // otherwise: data starts here
  }

  if (pc + len > buf.length) { err(pc, "instruction runs past end of file"); break; }
  starts.add(pc);
  lastWasExit = isExit;                // true only if the LAST decoded instruction is exit
  pc += len;
}
const codeEnd = pc;

// ── checks ──
if (codeEnd === ENTRY) err(ENTRY, "no code decoded");
if (!lastWasExit) err(codeEnd, "code does not end with an exit syscall (falls through into data)");
for (const [from, to] of jumps)
  if (!starts.has(to) && to !== codeEnd) err(from, `jump lands mid-instruction (0x${(BASE + to).toString(16)})`);

console.log(`code: 0x${ENTRY.toString(16)}..0x${codeEnd.toString(16)} (${codeEnd - ENTRY} bytes), data: ${buf.length - codeEnd} bytes`);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("OK");
