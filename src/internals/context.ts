import { Bytes } from "./bytes";

// A module contributed by an onde extension (a Bun-style plugin). `specifier`
// is the name the module is imported under and the namespace it is called
// through (`<specifier>.<member>(...)`); `members` maps each exported name to
// its codegen function.
export type OndeModule = {
  specifier: string,
  loader: string,
  members: { [name: string]: (argList: number, ctx: CompilerContext) => any },
};

export type CompilerContext = {
  instructs: Bytes,

  // Compile-time symbol/string bytes; this table is never emitted into ELF.
  symbolPool: Bytes,
  internPool: Bytes,
  internStarts: number[],
  internLengths: number[],
  dataOffsets: number[],

  builtins: Function[],
  namedImports: number[],

  importOffsets: number[],

  callArgStarts: number[];
  callArgCounts: number[];
  argKinds: Bytes;
  argVals: Bytes;
  argNumbers: number[];
  stringVals: Bytes;
  bufferSizes: number[];
  bufferSigned: number[];
  bufferLengths: number[];
  objectPropStarts: number[];
  objectPropCounts: number[];
  objectPropNames: number[];
  blobLengths: number[];
  blobOffsets: number[];
  blobTypes: number[];

  patchOffsets: number[],
  patchIndexes: number[],
  patchKinds: number[],

  identifiers: number[],
  identifierPaths: number[],
  imports: number[],

  // Name ids are indexes into the intern table; variable register = 12 + index.
  vars: number[],


  // Function/call compile state. One flat record per top-level function,
  // indexed by function id (fi). funcStmts holds the index into sf.statements
  // of each function rather than the node pointer itself.
  funcNames: number[],
  funcParams: number[][],
  funcStmts: number[],
  funcOffsets: number[],
  callOperands: number[],
  callFuncs: number[],
  loopBreakJumps: number[],
  loopContinueJumps: number[],
  loopBreakStarts: number[],
  loopContinueStarts: number[],

  // Transient per-function scratch: non-null only while a body is emitted.
  localNames: number[] | null,
  returnJumps: number[] | null,

  // Packed global compile-time flags: a bitset over the FLAG_* bit masks below.
  // Test a flag with `flags & FLAG_X`, set it with `flags |= FLAG_X`.
  flags: number,

  // Modules registered by the enabled extensions. Module resolution
  // (`import ... from "<spec>"` and `<spec>.<member>(...)`) consults this list.
  modules: OndeModule[],
}

export default function create(): CompilerContext {
  return {
    instructs: new Bytes(),

    symbolPool: new Bytes(),
    internPool: new Bytes(),
    internStarts: [],
    internLengths: [],
    dataOffsets: [],
    builtins: [],
    namedImports: [],

    importOffsets: [],

    // func calls
    callArgStarts: [],
    callArgCounts: [],
    argKinds: new Bytes(),
    argVals: new Bytes(),
    argNumbers: [],
    stringVals: new Bytes(),
    bufferSizes: [],
    bufferSigned: [],
    bufferLengths: [],
    objectPropStarts: [],
    objectPropCounts: [],
    objectPropNames: [],
    blobLengths: [],
    blobOffsets: [],
    blobTypes: [],

    // Relocations
    patchIndexes: [],
    patchOffsets: [],
    patchKinds: [],

    identifiers: [],
    identifierPaths: [],
    imports: [],
    vars: [],

    funcNames: [],
    funcParams: [],
    funcStmts: [],
    funcOffsets: [],
    callOperands: [],
    callFuncs: [],
    loopBreakJumps: [],
    loopContinueJumps: [],
    loopBreakStarts: [],
    loopContinueStarts: [],

    localNames: null,
    returnJumps: null,

    flags: 0,

    modules: [],
  }
}
