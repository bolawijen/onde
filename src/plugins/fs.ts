import { CompilerContext } from "../internals/context";
import { plugin } from "../plugin";
import { SYS_OPEN, SYS_CLOSE, SYS_WRITE, SYS_CHMOD, SYS_WRITEV, SYS_EXIT } from "../syscall";
import { ARG_REGISTER, ARG_NUMBER, ARG_LIST, readArgCount, readArgKind, readArgValue, readArgNumber, readArgString } from "../internals/args";
import { appendBytes, appendCString, utf8ByteLength } from "../internals/name";
import { emitPatchImm32, PATCH_ABS32_SIGNED } from "../internals/patch";

const MODE_755 = 0o755;
const O_RDONLY = 0x0;
const O_WRONLY = 0x1;
const O_RDWR   = 0x2;
const O_CREAT  = 0x40;
const O_TRUNC  = 0x200;
const O_APPEND = 0x400;

function parseFlags(s: string): number | undefined {
  switch (s || "r") {
    case "r": return O_RDONLY;
    case "r+": return O_RDWR;
    case "w": return O_WRONLY | O_CREAT | O_TRUNC;
    case "w+": return O_RDWR | O_CREAT | O_TRUNC;
    case "a": return O_WRONLY | O_CREAT | O_APPEND;
    case "a+": return O_RDWR | O_CREAT | O_APPEND;
    default: return undefined;
  }
}

// Keep the syscall result in rax; the compiler moves it to the destination
// variable register after the plugin emitter returns.
const REG_RAX = 0;
// Special permission bits (setuid, setgid, sticky) are deliberately excluded.
const MAX_MODE = 0o777;
const MAX_FD = 0x7fffffff;
const MAX_WRITEV = 1024;
const MAX_IOV_LENGTH = 0x7fffffff;

function pushU32(value: number, ctx: CompilerContext): void {
  ctx.instructs.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function validMode(mode: number): boolean {
  return Number.isInteger(mode) && mode >= 0 && mode <= MAX_MODE;
}

function validFd(args: number, index: number, ctx: CompilerContext): boolean {
  const kind = readArgKind(args, index, ctx);
  if (kind === ARG_REGISTER) {
    const value = readArgValue(args, index, ctx);
    return value !== undefined && value >= 12 && value <= 15;
  }
  if (kind !== ARG_NUMBER) return false;
  const fd = readArgNumber(args, index, ctx)!;
  return Number.isSafeInteger(fd) && fd >= 0 && fd <= MAX_FD;
}

function resolveFd(argList: number, argIndex: number, ctx: CompilerContext): void {
  const kind = readArgKind(argList, argIndex, ctx);
  const val = readArgValue(argList, argIndex, ctx);
  if (kind === ARG_REGISTER && val !== undefined && val >= 12 && val <= 15) {
    ctx.instructs.push(0x4c, 0x89, 0xe7 + (val - 12) * 8);
  } else if (kind === ARG_NUMBER) {
    // immediate fd (e.g. 1 for stdout, 2 for stderr)
    // mov edi, imm32  — 5 bytes: 0xbf + 4-byte imm
    ctx.instructs.push(0xbf);
    pushU32(readArgNumber(argList, argIndex, ctx)!, ctx);
  }
}

export function openSync(args: number, ctx: CompilerContext): number | undefined {
  // path, flags='r', mode=0o666
  const path = readArgString(args, 0, ctx);
  if (path === undefined) throw new TypeError("openSync path must be a compile-time string");
  if (path.includes("\0")) throw new TypeError("openSync path cannot contain a null byte");
  const count = readArgCount(args, ctx);
  if (count === undefined) throw new TypeError("openSync received an invalid argument list");
  if (count < 1 || count > 3) throw new TypeError("openSync accepts path, flags, and optional mode");
  const flagsText = count > 1 ? readArgString(args, 1, ctx) : "";
  if (flagsText === undefined) throw new TypeError("openSync flags must be a compile-time string");
  const flags = parseFlags(flagsText);
  if (flags === undefined) throw new TypeError(`unsupported openSync flags: ${flagsText}`);
  const modeKind = readArgKind(args, 2, ctx);
  const mode = count <= 2 ? 0o666 : modeKind === ARG_NUMBER ? readArgNumber(args, 2, ctx) : undefined;
  if (mode === undefined) throw new TypeError("openSync mode must be a numeric literal");
  if (!validMode(mode)) throw new RangeError(`openSync mode must be between 0 and 0777: ${mode}`);
  const index = appendCString(path, ctx.internPool);

  // mov rax, 2 (SYS_open)
  // mov rdi, path_addr
  // mov rsi, flags
  // mov rdx, mode
  // syscall
  // syscall result remains in rax for the compiler to bind to the variable.
  ctx.instructs.push(
    0xb8, SYS_OPEN, 0, 0, 0,
    0xbf,                        // mov rdi, path_addr (PATCH)
  );
  emitPatchImm32(ctx, index);
  ctx.instructs.push(
    0xbe, flags & 0xff, (flags >> 8) & 0xff, 0, 0,
    0xba, mode & 0xff, (mode >> 8) & 0xff, 0, 0,
    0x0f, 0x05,
    // Linux returns -errno in rax. Stop instead of letting an invalid fd flow
    // into later operations; there is no exception/unwind runtime yet.
    0x48, 0x85, 0xc0,             // test rax, rax
    0x79, 0x0c,                   // jns past the 12-byte failure exit
    0xbf, 0x01, 0, 0, 0,         // mov edi, 1
    0xb8, SYS_EXIT, 0, 0, 0,    // mov eax, SYS_exit
    0x0f, 0x05,
  );

  return REG_RAX;
}

export function closeSync(args: number, ctx: CompilerContext): void {
  // args[0] = fd (number = register index or literal value)
  if (readArgCount(args, ctx) !== 1) throw new TypeError("closeSync accepts exactly one fd");
  if (!validFd(args, 0, ctx)) throw new TypeError("closeSync fd must be a numeric literal or supported fd variable");
  ctx.instructs.push(0xb8, SYS_CLOSE, 0, 0, 0); // mov rax, SYS_close
  resolveFd(args, 0, ctx);
  ctx.instructs.push(0x0f, 0x05);                // syscall
}

export function chmodSync(args: number, ctx: CompilerContext): void {
  const path = readArgString(args, 0, ctx);
  if (path === undefined) throw new TypeError("chmodSync path must be a compile-time string");
  if (path.includes("\0")) throw new TypeError("chmodSync path cannot contain a null byte");
  const count = readArgCount(args, ctx);
  if (count === undefined) throw new TypeError("chmodSync received an invalid argument list");
  if (count < 1 || count > 2) throw new TypeError("chmodSync accepts path and optional mode");
  const modeKind = readArgKind(args, 1, ctx);
  const mode = count <= 1 ? MODE_755 : modeKind === ARG_NUMBER ? readArgNumber(args, 1, ctx) : undefined;
  if (mode === undefined) throw new TypeError("chmodSync mode must be a numeric literal");
  if (!validMode(mode)) throw new RangeError(`chmodSync mode must be between 0 and 0777: ${mode}`);
  const i = appendCString(path, ctx.internPool);

  // mov rax, 90 (SYS_chmod)
  // mov rdi, path_addr
  // mov rsi, mode
  // syscall
  ctx.instructs.push(
    0xb8, SYS_CHMOD, 0, 0, 0,
    0xbf,                         // mov rdi, path_addr (PATCH)
  );
  emitPatchImm32(ctx, i);
  ctx.instructs.push(
    0xbe, mode & 0xff, (mode >> 8) & 0xff, 0, 0,
    0x0f, 0x05,
  );
}

export function writeSync(args: number, ctx: CompilerContext): void {
  if (readArgCount(args, ctx) !== 2) throw new TypeError("writeSync currently accepts exactly fd and string data");
  const data = readArgString(args, 1, ctx);
  if (data === undefined) throw new TypeError("writeSync data must be a compile-time string");
  if (!validFd(args, 0, ctx)) throw new TypeError("writeSync fd must be a numeric literal or supported fd variable");
  const len = utf8ByteLength(data);
  if (len > 0x7ffff000) throw new RangeError("writeSync data exceeds the Linux syscall length limit");
  if (len === 0) return;
  const i = appendBytes(data, ctx.internPool);

  ctx.instructs.push(0xb8, SYS_WRITE, 0, 0, 0);
  resolveFd(args, 0, ctx);

  ctx.instructs.push(
    0xbe,                         // mov esi, data_addr (PATCH)
  );
  emitPatchImm32(ctx, i);
  ctx.instructs.push(
    0xba, len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
    0x0f, 0x05,                  // syscall
  );
}

export function writevSync(args: number, ctx: CompilerContext): void {
  if (readArgCount(args, ctx) !== 2) throw new TypeError("writevSync accepts exactly fd and a literal string array");
  const listId = readArgKind(args, 1, ctx) === ARG_LIST ? readArgValue(args, 1, ctx) : -1;
  if (listId === undefined || !Number.isSafeInteger(listId) || listId < 0)
    throw new TypeError("writevSync data must be a literal array");
  if (!validFd(args, 0, ctx)) throw new TypeError("writevSync fd must be a numeric literal or supported fd variable");
  const N = readArgCount(listId, ctx);
  if (N === undefined) throw new TypeError("writevSync received an invalid array argument list");
  if (N === 0) return;
  if (N > MAX_WRITEV) throw new RangeError(`writevSync supports at most ${MAX_WRITEV} chunks`);

  // Validate before emitting so an unsupported item leaves no partial code.
  for (let i = 0; i < N; i++) {
    const chunk = readArgString(listId, i, ctx);
    if (chunk === undefined) throw new TypeError(`writevSync chunk ${i} must be a compile-time string`);
    if (utf8ByteLength(chunk) > MAX_IOV_LENGTH) throw new RangeError(`writevSync chunk ${i} exceeds the iovec length limit`);
  }

  // 64-byte aligned stack allocation; imm32 and disp32 prevent byte truncation.
  const allocBytes = Math.ceil((N * 16) / 64) * 64;
  ctx.instructs.push(0x48, 0x81, 0xec); // sub rsp, imm32
  pushU32(allocBytes, ctx);

  // Fill iovec structs on stack: [base_ptr (8 bytes), len (8 bytes)]
  for (let i = 0; i < N; i++) {
    const disp = i * 16;
    const chunk = readArgString(listId, i, ctx)!;
    const chunkIndex = appendBytes(chunk, ctx.internPool);
    const len = ctx.internPool.length - chunkIndex;

    // mov qword ptr [rsp + disp32], imm32 (patched to chunk address)
    ctx.instructs.push(0x48, 0xc7, 0x84, 0x24);
    pushU32(disp, ctx);
    if (len > 0) emitPatchImm32(ctx, chunkIndex, PATCH_ABS32_SIGNED);
    else ctx.instructs.push(0, 0, 0, 0);

    // mov qword ptr [rsp + disp32 + 8], len
    ctx.instructs.push(0x48, 0xc7, 0x84, 0x24);
    pushU32(disp + 8, ctx);
    pushU32(len, ctx);
  }

  // mov rax, 20 (SYS_WRITEV)
  ctx.instructs.push(0xb8, SYS_WRITEV, 0, 0, 0);

  // mov rdi, <fd>
  resolveFd(args, 0, ctx);

  ctx.instructs.push(
    0x48, 0x89, 0xe6,                       // mov rsi, rsp (pointer to iovec array on stack)
    0xba, N & 0xff, (N >>> 8) & 0xff, (N >>> 16) & 0xff, (N >>> 24) & 0xff, // mov edx, N
    0x0f, 0x05,                             // syscall
    0x48, 0x81, 0xc4,                       // add rsp, imm32 (restore stack pointer)
  );
  pushU32(allocBytes, ctx);
}

plugin({
  name: "fs",
  setup(build) {
    build.module("fs", "object", { openSync, closeSync, chmodSync, writeSync, writevSync });
  },
});
