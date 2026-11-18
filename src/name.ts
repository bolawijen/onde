import { CompilerContext } from "./internals/context";
import { readInternText } from "./internals/name";

const VAR_REGS = [12, 13, 14, 15];
export const ARG_REGS = [7, 6, 2, 1, 8, 9]; // rdi, rsi, rdx, rcx, r8, r9

export function writeNameId(id: number, ctx: CompilerContext): number | undefined {
  if (id < 0) return undefined;
  if (ctx.localNames) {
    let i = ctx.localNames.indexOf(id);
    if (i === -1) {
      if (ctx.localNames.length >= VAR_REGS.length) {
        const name = readInternText(id, ctx) ?? String(id);
        throw new RangeError(`cannot allocate variable \"${name}\": only four variable registers (r12-r15) are supported`);
      }
      i = ctx.localNames.length;
      ctx.localNames.push(id);
    }
    return 12 + i;
  }

  let i = ctx.vars.indexOf(id);
  if (i === -1) {
    if (ctx.vars.length >= VAR_REGS.length) {
      const name = readInternText(id, ctx) ?? String(id);
      throw new RangeError(`cannot allocate variable \"${name}\": only four variable registers (r12-r15) are supported`);
    }
    i = ctx.vars.length;
    ctx.vars.push(id);
  }
  return 12 + i;
}

export function readNameId(id: number, ctx: CompilerContext): number | undefined {
  if (id < 0) return undefined;
  if (ctx.localNames) {
    const i = ctx.localNames.indexOf(id);
    if (i !== -1) return 12 + i;
  }
  const i = ctx.vars.indexOf(id);
  return i !== -1 ? 12 + i : undefined;
}
