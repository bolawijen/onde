import * as ts from "typescript";
import { CompilerContext } from "./internals/context";
import { emitCmp, emitJccFalse, emitJmp, patchJump } from "./control-flow";
import { emitExpr } from "./eval";

type Walk = (node: ts.Node, ctx: CompilerContext) => void;

// Emit a numeric/identifier switch as a dispatch table of compares followed by
// sequential clause bodies. Clause bodies stay sequential to preserve fallthrough.
export function emitSwitch(sw: ts.SwitchStatement, walk: Walk, ctx: CompilerContext): void {
  const selector = 10;
  const caseValue = 11;
  if (!emitExpr(selector, sw.expression, ctx)) return;

  const clauses = sw.caseBlock.clauses;
  const dispatchJumps: number[] = [];
  let defaultClause = -1;
  for (let i = 0; i < clauses.length; i++) {
    const clause = clauses[i];
    if (ts.isDefaultClause(clause)) {
      defaultClause = i;
      continue;
    }
    if (!emitExpr(caseValue, clause.expression, ctx)) return;
    emitCmp({ reg: selector }, { reg: caseValue }, ctx);
    const next = emitJccFalse(0x85, ctx); // jne: test the next case
    dispatchJumps.push(emitJmp(ctx));
    patchJump(next, ctx.instructs.length, ctx);
  }

  const defaultJump = emitJmp(ctx);
  const clauseStarts: number[] = [];
  ctx.loopBreakStarts.push(ctx.loopBreakJumps.length);
  for (const clause of clauses) {
    clauseStarts.push(ctx.instructs.length);
    for (const stmt of clause.statements) walk(stmt, ctx);
  }
  const end = ctx.instructs.length;
  const breakStart = ctx.loopBreakStarts.pop()!;
  for (let i = breakStart; i < ctx.loopBreakJumps.length; i++)
    patchJump(ctx.loopBreakJumps[i], end, ctx);
  ctx.loopBreakJumps.length = breakStart;

  let jump = 0;
  for (let i = 0; i < clauses.length; i++) {
    if (ts.isDefaultClause(clauses[i])) continue;
    patchJump(dispatchJumps[jump++], clauseStarts[i], ctx);
  }
  patchJump(defaultJump, defaultClause === -1 ? end : clauseStarts[defaultClause], ctx);
}
