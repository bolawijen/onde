export type CompilerContext = {
  instructs: number[],
  internPool: number[],
  exitCall: boolean,
  patchOffsets: number[],
  patchIndexes: number[],
  codeLength: number,
  imports: Record<string, any>,
}

export type CallArg = string & {
  text: any;
}
