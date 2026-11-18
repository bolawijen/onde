import { test, expect } from "bun:test";
import { compile } from "../harness";
import { readFileSync, rmSync } from "fs";
import { parse } from "../harness";
import { readIntern } from "../../src/internals/name";

// ─── Bytecode structure
test("blob: the parts' bytes are interned into the data segment", async () => {
  const bin = await compile(`let b = new Blob(["hello world"]);`, "tests/bin/test_blob_bytes");
  const bytes = readFileSync(bin);
  rmSync(bin, { force: true });

  expect(bytes.indexOf(Buffer.from("hello world"))).toBeGreaterThanOrEqual(0xb0);
});

// ─── End-to-End
test("blob: .size folds to the byte count", async () => {
  const src = `
    let b = new Blob(["hi"]);
    let n = b.size;
    if (n == 2) console.log("sized");
  `;
  const out = await compile(src, "tests/bin/test_blob_size");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("sized");
});

test("blob: unaccommodated members are a no-op, not a compile failure", async () => {
  const src = `
    let b = new Blob(["hi"]);
    b.slice(0, 2);
    let s = b.type;
    if (s == 0) console.log("noop");
  `;
  const out = await compile(src, "tests/bin/test_blob_noop");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });

  expect(result).toBe("noop");
});

test("blob: empty parts produce a zero byte length", () => {
  const ctx = parse("const data = new Blob([]);");
  const id = readIntern("data", ctx);

  expect(ctx.blobLengths[id]).toBe(0);
});

test("blob: parts concatenate and type bytes have a separate offset", () => {
  const ctx = parse('const data = new Blob(["ab", "cd"], { type: "text/plain" });');
  const id = readIntern("data", ctx);
  const content = ctx.internPool.bytes().subarray(ctx.blobOffsets[id], ctx.blobOffsets[id] + 5);
  const typeOffset = ctx.blobTypes[id];
  const typeBytes = ctx.internPool.bytes().subarray(typeOffset, typeOffset + 11);

  expect(ctx.blobLengths[id]).toBe(4);
  expect(new TextDecoder().decode(content)).toBe("abcd\0");
  expect(new TextDecoder().decode(typeBytes)).toBe("text/plain\0");
});
