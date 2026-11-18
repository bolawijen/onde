import { test, expect } from "bun:test";
import { parse } from "../harness";
import { readIntern } from "../../src/internals/name";
import { isModule, resolveMember } from "../../src/plugin";

const names = ['openSync', 'writeSync', 'closeSync']

test("importDecl", () => {
  const ctx = parse(`import { ${names} } from "fs";`);
  for (const name of names)
    expect(ctx.imports.includes(readIntern(name, ctx))).toBeTruthy();
});

test("import from globals (console, process)", () => {
  const ctx = parse(`import { log } from "console"; import { cwd } from 'process'`);
  expect(ctx.imports.includes(readIntern('log', ctx))).toBeTruthy();
  expect(ctx.imports.includes(readIntern('cwd', ctx))).toBeTruthy();
});

test("multiple imports from same module", () => {
  const ctx = parse(`
    import { openSync } from "fs";
    import { writeSync, closeSync } from "fs";
  `);
  for (const name of names)
    expect(ctx.imports.includes(readIntern(name, ctx))).toBeTruthy();
});

test("import from 'process' (builtin)", () => {
  const ctx = parse(`import { exit } from "process";`);
  expect(ctx.imports.includes(readIntern('exit', ctx))).toBeTruthy();
});

test("plugin: enabled console module resolves", () => {
  const ctx = parse("");

  expect(isModule("console", ctx)).toBe(true);
});

test("plugin: console log member resolves to a codegen function", () => {
  const ctx = parse("");

  expect(typeof resolveMember("console", "log", ctx)).toBe("function");
});

test("plugin: unknown module member does not resolve", () => {
  const ctx = parse("");

  expect(resolveMember("console", "missing", ctx)).toBeUndefined();
});

test("plugin: imported named member emits code through the plugin", () => {
  const ctx = parse('import { log } from "console"; log("plugin");');
  const id = readIntern("log", ctx);

  expect(ctx.imports.includes(id)).toBe(true);
  expect(ctx.instructs.length).toBe(22);
});
