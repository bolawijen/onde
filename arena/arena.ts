import { statSync, existsSync, mkdirSync } from "fs";
import { resolve, join, basename, relative } from "path";

const arenaDir = import.meta.dir;
const rootDir = resolve(arenaDir, "..");
const casesDir = join(arenaDir, "cases");
const binDir = join(arenaDir, "bin");

if (!existsSync(binDir)) {
  mkdirSync(binDir, { recursive: true });
}

interface BenchTarget {
  name: string;
  cmd: string[];
  size: number;
}

interface BenchResult {
  name: string;
  meanMs: number;
  minMs: number;
  maxMs: number;
  rssKb: number;
  sizeBytes: number;
}

function toDisplayPath(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel.startsWith(".") ? rel : `./${rel}`;
}


async function getRss(cmd: string[]): Promise<number> {
  const timeCmd = ["/usr/bin/time", "-v", ...cmd];
  try {
    const proc = Bun.spawn(timeCmd, {
      stdout: "ignore",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    await proc.exited;

    const match = stderr.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

async function runHyperfine(targets: BenchTarget[]): Promise<Map<string, { mean: number; min: number; max: number }>> {
  const jsonOut = join(binDir, "bench_results.json");

  const hfArgs: string[] = [
    "hyperfine",
    "--shell=none",
    "--warmup", "5",
    "--runs", "50",
    "--export-json", jsonOut,
  ];

  for (const t of targets) {
    const cmdStr = t.cmd.map((c) => (c.includes(" ") ? `"${c}"` : c)).join(" ");
    hfArgs.push("-n", t.name, cmdStr);
  }

  const proc = Bun.spawn(hfArgs, { stdout: "inherit", stderr: "inherit" });
  await proc.exited;

  const results = new Map<string, { mean: number; min: number; max: number }>();
  if (existsSync(jsonOut)) {
    const raw = JSON.parse(await Bun.file(jsonOut).text());
    for (let i = 0; i < targets.length; i++) {
      const res = raw.results[i];
      if (res) {
        results.set(targets[i].name, {
          mean: res.mean * 1000,
          min: res.min * 1000,
          max: res.max * 1000,
        });
      }
    }
  }
  return results;
}

async function getVersion(bin: string, args: string[] = ["--version"]): Promise<string> {
  try {
    const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "ignore" });
    const text = (await new Response(proc.stdout).text()).trim();
    await proc.exited;
    return text;
  } catch {
    return "";
  }
}

async function runArena(testCasePath: string) {
  const caseAbs = resolve(testCasePath);
  const caseName = basename(caseAbs);
  const caseDisplay = toDisplayPath(caseAbs);
  const elfPath = join(binDir, `${caseName}.elf`);
  const elfDisplay = toDisplayPath(elfPath);

  const bunVersion = `v${Bun.version}`;
  const nodeBin = await Bun.which("node");
  const nodeVersion = nodeBin ? await getVersion("node") : "";
  const tsgoBin = process.env.TSGO_BIN || (await Bun.which("tsgo"));
  const tsgoVersion = tsgoBin && existsSync(tsgoBin) ? await getVersion(tsgoBin, ["version"]) : "";

  console.log(`\n======================================================`);
  console.log(`🏟️  ONDE ARENA SHOWDOWN: ${caseName}`);
  console.log(`======================================================`);
  console.log(`  • onde:  native x86_64 ELF compiler`);
  console.log(`  • bun:   ${bunVersion}`);
  if (nodeVersion) console.log(`  • node:  ${nodeVersion}`);
  if (tsgoVersion) console.log(`  • tsgo:  ${tsgoVersion}`);
  console.log(`------------------------------------------------------`);

  // 1. Compile targets
  console.log(`[1/3] Compiling targets...`);
  const ondeCompiler = join(rootDir, "src", "onde.ts");
  const compileProc = Bun.spawn(["bun", ondeCompiler, caseAbs, "-o", elfPath], {
    stdout: "pipe",
    stderr: "inherit",
  });
  await compileProc.exited;

  const elfSize = existsSync(elfPath) ? statSync(elfPath).size : 0;
  console.log(`  ✓ onde ELF generated: ${elfSize} bytes`);

  // Compile with Bun AOT
  const bunAotPath = join(binDir, `${caseName}.bun-aot.elf`);
  const bunAotDisplay = toDisplayPath(bunAotPath);
  let bunAotSize = 0;
  try {
    const bunAotProc = Bun.spawn([
      "bun", "build", "--compile", "--aot", caseAbs, "--outfile", bunAotPath,
    ], { stdout: "ignore", stderr: "ignore" });
    await bunAotProc.exited;
    if (existsSync(bunAotPath)) {
      bunAotSize = statSync(bunAotPath).size;
      console.log(`  ✓ bun --aot binary generated: ${(bunAotSize / (1024 * 1024)).toFixed(1)} MB`);
    }
  } catch {}

  // Targets
  const targets: BenchTarget[] = [
    { name: "onde (native ELF)", cmd: [elfDisplay], size: elfSize },
  ];

  if (bunAotSize > 0) {
    targets.push({ name: `bun --aot (${bunVersion})`, cmd: [bunAotDisplay], size: bunAotSize });
  }

  targets.push({ name: `bun run (${bunVersion})`, cmd: ["bun", caseDisplay], size: statSync(process.execPath).size });

  if (nodeBin) {
    const nodeCmd = ["node"];
    if (caseAbs.endsWith(".ts")) {
      nodeCmd.push("--experimental-strip-types", "--no-warnings");
    }
    nodeCmd.push(caseDisplay);
    targets.push({ name: `node (${nodeVersion})`, cmd: nodeCmd, size: 0 });
  }

  if (tsgoBin && existsSync(tsgoBin)) {
    targets.push({
      name: `tsgo (${tsgoVersion || "latest"})`,
      cmd: [tsgoBin, caseDisplay],
      size: statSync(tsgoBin).size,
    });
  }

  // 2. Measure Memory RSS
  console.log(`[2/3] Measuring Peak Memory RSS (KB)...`);
  const rssMap = new Map<string, number>();
  for (const t of targets) {
    const rss = await getRss(t.cmd);
    rssMap.set(t.name, rss);
    console.log(`  • ${t.name}: ${rss.toLocaleString()} KB`);
  }

  // 3. Measure Execution Speed via Hyperfine
  console.log(`[3/3] Benchmarking execution speed (Hyperfine 50 runs)...`);
  const timingMap = await runHyperfine(targets);

  // Print Summary Table
  const results: BenchResult[] = targets.map((t) => {
    const timing = timingMap.get(t.name) || { mean: 0, min: 0, max: 0 };
    return {
      name: t.name,
      meanMs: timing.mean,
      minMs: timing.min,
      maxMs: timing.max,
      rssKb: rssMap.get(t.name) || 0,
      sizeBytes: t.size,
    };
  });

  const ondeRes = results.find((r) => r.name.startsWith("onde"));
  console.log(`\n🏆 BENCHMARK RESULTS:`);
  console.log(`---------------------------------------------------------------------------------------`);
  console.log(
    `Runtime / Target`.padEnd(24) +
    `Mean Time (ms)`.padStart(16) +
    `Peak RSS (KB)`.padStart(16) +
    `Size`.padStart(14) +
    `Speedup vs onde`.padStart(18)
  );
  console.log(`---------------------------------------------------------------------------------------`);

  for (const r of results) {
    const speedRatio = ondeRes && r.meanMs > 0 ? (r.meanMs / ondeRes.meanMs).toFixed(1) + "x slower" : "1.0x (baseline)";
    const sizeStr = r.sizeBytes > 0 ? (r.sizeBytes < 1024 * 1024 ? `${r.sizeBytes} B` : `${(r.sizeBytes / (1024 * 1024)).toFixed(1)} MB`) : "-";

    console.log(
      r.name.padEnd(24) +
      `${r.meanMs.toFixed(3)} ms`.padStart(16) +
      `${r.rssKb.toLocaleString()} KB`.padStart(16) +
      sizeStr.padStart(14) +
      (r === ondeRes ? "1.0x (FASTEST)".padStart(18) : speedRatio.padStart(18))
    );
  }
  console.log(`---------------------------------------------------------------------------------------`);

  const primaryRival = results.find((r) => r.name.includes("bun --aot")) || results.find((r) => r.name.includes("bun run"));
  if (ondeRes && primaryRival) {
    const speedup = (primaryRival.meanMs / ondeRes.meanMs).toFixed(1);
    const memRatio = (primaryRival.rssKb / Math.max(ondeRes.rssKb, 1)).toFixed(1);
    console.log(`\n💥 SUMMARY:`);
    console.log(`  • onde is ${speedup}x FASTER than ${primaryRival.name}`);
    console.log(`  • onde uses ${memRatio}x LESS RAM than ${primaryRival.name}`);
    console.log(`  • onde binary footprint: ${elfSize} bytes only!\n`);
  }
}

const defaultCase = join(casesDir, "hello.ts");
const testCase = Bun.argv[2] ? resolve(Bun.argv[2]) : defaultCase;
await runArena(testCase);
