import * as ts from "typescript";
import { CompilerContext } from "./internals/context";
import { readIntern, writeIntern } from "./internals/name";
import { isModule } from "./plugin";
import { emitCmp, emitJccFalse, emitJmp, patchJump } from "./control-flow";
import { collectFunctions, emitFunctionBlobs, inFunction, recordReturn } from "./functions";
import { resetTables } from "./tables";
import {
  R_RAX, bindIteration, declareVariables, emitAssignment, emitExpr, emitStep,
  evalCall, loopVarName, resolveCondition, resolveKeys, resolveValues,
} from "./eval";
import { emitSwitch } from "./switch";

export default function (ctx: CompilerContext): { walk: (sf: ts.SourceFile) => void } {
  // Intern only the members of the enabled extensions, so an extension that is
  // not enabled contributes no names (and no data bytes) to the output.
  for (const m of ctx.modules) {
    for (const [name, fn] of Object.entries(m.members)) {
      const id = writeIntern(name, ctx);
      ctx.builtins[id] = fn;
    }
  }
  return { walk: (sf) => walk(sf, ctx) }
}

function walkStatement(stmt: ts.Statement, ctx: CompilerContext): void {
  if (stmt.kind === ts.SyntaxKind.Block)
    for (const s of (stmt as ts.Block).statements) walk(s, ctx);
  else
    walk(stmt, ctx);
}

function beginLoop(ctx: CompilerContext): void {
  beginBreakScope(ctx);
  ctx.loopContinueStarts.push(ctx.loopContinueJumps.length);
}

function beginBreakScope(ctx: CompilerContext): void {
  ctx.loopBreakStarts.push(ctx.loopBreakJumps.length);
}

function endBreakScope(target: number, ctx: CompilerContext): void {
  const start = ctx.loopBreakStarts.pop()!;
  for (let i = start; i < ctx.loopBreakJumps.length; i++)
    patchJump(ctx.loopBreakJumps[i], target, ctx);
  ctx.loopBreakJumps.length = start;
}

function patchContinues(start: number, target: number, ctx: CompilerContext): void {
  for (let i = start; i < ctx.loopContinueJumps.length; i++)
    patchJump(ctx.loopContinueJumps[i], target, ctx);
  ctx.loopContinueJumps.length = start;
}

function endLoop(target: number, ctx: CompilerContext): void {
  endBreakScope(target, ctx);
  const continueStart = ctx.loopContinueStarts.pop()!;
  ctx.loopContinueJumps.length = continueStart;
}

function walk(node: ts.Node, ctx: CompilerContext) {
  switch (node.kind) {
    case ts.SyntaxKind.SourceFile: {
      const sf = node as ts.SourceFile;
      resetTables(ctx);

      collectFunctions(sf, ctx);

      for (const stmt of sf.statements) {
        if (stmt.kind === ts.SyntaxKind.FunctionDeclaration) continue;
        walk(stmt, ctx);
      }

      emitFunctionBlobs(sf, walkStatement, ctx);
      return;
    }

    // Top-level functions are emitted as blobs from the SourceFile case.
    case ts.SyntaxKind.FunctionDeclaration:
      return;

    case ts.SyntaxKind.ReturnStatement: {
      const rs = node as ts.ReturnStatement;
      if (!inFunction(ctx)) return; // `return` outside a function: nothing to jump to
      if (rs.expression && !emitExpr(R_RAX, rs.expression, ctx)) return;
      recordReturn(emitJmp(ctx), ctx);
      return;
    }

    case ts.SyntaxKind.ImportDeclaration: {
      const imp = node as ts.ImportDeclaration;
      const spec = (imp.moduleSpecifier as ts.StringLiteral).text;

      const specModule = isModule(spec, ctx)
      if (!specModule) return;

      const bindings = (imp.importClause?.namedBindings as ts.NamedImports)?.elements;
      if (bindings) {
        for (const elem of bindings) {
          const namedImport = elem.name.text
          ctx.imports.push(readIntern(namedImport, ctx))
        }
      }
      return;
    }

    // const x = 42 or const x = fn(...) or const y = x or const s = "a" + "b"
    case ts.SyntaxKind.VariableStatement: {
      declareVariables((node as ts.VariableStatement).declarationList, ctx);
      return;
    }

    case ts.SyntaxKind.ForStatement: {
      const fs = node as ts.ForStatement;

      // ─── init
      if (fs.initializer) {
        if (fs.initializer.kind === ts.SyntaxKind.VariableDeclarationList)
          declareVariables(fs.initializer as ts.VariableDeclarationList, ctx);
        else
          emitStep(fs.initializer as ts.Expression, ctx);
      }

      // ─── condition check
      const head = ctx.instructs.length;
      let exit = -1;
      if (fs.condition) {
        const cond = resolveCondition(fs.condition, ctx);
        if (!cond) return; // unsupported condition: don't emit an unterminated loop
        emitCmp(cond.left, cond.right, ctx);
        exit = emitJccFalse(cond.jcc, ctx);
      }

      // ─── body + increment
      beginLoop(ctx);
      walkStatement(fs.statement, ctx);
      const continueTarget = fs.incrementor ? ctx.instructs.length : head;
      patchContinues(ctx.loopContinueStarts[ctx.loopContinueStarts.length - 1], continueTarget, ctx);
      if (fs.incrementor) emitStep(fs.incrementor, ctx);

      // ─── back-edge
      const back = emitJmp(ctx);
      patchJump(back, head, ctx);
      if (exit !== -1) patchJump(exit, ctx.instructs.length, ctx);
      endLoop(ctx.instructs.length, ctx);
      return;
    }

    // for (x of [..]) / for (x of "abc") — unrolled at compile time
    case ts.SyntaxKind.ForOfStatement: {
      const fo = node as ts.ForOfStatement;
      const name = loopVarName(fo.initializer);
      const values = name !== undefined ? resolveValues(fo.expression, ctx) : undefined;
      if (name === undefined || !values) return;
      beginLoop(ctx);
      for (const v of values) {
        bindIteration(name, v, ctx);
        const continueStart = ctx.loopContinueJumps.length;
        walkStatement(fo.statement, ctx);
        patchContinues(continueStart, ctx.instructs.length, ctx);
      }
      endLoop(ctx.instructs.length, ctx);
      return;
    }

    // for (x in {..}) / for (x in [..]) — keys unrolled at compile time
    case ts.SyntaxKind.ForInStatement: {
      const fi = node as ts.ForInStatement;
      const name = loopVarName(fi.initializer);
      const keys = name !== undefined ? resolveKeys(fi.expression) : undefined;
      if (name === undefined || !keys) return;
      beginLoop(ctx);
      for (const k of keys) {
        bindIteration(name, { str: k }, ctx);
        const continueStart = ctx.loopContinueJumps.length;
        walkStatement(fi.statement, ctx);
        patchContinues(continueStart, ctx.instructs.length, ctx);
      }
      endLoop(ctx.instructs.length, ctx);
      return;
    }

    case ts.SyntaxKind.BreakStatement:
      if (ctx.loopBreakStarts.length)
        ctx.loopBreakJumps.push(emitJmp(ctx));
      return;

    case ts.SyntaxKind.ContinueStatement:
      if (ctx.loopContinueStarts.length)
        ctx.loopContinueJumps.push(emitJmp(ctx));
      return;

    case ts.SyntaxKind.IfStatement: {
      const is = node as ts.IfStatement;

      const cond = resolveCondition(is.expression, ctx);
      if (!cond) return;

      // cmp <left>, <right>; j<not> end/else
      emitCmp(cond.left, cond.right, ctx);
      const skip = emitJccFalse(cond.jcc, ctx);

      walkStatement(is.thenStatement, ctx);

      if (is.elseStatement) {
        const done = emitJmp(ctx);
        patchJump(skip, ctx.instructs.length, ctx);
        walkStatement(is.elseStatement, ctx);
        patchJump(done, ctx.instructs.length, ctx);
      } else {
        patchJump(skip, ctx.instructs.length, ctx);
      }
      return;
    }

    case ts.SyntaxKind.SwitchStatement:
      emitSwitch(node as ts.SwitchStatement, walk, ctx);
      return;

    case ts.SyntaxKind.ExpressionStatement: {
      const es = node as ts.ExpressionStatement;
      if (es.expression.kind === ts.SyntaxKind.CallExpression) {
        evalCall(es.expression as ts.CallExpression, ctx);
      } else if (es.expression.kind === ts.SyntaxKind.BinaryExpression) {
        emitAssignment(es.expression as ts.BinaryExpression, ctx);
      }
      return;
    }
  }
}
