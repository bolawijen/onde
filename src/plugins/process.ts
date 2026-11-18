import { CompilerContext } from "../internals/context";
import { plugin } from "../plugin";
import { emitExit, emitExitReg } from "../syscall";
import { ARG_REGISTER, readArgCount, readArgKind, readArgNumber, readArgValue } from "../internals/args";

export function exit(argList: number, ctx: CompilerContext): void {
  const count = readArgCount(argList, ctx);
  if (count === undefined || count > 1)
    throw new TypeError("process.exit accepts at most one numeric literal");
  if (count === 0) {
    emitExit(ctx);
    return;
  }
  const kind = readArgKind(argList, 0, ctx);
  if (kind === ARG_REGISTER) {
    const reg = readArgValue(argList, 0, ctx);
    if (reg === undefined || reg < 12 || reg > 15)
      throw new TypeError("process.exit code register must be a variable in r12-r15");
    emitExitReg(reg, ctx);
    return;
  }
  const code = readArgNumber(argList, 0, ctx);
  if (code === undefined)
    throw new TypeError("process.exit code must be a numeric literal or variable");
  emitExit(ctx, code);
}

export function cwd(_argList: number, _ctx: CompilerContext): void {
}

plugin({
  name: "process",
  setup(build) {
    build.module("process", "object", { exit, cwd });
  },
});

// Ganti dengan yang benar:

// ```typescript
// export function cwd(ctx: any): void {
//   ctx.instructs.push(
//     // mmap → r13
//     0xb8, SYS_mmap, 0, 0, 0,
//     0x31, 0xff,
//     0xbe, PATH_MAX & 0xff, (PATH_MAX >> 8) & 0xff, 0, 0,
//     0xba, 3, 0, 0, 0,
//     0x49, 0xbe, 0x22, 0, 0, 0, 0, 0, 0, 0,
//     0xb9, 0xff, 0xff, 0xff, 0xff,
//     0x49, 0x89, 0xc9,
//     0x0f, 0x05,
//     0x49, 0x89, 0xc5,         // mov r13, rax

//     // getcwd: rdi=r13, rsi=4096
//     0x49, 0x89, 0xe8,         // mov r8, r13
//     0x48, 0x89, 0xe8,         // mov rax, r13 (discard)
//     // actually: mov rdi, r13
//     0x49, 0x89, 0xe8,         // mov r8, r13
//     0x48, 0x89, 0xe8,
//   );
// }
// ```

// Stop. Register encoding salah terus. Yang benar:

// | Instruksi | Bytes |
// |-----------|-------|
// | `mov r13, rax` | `49 89 c5` |
// | `mov rdi, r13` | `49 89 e8` |
// | `mov rsi, 4096` | `be 00 10 00 00` |
// | `mov rax, 79` | `b8 4f 00 00 00` |
// | `syscall` | `0f 05` |
// | `mov rdx, rax` | `48 89 c2` |
// | `mov rax, 1` | `b8 01 00 00 00` |
// | `mov rdi, 1` | `bf 01 00 00 00` |
// | `mov rsi, r13` | `49 89 e6` |
// | `syscall` | `0f 05` |

// ```typescript
// export function cwd(ctx: any): void {
//   ctx.instructs.push(
//     // mmap → r13
//     0xb8, SYS_mmap, 0, 0, 0,
//     0x31, 0xff,
//     0xbe, PATH_MAX & 0xff, (PATH_MAX >> 8) & 0xff, 0, 0,
//     0xba, 3, 0, 0, 0,
//     0x49, 0xbe, 0x22, 0, 0, 0, 0, 0, 0, 0,
//     0xb9, 0xff, 0xff, 0xff, 0xff,
//     0x49, 0x89, 0xc9,
//     0x0f, 0x05,
//     0x49, 0x89, 0xc5,         // mov r13, rax (cache)

//     // getcwd(r13, 4096)
//     0x49, 0x89, 0xe8,         // mov rdi, r13
//     0xb8, SYS_getcwd, 0, 0, 0,
//     0xbe, PATH_MAX & 0xff, (PATH_MAX >> 8) & 0xff, 0, 0,
//     0x0f, 0x05,

//     // write(1, r13, rax)
//     0x48, 0x89, 0xc2,         // mov rdx, rax (len)
//     0xb8, SYS_write, 0, 0, 0,
//     0xbf, 1, 0, 0, 0,
//     0x49, 0x89, 0xe6,         // mov rsi, r13
//     0x0f, 0x05,
//   );
// }
// ```

// **Cache = `r13`.** First call = mmap + store. Kalau `cwd()` dipanggil 2x, mmap di-emit 2x (2x 40 bytes). Kalau mau skip mmap di call ke-2, perlu `test r13, r13` + `jz` — tapi itu branch. Untuk MVP (1-2x call), tidak perlu.

// `r13` = callee-saved. Tidak di-clobber oleh syscall. Persist sampai `exit`.
