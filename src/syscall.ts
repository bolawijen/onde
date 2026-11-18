import { CompilerContext } from "./internals/context";
import { emitMovReg } from "./control-flow";

export const SYS_READ          = 0x00;
export const SYS_WRITE         = 0x01;
export const SYS_OPEN          = 0x02;
export const SYS_CLOSE         = 0x03;
export const SYS_MMAP          = 0x09;
export const SYS_MUNMAP        = 0x0B;
export const SYS_WRITEV        = 0x14;
export const SYS_EXIT          = 0x3C;
export const SYS_CHMOD         = 0x5A;
export const SYS_CLOCK_GETTIME = 0xE4;

// mmap protection flags
export const PROT_NONE  = 0x0;
export const PROT_READ  = 0x1;
export const PROT_WRITE = 0x2;
export const PROT_EXEC  = 0x4;

// mmap map flags
export const MAP_SHARED    = 0x01;
export const MAP_PRIVATE   = 0x02;
export const MAP_ANONYMOUS = 0x20;

// POSIX clocks
export const CLOCK_REALTIME  = 0;
export const CLOCK_MONOTONIC = 1;

// ─── core runtime ────────────────────────────────────────────────────────
// The two syscall sequences the compiler core itself relies on. Extensions
// build their surface on top of these, so both stay available no matter which
// extensions are enabled.

const REG_R12 = 12;
const PROT_RW = PROT_READ | PROT_WRITE;
const MAP_ANON_PRIVATE = MAP_PRIVATE | MAP_ANONYMOUS;
// Sizes are passed through `mov esi, imm32`; keep requested allocations within
// a conservative positive signed-32-bit limit.
export const MAX_MMAP_SIZE = 0x7ffff000;

// exit(code): mov eax, SYS_exit ; mov edi, code ; syscall
export function emitExit(ctx: CompilerContext, code = 0): void {
  if (!Number.isSafeInteger(code))
    throw new RangeError(`process exit code must be a safe integer: ${code}`);
  ctx.instructs.push(
    0xb8, SYS_EXIT, 0x00, 0x00, 0x00,
  );
  if ((code & 0xff) === 0) ctx.instructs.push(0x31, 0xff); // xor edi, edi
  else ctx.instructs.push(0xbf, code & 0xff, 0, 0, 0);      // mov edi, code & 0xff
  ctx.instructs.push(0x0f, 0x05);
}

export function emitExitReg(reg: number, ctx: CompilerContext): void {
  if (!Number.isInteger(reg) || reg < 12 || reg > 15)
    throw new RangeError(`process exit register must be r12-r15: ${reg}`);
  ctx.instructs.push(
    0xb8, SYS_EXIT, 0, 0, 0,
    0x44, 0x89, 0xe7 + ((reg - 12) << 3), // mov edi, r12d-r15d
    0x0f, 0x05,
  );
}

// Anonymous mmap of `size` zero-filled bytes; the base address comes back in
// rax and is parked in `dest`. addr = NULL, fd = -1, offset = 0, so the kernel
// picks the address.
export function emitMmap(size: number, dest: number, ctx: CompilerContext): void {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MMAP_SIZE)
    throw new RangeError(`mmap size must be an integer in [1, ${MAX_MMAP_SIZE}]: ${size}`);

  ctx.instructs.push(
    0xb8, SYS_MMAP, 0x00, 0x00, 0x00,                       // mov eax, SYS_mmap
    0x31, 0xff,                                              // xor edi, edi
    0xbe, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, (size >> 24) & 0xff,
    0xba, PROT_RW, 0x00, 0x00, 0x00,                         // mov edx, PROT_READ | PROT_WRITE
    0x41, 0xba, MAP_ANON_PRIVATE, 0x00, 0x00, 0x00,          // mov r10d, MAP_PRIVATE | MAP_ANONYMOUS
    0x49, 0xc7, 0xc0, 0xff, 0xff, 0xff, 0xff,                // mov r8, -1
    0x45, 0x31, 0xc9,                                        // xor r9d, r9d
    0x0f, 0x05,                                              // syscall
  );

  // mmap returns -errno on failure. Exit rather than treating it as a pointer.
  ctx.instructs.push(
    0x48, 0x85, 0xc0,             // test rax, rax
    0x79, 0x0c,                   // jns past the 12-byte failure exit
    0xbf, 0x01, 0, 0, 0,         // mov edi, 1
    0xb8, SYS_EXIT, 0, 0, 0,    // mov eax, SYS_exit
    0x0f, 0x05,
  );

  if (dest === REG_R12) ctx.instructs.push(0x49, 0x89, 0xc4); // mov r12, rax
  else emitMovReg(dest, 0, ctx);                              // mov dest, rax
}
