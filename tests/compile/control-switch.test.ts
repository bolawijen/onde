import { test, expect } from "bun:test";
import { compile } from "../harness";
import { rmSync } from "fs";

test("switch: selects a matching case", async () => {
  const out = await compile(`const value = 2; switch (value) { case 1: console.log("one"); break; case 2: console.log("two"); break; }`, "tests/bin/test_switch_match");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("two");
});

test("switch: selects default when no case matches", async () => {
  const out = await compile(`const value = 4; switch (value) { case 1: console.log("one"); break; default: console.log("default"); }`, "tests/bin/test_switch_default");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("default");
});

test("switch: skips the switch when no case or default matches", async () => {
  const out = await compile(`const value = 4; switch (value) { case 1: console.log("one"); } console.log("after");`, "tests/bin/test_switch_no_match");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("after");
});

test("switch: break exits the switch", async () => {
  const out = await compile(`switch (1) { case 1: console.log("case"); break; default: console.log("wrong"); } console.log("after");`, "tests/bin/test_switch_break");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("case\nafter");
});

test("switch: cases fall through until break", async () => {
  const out = await compile(`switch (1) { case 1: console.log("one"); case 2: console.log("two"); break; default: console.log("wrong"); }`, "tests/bin/test_switch_fallthrough");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("one\ntwo");
});

test("switch: break exits only the nested switch", async () => {
  const out = await compile(`for (let i = 0; i < 2; i++) { switch (i) { case 0: break; } console.log("body"); }`, "tests/bin/test_switch_nested_break");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("body\nbody");
});

test("switch: continue still targets the enclosing loop", async () => {
  const out = await compile(`for (let i = 0; i < 3; i++) { switch (i) { case 1: continue; } console.log("body"); }`, "tests/bin/test_switch_continue");
  const result = (await Bun.$`./${out}`.text()).trim();
  rmSync(out, { force: true });
  expect(result).toBe("body\nbody");
});
