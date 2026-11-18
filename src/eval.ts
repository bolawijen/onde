import * as ts from "typescript";
import { CompilerContext } from "./internals/context";
import { readIntern, writeIntern } from "./internals/name";
import {
  ARG_LIST, ARG_NUMBER, ARG_REGISTER, ARG_STRING, readU32, writeU32, writeArg, writeArgList,
} from "./internals/args";
import { resolveMember } from "./plugin";
import {
  Operand, cmpJccFalse, emitAddImm, emitAddReg, emitCall, emitDivMod, emitImulImm,
  emitImulReg, emitLoadByteIndexed, emitLoadElem, emitLoadElemIndexed, emitMovImm,
  emitMovReg, emitNeg, emitPopReg, emitPushReg, emitStoreElem, emitStoreElemImm,
  emitStoreElemIndexed, emitSubImm, emitSubReg,
} from "./control-flow";
import { BinOp, binOpOf, cmpOpOf, compoundOpOf, swapCmp } from "./ops";
import {
  allocArray, allocBlob, allocObject, allocTypedArray, emitBlobCall, emitDataAddr, emitStringAddr,
  evalString, getBlob, getBuffer, blobLength, blobType, bufferLength, bufferSigned,
  bufferSize, numericLiteral, objectPropertyOffset,
} from "./tables";
import { ARG_REGS, funcIndex, readNameArg, recordCall } from "./functions";
import { readNameId, writeNameId } from "./name";

// Scratch registers used to materialise intermediate results. Variables live
// in r12+, so rax/r10/r11 are free for temporaries (r11 doubles as a nested
// right-hand-side slot, r10 holds a divisor for the implicit-division form).
export const R_RAX = 0;
const R_R10 = 10;
const R_R11 = 11;

function writeExprArg(list: number, index: number, arg: ts.Expression, ctx: CompilerContext): void {
  switch (arg.kind) {
    case ts.SyntaxKind.StringLiteral:
      writeArg(list, index, ARG_STRING, writeIntern((arg as ts.StringLiteral).text, ctx), ctx);
      return;
    case ts.SyntaxKind.NumericLiteral:
      writeArg(list, index, ARG_NUMBER, Number((arg as ts.NumericLiteral).text), ctx);
      return;

    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      writeArg(list, index, ARG_STRING, writeIntern((arg as ts.NoSubstitutionTemplateLiteral).text, ctx), ctx);
      return;

    case ts.SyntaxKind.ArrayLiteralExpression: {
      const elements = (arg as ts.ArrayLiteralExpression).elements;
      const childList = writeArgList(elements.length, ctx);
      for (let i = 0; i < elements.length; i++) writeExprArg(childList, i, elements[i], ctx);
      writeArg(list, index, ARG_LIST, childList, ctx);
      return;
    }

    case ts.SyntaxKind.BinaryExpression:
    case ts.SyntaxKind.TemplateExpression: {
      const str = evalString(arg, ctx);
      if (str !== null) {
        writeArg(list, index, ARG_STRING, writeIntern(str, ctx), ctx);
      }
      return;
    }

    case ts.SyntaxKind.Identifier: {
      const name = (arg as ts.Identifier).text;
      const nameId = readIntern(name, ctx);
      const storedId = nameId === -1 ? undefined : readU32(ctx.stringVals, nameId);
      if (storedId !== undefined && storedId !== 0) {
        writeArg(list, index, ARG_STRING, storedId - 1, ctx);
        return;
      }
      const reg = readNameArg(name, ctx);
      if (reg !== undefined) writeArg(list, index, ARG_REGISTER, reg, ctx);
      return;
    }

    case ts.SyntaxKind.PrefixUnaryExpression: {
      const unary = arg as ts.PrefixUnaryExpression;
      if (unary.operator === ts.SyntaxKind.MinusToken && unary.operand.kind === ts.SyntaxKind.NumericLiteral)
        writeArg(list, index, ARG_NUMBER, -Number((unary.operand as ts.NumericLiteral).text), ctx);
      return;
    }

    case ts.SyntaxKind.TypeOfExpression: {
      const type = typeofExpression((arg as ts.TypeOfExpression).expression, ctx);
      if (type !== undefined) writeArg(list, index, ARG_STRING, writeIntern(type, ctx), ctx);
      return;
    }
  }
}

// This compiler lowers a deliberately small, statically known subset. For
// `typeof`, classify the expression forms whose runtime category is known at
// compile time and intern the resulting JS typeof string as ordinary data.
function typeofExpression(expr: ts.Expression, ctx: CompilerContext): string | undefined {
  if (expr.kind === ts.SyntaxKind.ParenthesizedExpression)
    return typeofExpression((expr as ts.ParenthesizedExpression).expression, ctx);

  switch (expr.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateExpression:
      return "string";
    case ts.SyntaxKind.NumericLiteral:
      return "number";
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
      return "boolean";
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.ArrayLiteralExpression:
    case ts.SyntaxKind.ObjectLiteralExpression:
      return "object";
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.ArrowFunction:
      return "function";
    case ts.SyntaxKind.VoidExpression:
      return "undefined";
    case ts.SyntaxKind.DeleteExpression:
      return "boolean";
    case ts.SyntaxKind.BinaryExpression: {
      const be = expr as ts.BinaryExpression;
      const operator = be.operatorToken.kind;
      if ([
        ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.LessThanToken, ts.SyntaxKind.LessThanEqualsToken,
        ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.GreaterThanEqualsToken,
        ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken,
      ].includes(operator)) return "boolean";
      return evalString(expr, ctx) !== null || be.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        (typeofExpression(be.left, ctx) === "string" || typeofExpression(be.right, ctx) === "string")
        ? "string" : "number";
    }
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const ue = expr as ts.PrefixUnaryExpression;
      return ue.operator === ts.SyntaxKind.ExclamationToken ? "boolean" : "number";
    }
    case ts.SyntaxKind.Identifier: {
      const name = (expr as ts.Identifier).text;
      if (name === "undefined") return "undefined";
      if (name === "NaN" || name === "Infinity") return "number";
      if (name === "console" || name === "process" || name === "Bun") return "object";
      const id = readIntern(name, ctx);
      if (id !== -1 && readU32(ctx.stringVals, id) !== undefined && readU32(ctx.stringVals, id) !== 0)
        return "string";
      if (funcIndex(name, ctx) !== -1) return "function";
      if (id !== -1 && (ctx.objectPropStarts[id] !== undefined || ctx.bufferSizes[id] !== undefined))
        return "object";
      if (readNameId(id, ctx) !== undefined) return "number";
      return "undefined";
    }
    case ts.SyntaxKind.CallExpression:
      return "number";
    default:
      return undefined;
  }
}

function resolveArgList(args: ts.NodeArray<ts.Expression>, ctx: CompilerContext): number {
  const list = writeArgList(args.length, ctx);
  for (let i = 0; i < args.length; i++) writeExprArg(list, i, args[i], ctx);
  return list;
}

// Does this expression contain a call anywhere in its subtree? Arguments that
// do are rejected: a nested call would clobber the argument registers set so far.
function containsCall(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.CallExpression) { found = true; return; }
    n.forEachChild(visit);
  };
  node.forEachChild(visit);
  return found;
}

// Does this expression contain a division or modulo anywhere in its subtree?
// Both lower to `idiv`, which reads the implicit rdx:rax dividend and so
// clobbers rax (and rdx) as a side effect.
function containsDivMod(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.BinaryExpression) {
      const op = binOpOf((n as ts.BinaryExpression).operatorToken.kind);
      if (op === BinOp.Div || op === BinOp.Mod) { found = true; return; }
    }
    n.forEachChild(visit);
  };
  visit(node);
  return found;
}

// Marshal one call argument into `reg`. Returns false (emitting nothing) for
// anything we cannot materialise into a single register.
function emitArg(reg: number, arg: ts.Expression, ctx: CompilerContext): boolean {
  switch (arg.kind) {
    case ts.SyntaxKind.NumericLiteral:
      emitMovImm(reg, Number((arg as ts.NumericLiteral).text), ctx);
      return true;

    case ts.SyntaxKind.Identifier: {
      const src = readNameId(readIntern((arg as ts.Identifier).text, ctx), ctx);
      if (src === undefined) return false;
      if (src !== reg) emitMovReg(reg, src, ctx);
      return true;
    }

    case ts.SyntaxKind.ParenthesizedExpression:
      return emitArg(reg, (arg as ts.ParenthesizedExpression).expression, ctx);

    case ts.SyntaxKind.PrefixUnaryExpression: {
      const ue = arg as ts.PrefixUnaryExpression;
      if (ue.operator !== ts.SyntaxKind.MinusToken || ue.operand.kind !== ts.SyntaxKind.NumericLiteral)
        return false;
      emitMovImm(reg, -Number((ue.operand as ts.NumericLiteral).text), ctx);
      return true;
    }
  }

  // Computed expression: fine as long as it does not hide a nested call.
  if (containsCall(arg)) return false;
  return emitExpr(reg, arg, ctx);
}

// Emit a call to a user-defined function: arguments into rdi/rsi/rdx/rcx/r8/r9,
// near `call rel32` (patched later), result in rax.
function evalUserCall(callExpr: ts.CallExpression, fi: number, ctx: CompilerContext): number | undefined {
  const args = callExpr.arguments;
  if (args.length > ARG_REGS.length) return undefined;

  for (let i = 0; i < args.length; i++)
    if (!emitArg(ARG_REGS[i], args[i], ctx)) return undefined;

  recordCall(emitCall(ctx), fi, ctx);
  return R_RAX;
}

export function evalCall(callExpr: ts.CallExpression, ctx: CompilerContext): number | undefined {
  const callee = callExpr.expression;

  // fn(...) where fn is declared in this file
  if (callee.kind === ts.SyntaxKind.Identifier) {
    const fi = funcIndex((callee as ts.Identifier).text, ctx);
    if (fi !== -1) return evalUserCall(callExpr, fi, ctx);
  }

  const args = resolveArgList(callExpr.arguments, ctx);
  switch (callee.kind) {
    // module.method(...)
    case ts.SyntaxKind.PropertyAccessExpression: {
      const pa = callee as ts.PropertyAccessExpression;
      // blob.method(...) — Blob surface; unaccommodated members become a no-op.
      if (pa.expression.kind === ts.SyntaxKind.Identifier) {
        const blob = getBlob((pa.expression as ts.Identifier).text, ctx);
        if (blob !== -1) return emitBlobCall((pa.expression as ts.Identifier).text, pa.name.text, ctx);
      }
      const mod = (pa.expression as ts.Identifier).text;
      const method = pa.name.text;
      return resolveMember(mod, method, ctx)?.(args, ctx);
    }
    case ts.SyntaxKind.Identifier: {
      // importedFn(...)
      const name = (callee as ts.Identifier).text;
  const id = readIntern(name, ctx);
      if (id !== -1 && ctx.imports.includes(id))
        return ctx.builtins[id]?.(args, ctx);
    }
  }
}

// Resolve an expression to a comparison operand, or undefined if unsupported.
function resolveOperand(expr: ts.Expression, ctx: CompilerContext): Operand | undefined {
  switch (expr.kind) {
    case ts.SyntaxKind.NumericLiteral:
      return { imm: Number((expr as ts.NumericLiteral).text) };

    case ts.SyntaxKind.Identifier: {
      const reg = readNameId(readIntern((expr as ts.Identifier).text, ctx), ctx);
      return reg !== undefined ? { reg } : undefined;
    }
  }
  return undefined;
}

// Evaluate `expr` and leave its value in register `dest`.
export function emitExpr(dest: number, expr: ts.Expression, ctx: CompilerContext): boolean {
  switch (expr.kind) {
    case ts.SyntaxKind.TypeOfExpression: {
      const type = typeofExpression((expr as ts.TypeOfExpression).expression, ctx);
      if (type === undefined) return false;
      emitStringAddr(dest, type, ctx);
      return true;
    }
    case ts.SyntaxKind.NumericLiteral:
      emitMovImm(dest, Number((expr as ts.NumericLiteral).text), ctx);
      return true;

    case ts.SyntaxKind.ParenthesizedExpression:
      return emitExpr(dest, (expr as ts.ParenthesizedExpression).expression, ctx);

    case ts.SyntaxKind.PrefixUnaryExpression: {
      const ue = expr as ts.PrefixUnaryExpression;
      if (ue.operator === ts.SyntaxKind.MinusToken && emitExpr(dest, ue.operand, ctx)) {
        emitNeg(dest, ctx);
        return true;
      }
      return false;
    }

    case ts.SyntaxKind.Identifier: {
      const reg = readNameId(readIntern((expr as ts.Identifier).text, ctx), ctx);
      if (reg === undefined) return false;
      if (reg !== dest) emitMovReg(dest, reg, ctx);
      return true;
    }

    case ts.SyntaxKind.BinaryExpression: {
      const be = expr as ts.BinaryExpression;
      const op = binOpOf(be.operatorToken.kind);
      if (op === undefined) return false;
      if (!emitExpr(dest, be.left, ctx)) return false;
      return emitApplyOp(dest, op, be.right, ctx);
    }

    case ts.SyntaxKind.CallExpression: {
      const result = evalCall(expr as ts.CallExpression, ctx);
      if (result === undefined) return false;
      if (result !== dest) emitMovReg(dest, result, ctx);
      return true;
    }

    case ts.SyntaxKind.PropertyAccessExpression: {
      const pa = expr as ts.PropertyAccessExpression;
      if (pa.expression.kind === ts.SyntaxKind.Identifier) {
        const name = (pa.expression as ts.Identifier).text;
        const offset = objectPropertyOffset(name, pa.name.text, ctx);
        if (offset !== -1) {
          const base = readNameId(readIntern(name, ctx), ctx);
          if (base === undefined) return false;
          emitLoadElem(dest, base, offset, 8, false, ctx);
          return true;
        }
      }
      if (pa.expression.kind === ts.SyntaxKind.Identifier) {
        const blob = getBlob((pa.expression as ts.Identifier).text, ctx);
        if (blob !== -1) {
          if (pa.name.text === "size") { emitMovImm(dest, blobLength(blob, ctx), ctx); return true; }
          if (pa.name.text === "type") {
            // Accommodated only when a type was given; otherwise a no-op zero.
            const type = blobType(blob, ctx);
            if (type >= 0) emitDataAddr(dest, type, ctx);
            else emitMovImm(dest, 0, ctx);
            return true;
          }
        }
      }
      if (pa.name.text === "length") {
        if (pa.expression.kind === ts.SyntaxKind.Identifier) {
          const buf = getBuffer((pa.expression as ts.Identifier).text, ctx);
          if (buf !== -1) { emitMovImm(dest, bufferLength(buf, ctx), ctx); return true; }
        }
        const str = evalString(pa.expression, ctx);
        if (str !== null) { emitMovImm(dest, [...str].length, ctx); return true; }
      }
      return false;
    }

    case ts.SyntaxKind.ElementAccessExpression: {
      const ea = expr as ts.ElementAccessExpression;
      if (ea.expression.kind === ts.SyntaxKind.Identifier) {
        const name = (ea.expression as ts.Identifier).text;
        const buf = getBuffer(name, ctx);
        if (buf !== -1) return emitBufferLoad(dest, name, ea.argumentExpression, buf, ctx);
      }
      const str = evalString(ea.expression, ctx);
      if (str !== null) return emitStringChar(dest, str, ea.argumentExpression, ctx);
      return false;
    }
  }
  return false;
}

// Resolve the right-hand side of an operator to an operand, materialising a
// computed sub-expression into a scratch register (never `dest` itself).
function resolveRhs(expr: ts.Expression, dest: number, ctx: CompilerContext): Operand | undefined {
  if (expr.kind === ts.SyntaxKind.PrefixUnaryExpression) {
    const ue = expr as ts.PrefixUnaryExpression;
    if (ue.operator === ts.SyntaxKind.MinusToken && ue.operand.kind === ts.SyntaxKind.NumericLiteral)
      return { imm: -Number((ue.operand as ts.NumericLiteral).text) };
  }

  const simple = resolveOperand(expr, ctx);
  if (simple) return simple;

  const scratch = dest === R_RAX ? R_R11 : R_RAX;
  if (expr.kind === ts.SyntaxKind.BinaryExpression || expr.kind === ts.SyntaxKind.ParenthesizedExpression) {
    // `dest` holds the left-hand partial. A div/mod buried in the right-hand
    // side clobbers rax and can spill into the scratch set, so when `dest` is
    // itself a scratch register park it on the stack for the duration.
    const guarded = containsDivMod(expr) && (dest === R_RAX || dest === R_R10 || dest === R_R11);
    if (guarded) emitPushReg(dest, ctx);
    const ok = emitExpr(scratch, expr, ctx);
    if (guarded) emitPopReg(dest, ctx);
    if (ok) return { reg: scratch };
  }

  return undefined;
}

// Apply `dest = dest <op> rhs` for a binary arithmetic operator.
function emitApplyOp(dest: number, op: BinOp, rhsExpr: ts.Expression, ctx: CompilerContext): boolean {
  // Division/modulo need the divisor in a register (not an immediate).
  if (op === BinOp.Div || op === BinOp.Mod) {
    let divisor: number;
    const simple = resolveOperand(rhsExpr, ctx);
    if (simple && "reg" in simple) divisor = simple.reg;
    else if (simple && "imm" in simple) { emitMovImm(R_R10, simple.imm, ctx); divisor = R_R10; }
    else if (emitExpr(R_R10, rhsExpr, ctx)) divisor = R_R10;
    else return false;

    emitDivMod(dest, dest, divisor, op === BinOp.Mod, ctx);
    return true;
  }

  const rhs = resolveRhs(rhsExpr, dest, ctx);
  if (!rhs) return false;

  switch (op) {
    case BinOp.Add:
      if ("imm" in rhs) emitAddImm(dest, rhs.imm, ctx); else emitAddReg(dest, rhs.reg, ctx);
      return true;

    case BinOp.Sub:
      if ("imm" in rhs) emitSubImm(dest, rhs.imm, ctx); else emitSubReg(dest, rhs.reg, ctx);
      return true;

    case BinOp.Mul:
      if ("imm" in rhs) emitImulImm(dest, rhs.imm, ctx); else emitImulReg(dest, rhs.reg, ctx);
      return true;
  }
  return false;
}

// ─── buffer / string element access ──────────────────────────────────────

// Read `buf[index]` into `dest`.
function emitBufferLoad(dest: number, name: string, indexExpr: ts.Expression, buf: number, ctx: CompilerContext): boolean {
  const base = readNameId(readIntern(name, ctx), ctx);
  if (base === undefined) return false;
  const size = bufferSize(buf, ctx);
  const signed = bufferSigned(buf, ctx);

  const ci = numericLiteral(indexExpr);
  if (ci !== undefined) {
    emitLoadElem(dest, base, ci * size, size, signed, ctx);
    return true;
  }

  if (indexExpr.kind !== ts.SyntaxKind.Identifier) return false;
  const ireg = readNameId(readIntern((indexExpr as ts.Identifier).text, ctx), ctx);
  if (ireg === undefined) return false;
  if (dest === base) return false;

  const idx = dest === R_R10 ? R_R11 : R_R10;
  emitMovReg(idx, ireg, ctx);
  emitLoadElemIndexed(dest, base, idx, size, signed, ctx);
  return true;
}

// Write `value` into `buf[index]`.
function emitBufferStore(name: string, indexExpr: ts.Expression, valueExpr: ts.Expression, buf: number, ctx: CompilerContext): boolean {
  const base = readNameId(readIntern(name, ctx), ctx);
  if (base === undefined) return false;
  const size = bufferSize(buf, ctx);

  const ci = numericLiteral(indexExpr);
  const vi = numericLiteral(valueExpr);
  if (ci !== undefined && vi !== undefined) {
    emitStoreElemImm(base, ci * size, vi, size, ctx);
    return true;
  }

  // Materialise the value into a register.
  let vreg: number | undefined;
  if (valueExpr.kind === ts.SyntaxKind.Identifier) vreg = readNameId(readIntern((valueExpr as ts.Identifier).text, ctx), ctx);
  if (vreg === undefined) {
    if (!emitExpr(R_RAX, valueExpr, ctx)) return false;
    vreg = R_RAX;
  }

  if (ci !== undefined) {
    emitStoreElem(base, ci * size, vreg, size, ctx);
    return true;
  }

  if (indexExpr.kind !== ts.SyntaxKind.Identifier) return false;
  const ireg = readNameId(readIntern((indexExpr as ts.Identifier).text, ctx), ctx);
  if (ireg === undefined) return false;

  const idx = vreg === R_R10 ? R_R11 : R_R10;
  emitMovReg(idx, ireg, ctx);
  emitStoreElemIndexed(base, idx, vreg, size, ctx);
  return true;
}

// Read `s[index]` (a string character's code point) into `dest`.
function emitStringChar(dest: number, str: string, indexExpr: ts.Expression, ctx: CompilerContext): boolean {
  const chars = [...str];
  const ci = numericLiteral(indexExpr);
  if (ci !== undefined) {
    if (ci < 0 || ci >= chars.length) return false;
    emitMovImm(dest, chars[ci].codePointAt(0)!, ctx);
    return true;
  }

  if (indexExpr.kind !== ts.SyntaxKind.Identifier) return false;
  const ireg = readNameId(readIntern((indexExpr as ts.Identifier).text, ctx), ctx);
  if (ireg === undefined) return false;
  if (dest === R_R10 || dest === R_R11) return false;

  emitStringAddr(R_R11, str, ctx);          // mov r11, &bytes
  emitMovReg(R_R10, ireg, ctx);             // mov r10, index
  emitLoadByteIndexed(dest, R_R11, R_R10, ctx);
  return true;
}

// Emit an assignment to an identifier target: `x = e`, `x += e`, ...
export function emitAssignment(be: ts.BinaryExpression, ctx: CompilerContext): boolean {
  if (be.left.kind === ts.SyntaxKind.ElementAccessExpression) {
    const ea = be.left as ts.ElementAccessExpression;
    if (ea.expression.kind !== ts.SyntaxKind.Identifier) return false;
    if (be.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
    const buf = getBuffer((ea.expression as ts.Identifier).text, ctx);
    return buf !== -1 && emitBufferStore((ea.expression as ts.Identifier).text, ea.argumentExpression, be.right, buf, ctx);
  }

  if (be.left.kind === ts.SyntaxKind.PropertyAccessExpression) {
    const pa = be.left as ts.PropertyAccessExpression;
    if (pa.expression.kind !== ts.SyntaxKind.Identifier || be.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return false;
    const name = (pa.expression as ts.Identifier).text;
    const offset = objectPropertyOffset(name, pa.name.text, ctx);
    const base = readNameId(readIntern(name, ctx), ctx);
    if (offset === -1 || base === undefined) return false;
    const imm = numericLiteral(be.right);
    if (imm !== undefined) emitStoreElemImm(base, offset, imm, 8, ctx);
    else if (emitExpr(R_RAX, be.right, ctx)) emitStoreElem(base, offset, R_RAX, 8, ctx);
    else return false;
    return true;
  }

  if (be.left.kind !== ts.SyntaxKind.Identifier) return false;
  const dest = readNameId(readIntern((be.left as ts.Identifier).text, ctx), ctx);
  if (dest === undefined) return false;

  const op = be.operatorToken.kind;
  if (op === ts.SyntaxKind.EqualsToken) return emitExpr(dest, be.right, ctx);

  const plain = compoundOpOf(op);
  return plain !== undefined ? emitApplyOp(dest, plain, be.right, ctx) : false;
}

// Resolve an `if` condition to a register/immediate comparison plus the
// conditional-jump opcode taken when that comparison is false.
export function resolveCondition(expr: ts.Expression, ctx: CompilerContext)
  : { left: Operand; right: Operand; jcc: number } | undefined {
  if (expr.kind !== ts.SyntaxKind.BinaryExpression) return undefined;
  const be = expr as ts.BinaryExpression;

  let op = cmpOpOf(be.operatorToken.kind);
  if (op === undefined) return undefined;
  let left = resolveOperand(be.left, ctx);
  let right = resolveOperand(be.right, ctx);

  // A `buf[i]` / `"abc"[i]` read has no register of its own; fold a constant-index
  // element read into a scratch register so it can still take part in a compare.
  if (!left && materializeComparisonSide(be.left, R_R10, ctx)) left = { reg: R_R10 };
  if (!right && materializeComparisonSide(be.right, R_R11, ctx)) right = { reg: R_R11 };
  if (!left || !right) return undefined;

  // `cmp` needs the register on the left; swapping operands flips the operator.
  if ("imm" in left && "reg" in right) {
    [left, right] = [right, left];
    op = swapCmp(op);
  }
  if (!("reg" in left)) return undefined;

  return { left, right, jcc: cmpJccFalse(op) };
}

// Materialise a constant-index element read into `reg` for use as a comparison
// operand. Restricted to literal indices so the two sides never share a scratch.
function materializeComparisonSide(expr: ts.Expression, reg: number, ctx: CompilerContext): boolean {
  if (expr.kind === ts.SyntaxKind.ElementAccessExpression || expr.kind === ts.SyntaxKind.PropertyAccessExpression)
    return emitExpr(reg, expr, ctx);
  return false;
}

// Emit register allocation / initialization for a variable declaration list.
export function declareVariables(list: ts.VariableDeclarationList, ctx: CompilerContext): void {
  for (const decl of list.declarations) {
    const name = (decl.name as ts.Identifier).text;
    if (!decl.initializer) continue;

    // String variable or string concatenation
    const strVal = evalString(decl.initializer, ctx);
    if (strVal !== null) {
      writeU32(ctx.stringVals, writeIntern(name, ctx), writeIntern(strVal, ctx) + 1);
      continue;
    }

    // `new Uint8Array(n)` and friends: allocate the backing bytes.
    if (decl.initializer.kind === ts.SyntaxKind.NewExpression) {
      const ne = decl.initializer as ts.NewExpression;
      if (allocBlob(name, ne, ctx)) continue;
      if (allocTypedArray(name, ne, ctx)) continue;
    }

    if (decl.initializer.kind === ts.SyntaxKind.ArrayLiteralExpression) {
      const elements = (decl.initializer as ts.ArrayLiteralExpression).elements;
      if (elements.some((element) => element.kind === ts.SyntaxKind.OmittedExpression)) continue;
      const base = allocArray(name, elements.length, ctx);
      if (base === undefined) continue;
      for (let i = 0; i < elements.length; i++) {
        const element = elements[i];
        const imm = numericLiteral(element);
        const string = evalString(element, ctx);
        if (imm !== undefined) {
          emitStoreElemImm(base, i * 8, imm, 8, ctx);
        } else if (string !== null) {
          emitStringAddr(R_RAX, string, ctx);
          emitStoreElem(base, i * 8, R_RAX, 8, ctx);
        } else if (emitExpr(R_RAX, element, ctx)) {
          emitStoreElem(base, i * 8, R_RAX, 8, ctx);
        }
      }
      continue;
    }

    if (decl.initializer.kind === ts.SyntaxKind.ObjectLiteralExpression) {
      const properties = (decl.initializer as ts.ObjectLiteralExpression).properties;
      if (properties.some((property) => property.kind !== ts.SyntaxKind.PropertyAssignment || property.name.kind !== ts.SyntaxKind.Identifier)) continue;
      const assignments = properties as ts.NodeArray<ts.PropertyAssignment>;
      const propertyIds = assignments.map((property) => writeIntern((property.name as ts.Identifier).text, ctx));
      const base = allocObject(name, propertyIds, ctx);
      if (base === undefined) continue;
      for (let i = 0; i < assignments.length; i++) {
        const value = assignments[i].initializer;
        const imm = numericLiteral(value);
        const string = evalString(value, ctx);
        if (imm !== undefined) emitStoreElemImm(base, i * 8, imm, 8, ctx);
        else if (string !== null) {
          emitStringAddr(R_RAX, string, ctx);
          emitStoreElem(base, i * 8, R_RAX, 8, ctx);
        }
        else if (emitExpr(R_RAX, value, ctx)) emitStoreElem(base, i * 8, R_RAX, 8, ctx);
      }
      continue;
    }

    const reg = writeNameId(writeIntern(name, ctx), ctx);
    if (reg === undefined) continue;

    if (decl.initializer.kind === ts.SyntaxKind.CallExpression) {
      const result = evalCall(decl.initializer as ts.CallExpression, ctx);
      if (result !== undefined && result !== reg) emitMovReg(reg, result, ctx);
    } else {
      emitExpr(reg, decl.initializer, ctx);
    }
  }
}

// Emit an increment step: i++, ++i, i--, --i, i += n, i = i + n, ...
export function emitStep(expr: ts.Expression, ctx: CompilerContext): void {
  switch (expr.kind) {
    case ts.SyntaxKind.PostfixUnaryExpression:
    case ts.SyntaxKind.PrefixUnaryExpression: {
      const ue = expr as ts.PrefixUnaryExpression | ts.PostfixUnaryExpression;
      if (ue.operand.kind !== ts.SyntaxKind.Identifier) return;
      const reg = readNameId(readIntern((ue.operand as ts.Identifier).text, ctx), ctx);
      if (reg === undefined) return;
      if (ue.operator === ts.SyntaxKind.PlusPlusToken) emitAddImm(reg, 1, ctx);
      else if (ue.operator === ts.SyntaxKind.MinusMinusToken) emitSubImm(reg, 1, ctx);
      return;
    }

    case ts.SyntaxKind.BinaryExpression:
      emitAssignment(expr as ts.BinaryExpression, ctx);
      return;
  }
}

// ─── for..of / for..in ───────────────────────────────────────────────────
// Values bound to the loop variable when unrolling an iteration.
type IterationValue = { str: string } | { imm: number } | { reg: number };

export function loopVarName(init: ts.ForInitializer): string | undefined {
  if (init.kind === ts.SyntaxKind.VariableDeclarationList) {
    const decls = (init as ts.VariableDeclarationList).declarations;
    if (decls.length !== 1 || decls[0].name.kind !== ts.SyntaxKind.Identifier) return undefined;
    return (decls[0].name as ts.Identifier).text;
  }
  if (init.kind === ts.SyntaxKind.Identifier) return (init as ts.Identifier).text;
  return undefined;
}

// Resolve a single expression to a value that can be bound to the loop variable.
function resolveValue(expr: ts.Expression, ctx: CompilerContext): IterationValue | undefined {
  const str = evalString(expr, ctx);
  if (str !== null) return { str };

  switch (expr.kind) {
    case ts.SyntaxKind.NumericLiteral:
      return { imm: Number((expr as ts.NumericLiteral).text) };

    case ts.SyntaxKind.PrefixUnaryExpression: {
      const ue = expr as ts.PrefixUnaryExpression;
      if (ue.operator === ts.SyntaxKind.MinusToken && ue.operand.kind === ts.SyntaxKind.NumericLiteral)
        return { imm: -Number((ue.operand as ts.NumericLiteral).text) };
      return undefined;
    }

    case ts.SyntaxKind.Identifier: {
      const reg = readNameId(readIntern((expr as ts.Identifier).text, ctx), ctx);
      return reg !== undefined ? { reg } : undefined;
    }
  }
  return undefined;
}

// `for..of` iterates array elements, or the characters of a string.
export function resolveValues(expr: ts.Expression, ctx: CompilerContext): IterationValue[] | undefined {
  if (expr.kind === ts.SyntaxKind.ArrayLiteralExpression) {
    const out: IterationValue[] = [];
    for (const el of (expr as ts.ArrayLiteralExpression).elements) {
      const v = resolveValue(el, ctx);
      if (!v) return undefined;
      out.push(v);
    }
    return out;
  }

  const str = evalString(expr, ctx);
  if (str !== null) return [...str].map((ch) => ({ str: ch }));
  return undefined;
}

// `for..in` iterates object keys, or an array's index keys.
export function resolveKeys(expr: ts.Expression): string[] | undefined {
  if (expr.kind === ts.SyntaxKind.ArrayLiteralExpression)
    return (expr as ts.ArrayLiteralExpression).elements.map((_, i) => String(i));

  if (expr.kind === ts.SyntaxKind.ObjectLiteralExpression) {
    const keys: string[] = [];
    for (const prop of (expr as ts.ObjectLiteralExpression).properties) {
      const name = (prop as ts.PropertyAssignment | ts.ShorthandPropertyAssignment).name;
      if (!name) return undefined;
      if (name.kind === ts.SyntaxKind.Identifier ||
          name.kind === ts.SyntaxKind.StringLiteral ||
          name.kind === ts.SyntaxKind.NumericLiteral)
        keys.push((name as ts.Identifier | ts.StringLiteral | ts.NumericLiteral).text);
      else
        return undefined; // computed key
    }
    return keys;
  }
  return undefined;
}

// Bind an unrolled iteration value to the loop variable.
export function bindIteration(name: string, value: IterationValue, ctx: CompilerContext): void {
  if ("str" in value) {
    writeU32(ctx.stringVals, writeIntern(name, ctx), writeIntern(value.str, ctx) + 1);
    return;
  }
  const reg = writeNameId(writeIntern(name, ctx), ctx);
  if (reg === undefined) return;
  if ("imm" in value) emitMovImm(reg, value.imm, ctx);
  else emitMovReg(reg, value.reg, ctx);
}
