import { CompilerContext } from "./context";

export const PATCH_ABS32 = 0;
export const PATCH_ABS32_SIGNED = 1;

function addPatch(ctx: CompilerContext, offset: number, index: number, kind = PATCH_ABS32): void {
  ctx.patchOffsets.push(offset);
  ctx.patchIndexes.push(index);
  ctx.patchKinds.push(kind);
}

// Emit an imm32 placeholder and record its exact offset at the same time.
// Call after writing an instruction's opcode/prefix, before its trailing bytes.
export function emitPatchImm32(ctx: CompilerContext, index: number, kind = PATCH_ABS32): number {
  const offset = ctx.instructs.length;
  ctx.instructs.push(0, 0, 0, 0);
  addPatch(ctx, offset, index, kind);
  return offset;
}

// Emit `mov r32, imm32` (`mov r64, imm32` via zero-extension for r8-r15)
// with a deferred absolute data address.
export function emitMovPatch(reg: number, index: number, ctx: CompilerContext, kind = PATCH_ABS32): number {
  if (!Number.isInteger(reg) || reg < 0 || reg > 15)
    throw new RangeError(`invalid register: ${reg}`);
  if (reg < 8) ctx.instructs.push(0xb8 + reg);
  else ctx.instructs.push(0x41, 0xb8 + (reg & 7));
  return emitPatchImm32(ctx, index, kind);
}

// Validate every absolute imm32 data relocation before the output file is
// opened or any bytes are patched into machine code.
export function validatePatches(ctx: CompilerContext, dataVaddr: number): void {
  const codeLength = ctx.instructs.length;
  const dataLength = ctx.internPool.length;
  if (ctx.patchOffsets.length !== ctx.patchIndexes.length || ctx.patchOffsets.length !== ctx.patchKinds.length)
    throw new RangeError("patch tables have different lengths");
  if (!Number.isSafeInteger(dataVaddr) || dataVaddr < 0 || dataVaddr > 0xffffffff)
    throw new RangeError(`patch base address is outside imm32: ${dataVaddr}`);

  for (let i = 0; i < ctx.patchOffsets.length; i++) {
    const offset = ctx.patchOffsets[i];
    const index = ctx.patchIndexes[i];
    const kind = ctx.patchKinds[i];
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + 4 > codeLength)
      throw new RangeError(`patch ${i} offset is outside emitted instructions: ${offset}`);
    if (!Number.isSafeInteger(index) || index < 0 || index >= dataLength)
      throw new RangeError(`patch ${i} index is outside internPool: ${index}`);
    const address = dataVaddr + index;
    if (!Number.isSafeInteger(address) || address < 0 || address > 0xffffffff)
      throw new RangeError(`patch ${i} address is outside imm32: ${address}`);
    if (kind === PATCH_ABS32_SIGNED && address > 0x7fffffff)
      throw new RangeError(`patch ${i} address is outside signed imm32: ${address}`);
    if (kind !== PATCH_ABS32 && kind !== PATCH_ABS32_SIGNED)
      throw new RangeError(`patch ${i} has unknown encoding: ${kind}`);
  }
}
