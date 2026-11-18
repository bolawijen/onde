import { test, expect } from "bun:test";
import { rmSync } from "fs";
import { compile } from "../harness";

async function output(source: string): Promise<string> {
  const out = await compile(source, "tests/bin/typeof");
  try {
    return (await Bun.$`./${out}`.text()).trim();
  } finally {
    rmSync(out, { force: true });
  }
}

test("typeof: number literal", async () => {
  expect(await output(`console.log(typeof 12);`)).toBe("number");
});

test("typeof: string literal", async () => {
  expect(await output(`console.log(typeof "x");`)).toBe("string");
});

test("typeof: boolean literal", async () => {
  expect(await output(`console.log(typeof true);`)).toBe("boolean");
});

test("typeof: array literal", async () => {
  expect(await output(`console.log(typeof [1]);`)).toBe("object");
});

test("typeof: object literal", async () => {
  expect(await output(`console.log(typeof { value: 1 });`)).toBe("object");
});

test("typeof: undefined", async () => {
  expect(await output(`console.log(typeof undefined);`)).toBe("undefined");
});

test("typeof: declared numeric variable", async () => {
  expect(await output(`let value = 1; console.log(typeof value);`)).toBe("number");
});

test("typeof: declared function", async () => {
  expect(await output(`function value() {} console.log(typeof value);`)).toBe("function");
});
