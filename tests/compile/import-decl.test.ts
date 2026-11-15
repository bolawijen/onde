import { test, expect } from "bun:test";
import { parseImports } from "../harness";
import * as builtins from "../../src/builtins";

const names = ['openSync', 'writeSync', 'closeSync']

test("importDecl", () => {
  const imports = parseImports(`import { ${names} } from "fs";`);
  for (const name of names)
    expect(imports[name]).toBe(builtins.fs[name]);
});

test("import from globals (console, process)", () => {
  const imports = parseImports(`import { log } from "console"; import { cwd } from 'process'`);
  expect(imports.log).toBeTruthy();
  expect(imports.cwd).toBeTruthy();
});

test("import { nonexist } from 'fs' (name not in builtin → undefined)", () => {
  const imports = parseImports(`import { nonexist } from "fs";`);
  expect(imports.nonexist).toBeUndefined();
});

test("import { openSync } from 'unknown' (module not in builtins → skip)", () => {
  const imports = parseImports(`import { openSync } from "unknown";`);
  expect(imports.openSync).toBeUndefined();
});

test("multiple imports from same module", () => {
  const imports = parseImports(`
    import { openSync } from "fs";
    import { writeSync, closeSync } from "fs";
  `);
  for (const name of names)
    expect(imports[name]).toBe(builtins.fs[name]);
});

test("import from 'process' (builtin)", () => {
  const imports = parseImports(`import { exit } from "process";`);
  expect(imports.exit).toBe(builtins.process.exit);
});

test("no import → empty", () => {
  const imports = parseImports(`console.log("hilo");`);
  expect(Object.keys(imports).length).toBe(0);
});
