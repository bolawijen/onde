import ts from "typescript";
import zf from "../src/zimmerframe";
import "../src/plugins/console";
import "../src/plugins/process";
import "../src/plugins/fs";
import "../src/plugins/bun";
import * as internals from "../src/internals";
import { loadModules } from "../src/plugin";
import { rmSync, mkdirSync } from "fs";
import { CompilerContext } from "../src/internals/context";

export function parse(src: string): CompilerContext {
  const sf = ts.createSourceFile("test.ts", src, ts.ScriptTarget.Latest, true);
  const ctx = internals.createContext()
  ctx.modules = loadModules()
  zf(ctx).walk(sf)
  return ctx;
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
