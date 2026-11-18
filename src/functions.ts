import * as ts from "typescript";
import { CompilerContext } from "./internals/context";
import { readIntern, writeIntern } from "./internals/name";
import { writeNameId } from "./name";
import { emitJmp, emitMovReg, emitPopReg, emitPushReg, emitRet, patchJump } from "./control-flow";

// ─── functions ───────────────────────────────────────────────────────────
// User-defined functions are emitted as their own code blobs after the main
// body; every call is a near `call rel32` patched once all blobs have a
// position. Registers r12-r15 are the variable slots, so a function saves and
// restores them (its own prologue/epilogue) to keep the caller's values alive.
//
// All function/call state lives in CompilerContext as flat parallel arrays
// indexed by function id, so there is one home for the record and no module
// level mutable globals.
const VAR_REGS = [12, 13, 14, 15];
export const ARG_REGS = [7, 6, 2, 1, 8, 9]; // rdi, rsi, rdx, rcx, r8, r9

export function readNameArg(val: string, ctx: CompilerContext): number | undefined {
  const id = readIntern(val, ctx);
  if (id === -1) return undefined;
  if (ctx.localNames) {
    const i = ctx.localNames.indexOf(id);
    if (i !== -1) return 12 + i;
  }
  const i = ctx.vars.indexOf(id);
  return i !== -1 ? 12 + i : undefined;
}

// Index of a top-level function by name, or -1 when it is not one.
export function funcIndex(name: string, ctx: CompilerContext): number {
  const id = readIntern(name, ctx);
  return id === -1 ? -1 : ctx.funcNames.indexOf(id);
}

// Record a call site: the rel32 operand to patch, and the callee it targets.
export function recordCall(operand: number, fi: number, ctx: CompilerContext): void {
  ctx.callOperands.push(operand);
  ctx.callFuncs.push(fi);
}

// True while a function body is being emitted (i.e. `return` has a target).
export function inFunction(ctx: CompilerContext): boolean {
  return ctx.returnJumps !== null;
}

// Collect a `return` jump so the epilogue can be patched to it.
export function recordReturn(operand: number, ctx: CompilerContext): void {
  ctx.returnJumps!.push(operand);
}

// Register every top-level `function f(a, b) { ... }` by its statement index.
// Destructured or default parameters are outside the supported subset and make
// the function invisible to call resolution.
export function collectFunctions(sf: ts.SourceFile, ctx: CompilerContext): void {
  ctx.funcNames.length = 0;
  ctx.funcParams.length = 0;
  ctx.funcStmts.length = 0;
  ctx.funcOffsets.length = 0;
  ctx.callOperands.length = 0;
  ctx.callFuncs.length = 0;

  for (let si = 0; si < sf.statements.length; si++) {
    const stmt = sf.statements[si];
    if (stmt.kind !== ts.SyntaxKind.FunctionDeclaration) continue;
    const fn = stmt as ts.FunctionDeclaration;
    if (!fn.name || !fn.body) continue;

    const params: number[] = [];
    let supported = true;
    for (const param of fn.parameters) {
      if (param.name.kind !== ts.SyntaxKind.Identifier) { supported = false; break; }
      params.push(writeIntern((param.name as ts.Identifier).text, ctx));
    }
    if (!supported) continue;

    ctx.funcNames.push(writeIntern(fn.name.text, ctx));
    ctx.funcParams.push(params);
    ctx.funcStmts.push(si);
    ctx.funcOffsets.push(-1);
  }
}

// Lay out the function blobs after the main body and patch the calls. The body
// walker is injected so this module stays free of a walker dependency.
export function emitFunctionBlobs(
  sf: ts.SourceFile, walkStatement: (stmt: ts.Statement, ctx: CompilerContext) => void, ctx: CompilerContext,
): void {
  if (ctx.funcNames.length === 0) return;

  // Main body ends here: skip over the function blobs, then lay them out.
  const over = emitJmp(ctx);
  for (let i = 0; i < ctx.funcNames.length; i++) emitFunction(sf, i, walkStatement, ctx);
  patchJump(over, ctx.instructs.length, ctx);

  for (let i = 0; i < ctx.callOperands.length; i++)
    patchJump(ctx.callOperands[i], ctx.funcOffsets[ctx.callFuncs[i]], ctx);
}

// Emit one function as a code blob:
//   push r12..r15            ; frame: keep the caller's variable slots
//   mov <slot>, <arg reg>    ; bind parameters
//   <body>
//   pop r15..r12             ; epilogue (all `return`s jump here)
//   ret
function emitFunction(
  sf: ts.SourceFile, fi: number, walkStatement: (stmt: ts.Statement, ctx: CompilerContext) => void, ctx: CompilerContext,
): void {
  ctx.funcOffsets[fi] = ctx.instructs.length;

  for (const reg of VAR_REGS) emitPushReg(reg, ctx);

  ctx.localNames = [];
  const params = ctx.funcParams[fi];
  for (let i = 0; i < params.length; i++) {
    const reg = writeNameId(params[i], ctx);
    if (reg !== undefined) emitMovReg(reg, ARG_REGS[i], ctx);
  }

  const returns: number[] = [];
  ctx.returnJumps = returns;
  const fn = sf.statements[ctx.funcStmts[fi]] as ts.FunctionDeclaration;
  walkStatement(fn.body!, ctx);
  ctx.returnJumps = null;
  ctx.localNames = null;

  const epilogue = ctx.instructs.length;
  for (let i = VAR_REGS.length - 1; i >= 0; i--) emitPopReg(VAR_REGS[i], ctx);
  emitRet(ctx);

  for (const operand of returns) patchJump(operand, epilogue, ctx);
}
