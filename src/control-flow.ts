import { CompilerContext } from "./internals/context";
import { Bytes } from "./internals/bytes";
import { CmpOp } from "./ops";

// ─── Operands ────────────────────────────────────────────────────────────
// A resolved operand is either a 64-bit register slot (r12+) or an immediate.
export type Operand = { reg: number } | { imm: number };

// Near conditional jump (0f 8x) taken when the comparison is *false*.
// Keyed on the internal CmpOp, so this file stays parser-agnostic.
const CMP_JCC_FALSE: { [op: number]: number } = {
  [CmpOp.Lt]: 0x8d, // jge
  [CmpOp.Le]: 0x8f, // jg
  [CmpOp.Gt]: 0x8e, // jle
  [CmpOp.Ge]: 0x8c, // jl
  [CmpOp.Eq]: 0x85, // jne
  [CmpOp.Ne]: 0x84, // je
};

export function cmpJccFalse(op: CmpOp): number {
  return CMP_JCC_FALSE[op];
}

// ─── cmp ─────────────────────────────────────────────────────────────────
// Emit `cmp <left>, <right>`, setting flags for `left - right`.
// `left` must be a register; `right` is a register or an immediate.
export function emitCmp(left: Operand, right: Operand, ctx: CompilerContext): void {
  const ins = ctx.instructs;

  if ("reg" in left && "reg" in right) {
    // cmp r/m64, r64  -> 4d 39 /r
    const modrm = 0xc0 | ((right.reg - 8) << 3) | (left.reg - 8);
    ins.push(0x4d, 0x39, modrm);
    return;
  }

  if ("reg" in left && "imm" in right) {
    // cmp r/m64, imm32  -> 49 81 /7 id
    const imm = right.imm;
    assertSigned32(imm, "compare immediate");
    ins.push(
      0x49, 0x81, 0xc0 | (7 << 3) | (left.reg - 8),
      imm & 0xff, (imm >> 8) & 0xff, (imm >> 16) & 0xff, (imm >> 24) & 0xff,
    );
  }
}

// ─── jumps ───────────────────────────────────────────────────────────────
// Jump displacements are rel32, relative to the end of the jump instruction.
// They are patched once the target position is known.

// Emit a near `jcc` (0f 8x) taken when the preceding comparison is false.
// Returns the offset of the rel32 operand for later patching.
export function emitJccFalse(opcode: number, ctx: CompilerContext): number {
  ctx.instructs.push(0x0f, opcode, 0, 0, 0, 0);
  return ctx.instructs.length - 4;
}

// Emit an unconditional near `jmp` (e9). Returns the rel32 operand offset.
export function emitJmp(ctx: CompilerContext): number {
  ctx.instructs.push(0xe9, 0, 0, 0, 0);
  return ctx.instructs.length - 4;
}

// Emit a near `call rel32` (e8). Returns the rel32 operand offset, patched the
// same way as a jump (relative to the end of the instruction).
export function emitCall(ctx: CompilerContext): number {
  ctx.instructs.push(0xe8, 0, 0, 0, 0);
  return ctx.instructs.length - 4;
}

// ret -> c3
export function emitRet(ctx: CompilerContext): void {
  ctx.instructs.push(0xc3);
}

// push/pop r64 -> 50+rd / 58+rd (REX.B for r8+). Used to preserve the
// variable registers across a call.
export function emitPushReg(reg: number, ctx: CompilerContext): void {
  if (reg >= 8) ctx.instructs.push(0x41);
  ctx.instructs.push(0x50 + (reg & 7));
}

export function emitPopReg(reg: number, ctx: CompilerContext): void {
  if (reg >= 8) ctx.instructs.push(0x41);
  ctx.instructs.push(0x58 + (reg & 7));
}

// Patch a rel32 operand so the jump lands on `target` (an index into ctx.instructs).
export function patchJump(operand: number, target: number, ctx: CompilerContext): void {
  const rel = target - (operand + 4);
  if (!Number.isInteger(rel) || rel < -0x80000000 || rel > 0x7fffffff)
    throw new RangeError(`relative jump out of range: ${rel}`)
  ctx.instructs.store(operand, rel & 0xff);
  ctx.instructs.store(operand + 1, (rel >> 8) & 0xff);
  ctx.instructs.store(operand + 2, (rel >> 16) & 0xff);
  ctx.instructs.store(operand + 3, (rel >> 24) & 0xff);
}

// ─── encoding helpers ────────────────────────────────────────────────────
// REX prefix: W = 64-bit operand, R = extended reg field, B = extended r/m field.
function rex(w: boolean, r: boolean, b: boolean): number {
  return 0x40 | (w ? 8 : 0) | (r ? 4 : 0) | (b ? 1 : 0);
}

// ModRM byte for a register r/m operand: reg field = src, r/m field = dest.
function modrmRR(dest: number, src: number): number {
  return 0xc0 | ((src & 7) << 3) | (dest & 7);
}

// ─── mov ─────────────────────────────────────────────────────────────────
// mov r<reg>, imm32 when possible; otherwise movabs with the full safe integer.
export function emitMovImm(reg: number, imm: number, ctx: CompilerContext): void {
  if (!Number.isInteger(reg) || reg < 0 || reg > 15) throw new RangeError(`invalid register: ${reg}`)
  if (!Number.isSafeInteger(imm)) throw new RangeError(`integer immediate is not safe: ${imm}`)
  if (imm >= 0 && imm <= 0xffffffff) {
    if (reg < 8) ctx.instructs.push(0xb8 + reg);
    else ctx.instructs.push(0x41, 0xb8 + (reg & 7));
    ctx.instructs.push(imm & 0xff, (imm >>> 8) & 0xff, (imm >>> 16) & 0xff, (imm >>> 24) & 0xff);
    return;
  }

  ctx.instructs.push(reg < 8 ? 0x48 : 0x49, 0xb8 + (reg & 7));
  let value = imm;
  for (let i = 0; i < 8; i++) {
    ctx.instructs.push(((value % 256) + 256) % 256);
    value = Math.floor(value / 256);
  }
}

// mov r<dest>, r<src>
export function emitMovReg(dest: number, src: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(true, src >= 8, dest >= 8), 0x89, modrmRR(dest, src));
}

// ─── arithmetic ──────────────────────────────────────────────────────────
// add/sub r/m64, imm32 -> REX.W 81 /<ext> id
function emitImmOp(ext: number, reg: number, imm: number, ctx: CompilerContext): void {
  assertSigned32(imm, "arithmetic immediate");
  ctx.instructs.push(
    rex(true, false, reg >= 8), 0x81, 0xc0 | (ext << 3) | (reg & 7),
    imm & 0xff, (imm >> 8) & 0xff, (imm >> 16) & 0xff, (imm >> 24) & 0xff,
  );
}

export function emitAddImm(reg: number, imm: number, ctx: CompilerContext): void {
  emitImmOp(0, reg, imm, ctx);
}

export function emitSubImm(reg: number, imm: number, ctx: CompilerContext): void {
  emitImmOp(5, reg, imm, ctx);
}

// add/sub r/m64, r64 -> REX.W 01/29 /r
export function emitAddReg(dest: number, src: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(true, src >= 8, dest >= 8), 0x01, modrmRR(dest, src));
}

export function emitSubReg(dest: number, src: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(true, src >= 8, dest >= 8), 0x29, modrmRR(dest, src));
}

// imul r64, r/m64 -> REX.W 0f af /r  (reg field is the destination)
export function emitImulReg(dest: number, src: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(true, dest >= 8, src >= 8), 0x0f, 0xaf, modrmRR(src, dest));
}

// imul r64, r/m64, imm32 -> REX.W 69 /r id
export function emitImulImm(reg: number, imm: number, ctx: CompilerContext): void {
  assertSigned32(imm, "multiply immediate");
  ctx.instructs.push(
    rex(true, reg >= 8, reg >= 8), 0x69, modrmRR(reg, reg),
    imm & 0xff, (imm >> 8) & 0xff, (imm >> 16) & 0xff, (imm >> 24) & 0xff,
  );
}

// neg r/m64 -> REX.W f7 /3
export function emitNeg(reg: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(true, false, reg >= 8), 0xf7, 0xc0 | (3 << 3) | (reg & 7));
}

// Signed division: dest = lhs / divisor, or lhs % divisor when `mod`.
// Uses the implicit rdx:rax dividend, so it clobbers rax and rdx.
export function emitDivMod(dest: number, lhs: number, divisor: number, mod: boolean, ctx: CompilerContext): void {
  emitMovReg(0, lhs, ctx);                        // mov rax, lhs
  ctx.instructs.push(0x48, 0x99);                 // cqo (sign-extend rax into rdx:rax)
  ctx.instructs.push(rex(true, false, divisor >= 8), 0xf7, 0xc0 | (7 << 3) | (divisor & 7)); // idiv divisor
  emitMovReg(dest, mod ? 2 : 0, ctx);             // mov dest, rdx/rax
}

// ─── memory operands ─────────────────────────────────────────────────────
// Push ModRM (+SIB) + displacement for `[base + disp]`, with `regField` in the
// register position. Caller pushes REX/opcode first (so it can set REX.R/B).
function pushMemOperand(regField: number, base: number, disp: number, ctx: CompilerContext): void {
  assertSigned32(disp, "memory displacement");
  const ins = ctx.instructs;
  const baseLow = base & 7;
  const needsSib = baseLow === 4;   // rsp / r12 encode as rm=100 and require SIB
  const forceDisp = baseLow === 5;  // rbp / r13: mod=00 means RIP-relative, so force a disp

  let mod: number, dispSize: number;
  if (disp === 0 && !forceDisp) { mod = 0; dispSize = 0; }
  else if (disp >= -128 && disp <= 127) { mod = 1; dispSize = 1; }
  else { mod = 2; dispSize = 4; }

  ins.push(((mod << 6) | ((regField & 7) << 3) | (needsSib ? 4 : baseLow)) & 0xff);
  if (needsSib) ins.push((0 << 6) | (4 << 3) | baseLow); // scale=1, no index, base
  if (dispSize === 1) ins.push(disp & 0xff);
  else if (dispSize === 4) ins.push(disp & 0xff, (disp >> 8) & 0xff, (disp >> 16) & 0xff, (disp >> 24) & 0xff);
}

// mov r<dest>, [base + disp] -> REX.W 8B /r
export function emitLoad(dest: number, base: number, disp: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(true, dest >= 8, base >= 8), 0x8b);
  pushMemOperand(dest, base, disp, ctx);
}

// mov [base + disp], r<src> -> REX.W 89 /r
export function emitStore(base: number, disp: number, src: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(true, src >= 8, base >= 8), 0x89);
  pushMemOperand(src, base, disp, ctx);
}

// movzx r<dest>, byte [base + disp] -> 0F B6 /r
export function emitLoadByte(dest: number, base: number, disp: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(false, dest >= 8, base >= 8), 0x0f, 0xb6);
  pushMemOperand(dest, base, disp, ctx);
}

// mov byte [base + disp], r<src> -> 88 /r (low 8 bits of src)
export function emitStoreByte(base: number, disp: number, src: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(false, src >= 8, base >= 8), 0x88);
  pushMemOperand(src, base, disp, ctx);
}

// mov byte [base + disp], imm8 -> C6 /0 ib
export function emitStoreByteImm(base: number, disp: number, imm: number, ctx: CompilerContext): void {
  ctx.instructs.push(rex(false, false, base >= 8), 0xc6);
  pushMemOperand(0, base, disp, ctx);
  ctx.instructs.push(imm & 0xff);
}

// movzx r<dest>, byte [base + index] -> 0F B6 /r (SIB, no displacement).
// `index` must not be rsp/r12 (encoded as "no index").
export function emitLoadByteIndexed(dest: number, base: number, index: number, ctx: CompilerContext): void {
  ctx.instructs.push(
    0x40 | (dest >= 8 ? 4 : 0) | (index >= 8 ? 2 : 0) | (base >= 8 ? 1 : 0),
    0x0f, 0xb6,
    0x04,                                                  // mod=00, reg=dest, rm=100 (SIB)
    ((index & 7) << 3) | (base & 7),                       // scale=1, index, base
  );
}

// ─── typed-array element access ──────────────────────────────────────────
// Element loads/stores for typed arrays driven by the element width `size`
// (1/2/4/8 bytes); `signed` only affects sub-word loads (movsx vs movzx).
// The index is either folded into the displacement (constant index) or fed
// through the SIB scale factor (runtime index * size).

// SIB form: [base + index * 2^scaleBits], with no displacement (disp8=0 for
// rbp/r13, whose mod=00 encoding means RIP-relative).
function pushSibOperand(regField: number, base: number, index: number, scaleBits: number, ctx: CompilerContext): void {
  const ins = ctx.instructs;
  const baseLow = base & 7;
  const forceDisp = baseLow === 5;               // rbp / r13
  const mod = forceDisp ? 1 : 0;
  ins.push(((mod << 6) | ((regField & 7) << 3) | 4) & 0xff);
  ins.push(((scaleBits & 3) << 6) | ((index & 7) << 3) | baseLow);
  if (forceDisp) ins.push(0);
}

function rex4(w: boolean, r: boolean, x: boolean, b: boolean): number {
  return 0x40 | (w ? 8 : 0) | (r ? 4 : 0) | (x ? 2 : 0) | (b ? 1 : 0);
}

// [base + disp] element load into a 64-bit register.
export function emitLoadElem(dest: number, base: number, disp: number, size: number, signed: boolean, ctx: CompilerContext): void {
  const ins = ctx.instructs;
  if (size === 8) {
    ins.push(rex4(true, dest >= 8, false, base >= 8), 0x8b);
  } else if (size === 4) {
    if (signed) ins.push(rex4(true, dest >= 8, false, base >= 8), 0x63);   // movsxd
    else ins.push(rex4(false, dest >= 8, false, base >= 8), 0x8b);         // mov r32
  } else {
    const op = size === 1 ? (signed ? 0xbe : 0xb6) : (signed ? 0xbf : 0xb7);
    // Signed sub-word loads need REX.W so movsx sign-extends to all 64 bits.
    ins.push(rex4(signed, dest >= 8, false, base >= 8), 0x0f, op);
  }
  pushMemOperand(dest, base, disp, ctx);
}

// [base + disp] element store, copying the low `size` bytes of `src`.
export function emitStoreElem(base: number, disp: number, src: number, size: number, ctx: CompilerContext): void {
  const ins = ctx.instructs;
  if (size === 8) ins.push(rex4(true, src >= 8, false, base >= 8), 0x89);
  else if (size === 4) ins.push(rex4(false, src >= 8, false, base >= 8), 0x89);
  else if (size === 2) ins.push(0x66, rex4(false, src >= 8, false, base >= 8), 0x89);
  else ins.push(rex4(false, src >= 8, false, base >= 8), 0x88);
  pushMemOperand(src, base, disp, ctx);
}

// [base + disp] element store of an immediate (sign-extended for 4/8 bytes).
export function emitStoreElemImm(base: number, disp: number, imm: number, size: number, ctx: CompilerContext): void {
  const ins = ctx.instructs;
  if (size === 8) {
    if (Number.isSafeInteger(imm) && imm >= -0x80000000 && imm <= 0x7fffffff) {
      ins.push(rex4(true, false, false, base >= 8), 0xc7);
      pushMemOperand(0, base, disp, ctx);
      pushImm32(ins, imm);
    } else {
      // x86 has no mov-r/m64, imm64 encoding. Load the whole safe integer into
      // a scratch register, then store it, so array/object data is not narrowed.
      emitMovImm(0, imm, ctx);
      emitStoreElem(base, disp, 0, size, ctx);
    }
  } else if (size === 4) {
    ins.push(rex4(false, false, false, base >= 8), 0xc7);
    pushMemOperand(0, base, disp, ctx);
    pushU32Bits(ins, imm); // typed-array width conversion is intentionally modulo 2^32
  } else if (size === 2) {
    ins.push(0x66, rex4(false, false, false, base >= 8), 0xc7);
    pushMemOperand(0, base, disp, ctx);
    const bits = toUintN(imm, 16);
    ins.push(bits & 0xff, (bits >>> 8) & 0xff);
  } else if (size === 1) {
    ins.push(rex4(false, false, false, base >= 8), 0xc6);
    pushMemOperand(0, base, disp, ctx);
    ins.push(toUintN(imm, 8)); // typed-array width conversion is intentionally modulo 2^8
  } else throw new RangeError(`unsupported element width: ${size}`);
}

// [base + index * size] element load (runtime index).
export function emitLoadElemIndexed(dest: number, base: number, index: number, size: number, signed: boolean, ctx: CompilerContext): void {
  const ins = ctx.instructs;
  const scaleBits = size === 8 ? 3 : size === 4 ? 2 : size === 2 ? 1 : 0;
  if (size === 8) ins.push(rex4(true, dest >= 8, index >= 8, base >= 8), 0x8b);
  else if (size === 4) {
    if (signed) ins.push(rex4(true, dest >= 8, index >= 8, base >= 8), 0x63);
    else ins.push(rex4(false, dest >= 8, index >= 8, base >= 8), 0x8b);
  } else {
    const op = size === 1 ? (signed ? 0xbe : 0xb6) : (signed ? 0xbf : 0xb7);
    // Signed sub-word loads need REX.W so movsx sign-extends to all 64 bits.
    ins.push(rex4(signed, dest >= 8, index >= 8, base >= 8), 0x0f, op);
  }
  pushSibOperand(dest, base, index, scaleBits, ctx);
}

// [base + index * size] element store (runtime index).
export function emitStoreElemIndexed(base: number, index: number, src: number, size: number, ctx: CompilerContext): void {
  const ins = ctx.instructs;
  const scaleBits = size === 8 ? 3 : size === 4 ? 2 : size === 2 ? 1 : 0;
  if (size === 8) ins.push(rex4(true, src >= 8, index >= 8, base >= 8), 0x89);
  else if (size === 4) ins.push(rex4(false, src >= 8, index >= 8, base >= 8), 0x89);
  else if (size === 2) ins.push(0x66, rex4(false, src >= 8, index >= 8, base >= 8), 0x89);
  else ins.push(rex4(false, src >= 8, index >= 8, base >= 8), 0x88);
  pushSibOperand(src, base, index, scaleBits, ctx);
}

function pushImm32(ins: Bytes, imm: number): void {
  assertSigned32(imm, "stored immediate");
  ins.push(imm & 0xff, (imm >> 8) & 0xff, (imm >> 16) & 0xff, (imm >> 24) & 0xff);
}

function pushU32Bits(ins: Bytes, value: number): void {
  const bits = toUintN(value, 32);
  ins.push(bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff);
}

function toUintN(value: number, width: number): number {
  if (!Number.isFinite(value)) return 0;
  const modulus = 2 ** width;
  const truncated = Math.trunc(value) % modulus;
  return truncated < 0 ? truncated + modulus : truncated;
}

function assertSigned32(value: number, what: string): void {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    throw new RangeError(`${what} out of signed 32-bit range: ${value}`)
}
