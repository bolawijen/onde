import { test, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { compile } from "../harness";

async function runCase(name: string, output: string): Promise<{ stdout: string; exitCode: number }> {
  const source = readFileSync(`tests/compile/cases/${name}.ts`, "utf8");
  const bin = await compile(source, output);
  try {
    const proc = Bun.spawn([`./${bin}`], { stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(proc.stdout).text();
    return { stdout, exitCode: await proc.exited };
  } finally {
    rmSync(bin, { force: true });
  }
}

test("process.exit: true branch exits with requested status 7", async () => {
  const result = await runCase("if-exit-a", "tests/bin/test_if_exit_a");
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(7);
});

test("process.exit: false branch falls through and exits successfully", async () => {
  const result = await runCase("if-exit-b", "tests/bin/test_if_exit_b");
  expect(result.stdout).toBe("alive\n");
  expect(result.exitCode).toBe(0);
});

test("process.exit: true block logs before exiting with status 3", async () => {
  const result = await runCase("if-exit-c", "tests/bin/test_if_exit_c");
  expect(result.stdout).toBe("yes\n");
  expect(result.exitCode).toBe(3);
});

test("process.exit: status 256 is masked to zero", async () => {
  const result = await runCase("process-exit-256", "tests/bin/test_process_exit_256");
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(0);
});

test("process.exit: status -1 is masked to 255", async () => {
  const result = await runCase("process-exit-negative", "tests/bin/test_process_exit_negative");
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(255);
});

test("process.exit: accepts a variable register as the status", async () => {
  const result = await runCase("process-exit-variable", "tests/bin/test_process_exit_variable");
  expect(result.stdout).toBe("");
  expect(result.exitCode).toBe(7);
});
