import { SYS_WRITE } from "../syscall";
import { CompilerContext, CallArg } from "../types";

const OPCODE_LENGTH = 22
const STDOUT = 0x01;

export function log(ctx: CompilerContext, args: CallArg[] = []): void {
  let length = 0, index = ctx.internPool.length
  for (let arg of args) {
    arg = ((typeof arg.text === "string") ? arg.text : String(arg.text)) as CallArg;
    length += arg.length + 1;

    for (const ch of arg) ctx.internPool.push(ch.charCodeAt(0))
    ctx.internPool.push(0x20)
  }

  // overwrite last whitespace
  ctx.internPool[ctx.internPool.length - 1] = 0x0a;
  ctx.codeLength += OPCODE_LENGTH
  ctx.patchIndexes.push(index)
  ctx.patchOffsets.push(ctx.instructs.length + 11);

  ctx.instructs.push(
    0xb8, SYS_WRITE, 0x00, 0x00, 0x00,
    0xbf, STDOUT, 0x00, 0x00, 0x00,
    0xbe, 0, 0, 0, 0,
    0xba, length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >> 24) & 0xff,
    0x0f, 0x05,
  )
}
