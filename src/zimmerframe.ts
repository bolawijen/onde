import * as ts from "typescript";
import * as globals from "./globals";
import * as builtins from "./builtins";
import { CompilerContext } from "./types";

export function walkRoot(sf: ts.SourceFile, ctx: CompilerContext) {
  walk(sf, ctx);
}

// String constants table (parallel DoD flat arrays)
const stringKeys: string[] = [];
const stringVals: string[] = [];

function getStringVar(name: string): string | undefined {
  const idx = stringKeys.indexOf(name);
  return idx !== -1 ? stringVals[idx] : undefined;
}

function setStringVar(name: string, val: string): void {
  const idx = stringKeys.indexOf(name);
  if (idx !== -1) {
    stringVals[idx] = val;
  } else {
    stringKeys.push(name);
    stringVals.push(val);
  }
}

function evalString(expr: ts.Expression): string | null {
  switch (expr.kind) {
    case ts.SyntaxKind.StringLiteral:
      return (expr as ts.StringLiteral).text;

    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return (expr as ts.NoSubstitutionTemplateLiteral).text;

    case ts.SyntaxKind.Identifier: {
      const name = (expr as ts.Identifier).text;
      return getStringVar(name) ?? null;
    }

    case ts.SyntaxKind.BinaryExpression: {
      const be = expr as ts.BinaryExpression;
      if (be.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = evalString(be.left);
        const right = evalString(be.right);
        if (left !== null && right !== null) {
          return left + right;
        }
      }
      return null;
    }

    case ts.SyntaxKind.TemplateExpression: {
      const te = expr as ts.TemplateExpression;
      let result = te.head.text;
      for (const span of te.templateSpans) {
        const val = evalString(span.expression);
        if (val === null) return null;
        result += val + span.literal.text;
      }
      return result;
    }

    default:
      return null;
  }
}

export function writeVar(ctx: CompilerContext, name: string): number {
  let idx = ctx.internPool.indexOf(name);
  if (idx === -1) {
    idx = ctx.internPool.length;
    ctx.internPool.push(name);
  }
  return 12 + idx;
}

export function readVar(ctx: CompilerContext, name: string): number | undefined {
  const idx = ctx.internPool.indexOf(name);
  return idx !== -1 ? 12 + idx : undefined;
}

function resolveArg(arg: ts.Expression, ctx: CompilerContext): any {
  switch (arg.kind) {
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NumericLiteral:
      return arg;

    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return { kind: ts.SyntaxKind.StringLiteral, text: (arg as ts.NoSubstitutionTemplateLiteral).text };

    case ts.SyntaxKind.ArrayLiteralExpression:
      return (arg as ts.ArrayLiteralExpression).elements.map((e) => resolveArg(e, ctx));

    case ts.SyntaxKind.BinaryExpression:
    case ts.SyntaxKind.TemplateExpression: {
      const str = evalString(arg);
      if (str !== null) {
        return { kind: ts.SyntaxKind.StringLiteral, text: str };
      }
      return arg;
    }

    case ts.SyntaxKind.Identifier: {
      const name = (arg as ts.Identifier).text;
      const strVal = getStringVar(name);
      if (strVal !== undefined) {
        return { kind: ts.SyntaxKind.StringLiteral, text: strVal };
      }
      return readVar(ctx, name) ?? arg;
    }

    default:
      return arg;
  }
}

function evalCall(callExpr: ts.CallExpression, ctx: CompilerContext): any {
  const args = callExpr.arguments.map((a) => resolveArg(a, ctx));
  const callee = callExpr.expression;

  // module.method(...)
  if (callee.kind === ts.SyntaxKind.PropertyAccessExpression) {
    const pa = callee as ts.PropertyAccessExpression;
    const mod = (pa.expression as ts.Identifier).text;
    const method = pa.name.text;
    return globals[mod]?.[method]?.(ctx, args);
  }

  // importedFn(...)
  if (callee.kind === ts.SyntaxKind.Identifier) {
    const name = (callee as ts.Identifier).text;
    const fn = ctx.imports[name];
    if (fn) return fn(ctx, args);
  }
}

function walk(node: ts.Node, ctx: CompilerContext) {
  const deep = (node: any) => {
    for (const child of node.statements)
      walk(child, ctx);
  };

  switch (node.kind) {
    case ts.SyntaxKind.SourceFile: {
      stringKeys.length = 0;
      stringVals.length = 0;
      return deep(node);
    }

    case ts.SyntaxKind.ImportDeclaration: {
      const imp = node as ts.ImportDeclaration;
      const spec = (imp.moduleSpecifier as ts.StringLiteral).text;
      const specModule = builtins[spec] || globals[spec];
      if (!specModule) return;
      const bindings = (imp.importClause?.namedBindings as ts.NamedImports)?.elements;
      if (bindings) {
        for (const elem of bindings)
          ctx.imports[elem.name.text] = specModule[elem.name.text];
      }
      return;
    }

    // const x = 42 or const x = fn(...) or const y = x or const s = "a" + "b"
    case ts.SyntaxKind.VariableStatement: {
      const vs = node as ts.VariableStatement;
      for (const decl of vs.declarationList.declarations) {
        const name = (decl.name as ts.Identifier).text;
        if (!decl.initializer) continue;

        // String variable or string concatenation
        const strVal = evalString(decl.initializer);
        if (strVal !== null) {
          setStringVar(name, strVal);
          continue;
        }

        const reg = writeVar(ctx, name);

        switch (decl.initializer.kind) {
          case ts.SyntaxKind.CallExpression:
            evalCall(decl.initializer as ts.CallExpression, ctx);
            break;

          case ts.SyntaxKind.NumericLiteral: {
            const val = Number((decl.initializer as ts.NumericLiteral).text);
            // mov r<reg>d, imm32  (e.g. r12d: 0x41, 0xbc, imm32)
            const regOpcode = 0xbc + (reg - 12);
            ctx.instructs.push(0x41, regOpcode, val & 0xff, (val >> 8) & 0xff, (val >> 16) & 0xff, (val >> 24) & 0xff);
            break;
          }

          case ts.SyntaxKind.Identifier: {
            const srcName = (decl.initializer as ts.Identifier).text;
            const srcReg = readVar(ctx, srcName);
            if (srcReg !== undefined) {
              // mov r<dest>, r<src>  (e.g. mov r13, r12: 0x4d, 0x89, 0xe5)
              const modrm = 0xc0 | ((srcReg - 8) << 3) | (reg - 8);
              ctx.instructs.push(0x4d, 0x89, modrm);
            }
            break;
          }
        }
      }
      return;
    }

    case ts.SyntaxKind.ExpressionStatement: {
      const es = node as ts.ExpressionStatement;
      if (es.expression.kind === ts.SyntaxKind.CallExpression) {
        evalCall(es.expression as ts.CallExpression, ctx);
      }
      return;
    }
  }
}
