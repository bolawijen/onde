import ts from "typescript";
import { walkRoot } from "../src/zimmerframe";
import { rmSync, mkdirSync } from "fs";

export function parseImports(src: string): Record<string, any> {
  const sf = ts.createSourceFile("test.ts", src, ts.ScriptTarget.Latest, true);
  const ctx: any = {
    instructs: [],
    patchIndexes: [],
    patchOffsets: [],
    codeLength: 0,
    imports: {},
    internPool: [],
  };
  walkRoot(sf, ctx)
  return ctx.imports;
}

export async function compile(src: string, out: string = "tests/bin/test"): Promise<string> {
  if (out.startsWith("bin/")) {
    out = out.replace(/^bin\//, "tests/bin/");
  } else if (!out.startsWith("tests/bin/")) {
    out = `tests/bin/${out}`;
  }
  mkdirSync("tests/bin", { recursive: true });
  out += Bun.nanoseconds();
  const tmp = `${out}.tmp.src.ts.${Bun.nanoseconds()}`;
  await Bun.write(tmp, src);
  await Bun.$`bun src/onde.ts ${tmp} -o ${out}`;
  await Bun.$`chmod +x ${out}`;
  rmSync(tmp, { force: true });
  return out;
}
