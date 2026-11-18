import * as ts from "typescript";

// ─── internal operator kinds ─────────────────────────────────────────────
// Stable, self-owned numbering. The backend keys its tables off these instead
// of the parser's SyntaxKind so the parser stays a swappable frontend detail.
export enum CmpOp {
  Lt,
  Le,
  Gt,
  Ge,
  Eq,
  Ne,
}

export enum BinOp {
  Add,
  Sub,
  Mul,
  Div,
  Mod,
}

// Comparison operators with their operands swapped: `a < b` ⇔ `b > a`.
const SWAP_CMP: CmpOp[] = [
  CmpOp.Gt, // Lt -> Gt
  CmpOp.Ge, // Le -> Ge
  CmpOp.Lt, // Gt -> Lt
  CmpOp.Le, // Ge -> Le
  CmpOp.Eq, // Eq -> Eq
  CmpOp.Ne, // Ne -> Ne
];

export function swapCmp(op: CmpOp): CmpOp {
  return SWAP_CMP[op];
}

// ─── bootstrap adapter: ts.SyntaxKind -> internal op ─────────────────────
// Bootstrap only. When the in-house parser replaces `typescript`, this file is
// the only thing that has to be rewritten.
const CMP_OP: { [kind: number]: CmpOp } = {
  [ts.SyntaxKind.LessThanToken]: CmpOp.Lt,
  [ts.SyntaxKind.LessThanEqualsToken]: CmpOp.Le,
  [ts.SyntaxKind.GreaterThanToken]: CmpOp.Gt,
  [ts.SyntaxKind.GreaterThanEqualsToken]: CmpOp.Ge,
  [ts.SyntaxKind.EqualsEqualsToken]: CmpOp.Eq,
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: CmpOp.Eq,
  [ts.SyntaxKind.ExclamationEqualsToken]: CmpOp.Ne,
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: CmpOp.Ne,
};

export function cmpOpOf(kind: ts.SyntaxKind): CmpOp | undefined {
  return CMP_OP[kind];
}

const BIN_OP: { [kind: number]: BinOp } = {
  [ts.SyntaxKind.PlusToken]: BinOp.Add,
  [ts.SyntaxKind.MinusToken]: BinOp.Sub,
  [ts.SyntaxKind.AsteriskToken]: BinOp.Mul,
  [ts.SyntaxKind.SlashToken]: BinOp.Div,
  [ts.SyntaxKind.PercentToken]: BinOp.Mod,
};

export function binOpOf(kind: ts.SyntaxKind): BinOp | undefined {
  return BIN_OP[kind];
}

const COMPOUND_OP: { [kind: number]: BinOp } = {
  [ts.SyntaxKind.PlusEqualsToken]: BinOp.Add,
  [ts.SyntaxKind.MinusEqualsToken]: BinOp.Sub,
  [ts.SyntaxKind.AsteriskEqualsToken]: BinOp.Mul,
  [ts.SyntaxKind.SlashEqualsToken]: BinOp.Div,
  [ts.SyntaxKind.PercentEqualsToken]: BinOp.Mod,
};

export function compoundOpOf(kind: ts.SyntaxKind): BinOp | undefined {
  return COMPOUND_OP[kind];
}
