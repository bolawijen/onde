import { CompilerContext, CallArg } from "../types";

// Runtime string concatenation using x86_64 stack buffer (64-byte cache-line aligned)
// Emits machine code:
//   sub rsp, 256       ; allocate 256-byte (4 cache lines) buffer on stack
//   cld
//   mov rdi, rsp       ; dest = stack buffer in RAM
//   mov rsi, str1_addr ; source 1 in .rodata
//   mov ecx, str1_len
//   rep movsb
//   mov rsi, str2_addr ; source 2 in .rodata
//   mov ecx, str2_len
//   rep movsb
export function concat(ctx: CompilerContext, args: any[]): { __reg: "rsp"; len: number } {
  const str1 = args[0]?.text ?? "";
  const str2 = args[1]?.text ?? "";

  const idx1 = ctx.internPool.length;
  for (const ch of str1) ctx.internPool.push(ch.charCodeAt(0));
  ctx.internPool.push(0);

  const idx2 = ctx.internPool.length;
  for (const ch of str2) ctx.internPool.push(ch.charCodeAt(0));
  ctx.internPool.push(0);

  const totalLen = str1.length + str2.length;

  // sub rsp, 256 (64-byte aligned stack allocation: 4 cache lines)
  ctx.instructs.push(0x48, 0x81, 0xec, 0x00, 0x01, 0x00, 0x00);
  // cld
  ctx.instructs.push(0xfc);
  // mov rdi, rsp
  ctx.instructs.push(0x48, 0x89, 0xe7);

  // Copy str1: mov rsi, imm32; mov ecx, len1; rep movsb
  ctx.patchOffsets.push(ctx.instructs.length + 1);
  ctx.patchIndexes.push(idx1);
  ctx.instructs.push(
    0xbe, 0, 0, 0, 0,
    0xb9, str1.length & 0xff, (str1.length >> 8) & 0xff, 0, 0,
    0xf3, 0xa4,
  );

  // Copy str2: mov rsi, imm32; mov ecx, len2; rep movsb
  ctx.patchOffsets.push(ctx.instructs.length + 1);
  ctx.patchIndexes.push(idx2);
  ctx.instructs.push(
    0xbe, 0, 0, 0, 0,
    0xb9, str2.length & 0xff, (str2.length >> 8) & 0xff, 0, 0,
    0xf3, 0xa4,
  );

  return { __reg: "rsp", len: totalLen };
}
