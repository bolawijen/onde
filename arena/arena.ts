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

// Warm-run timings, all in milliseconds.
interface Timings {
  mean: number;
  min: number;
  max: number;
  median: number;
  stddev: number;
}

// One-shot resource profile from the first (cold) execution of a target.
interface Resources {
  coldMs: number;
  rssKb: number;
  pageFaults: number;
  userMs: number;
  sysMs: number;
  instructions: number;
}

interface BenchResult extends Timings, Resources {
  name: string;
  sizeBytes: number;
}

function toDisplayPath(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel.startsWith(".") ? rel : `./${rel}`;
}

// "h:mm:ss" / "m:ss.ss" -> milliseconds.
function parseElapsed(text: string): number {
  const parts = text.trim().split(":").map(Number);
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return 0;
}

// Run `cmd` once under /usr/bin/time -v and harvest the resource profile:
// wall time, peak RSS, page faults and user+system CPU time. This first run
// doubles as the cold-start measurement (no warmup).
async function profileRun(cmd: string[], wantInstructions: boolean): Promise<Resources> {
  const res: Resources = { coldMs: 0, rssKb: 0, pageFaults: 0, userMs: 0, sysMs: 0, instructions: 0 };
  try {
    const proc = Bun.spawn(["/usr/bin/time", "-v", ...cmd], { stdout: "ignore", stderr: "pipe" });
    const err = await new Response(proc.stderr).text();
    await proc.exited;

    const rss = err.match(/Maximum resident set size \(kbytes\):\s*(\d+)/);
    const el = err.match(/Elapsed \(wall clock\) time \(h:mm:ss or m:ss\):\s*([\d:.]+)/);
    const user = err.match(/User time \(seconds\):\s*([\d.]+)/);
    const sys = err.match(/System time \(seconds\):\s*([\d.]+)/);
    const minor = err.match(/Minor \([^)]*\) page faults:\s*(\d+)/);
    const major = err.match(/Major \([^)]*\) page faults:\s*(\d+)/);

    if (rss) res.rssKb = parseInt(rss[1], 10);
    if (el) res.coldMs = parseElapsed(el[1]);
    if (user) res.userMs = parseFloat(user[1]) * 1000;
    if (sys) res.sysMs = parseFloat(sys[1]) * 1000;
    res.pageFaults = (minor ? parseInt(minor[1], 10) : 0) + (major ? parseInt(major[1], 10) : 0);
  } catch {}

  if (wantInstructions) res.instructions = await getInstructions(cmd);
  return res;
}

// `perf stat` is gated behind kernel perms (perf_event_paranoid); probe once so
// an unprivileged host simply skips the retired-instruction metric.
let perfAvailable: boolean | null = null;
async function hasPerf(): Promise<boolean> {
  if (perfAvailable !== null) return perfAvailable;
  try {
    const proc = Bun.spawn(["perf", "stat", "-e", "instructions", "true"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    perfAvailable = proc.exitCode === 0;
  } catch {
    perfAvailable = false;
  }
  return perfAvailable;
}

async function getInstructions(cmd: string[]): Promise<number> {
  try {
    const proc = Bun.spawn(["perf", "stat", "-x,", "-e", "instructions", "--", ...cmd], {
      stdout: "ignore",
      stderr: "pipe",
    });
    const err = await new Response(proc.stderr).text();
    await proc.exited;
    const m = err.match(/^(\d+),/m);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

async function runHyperfine(targets: BenchTarget[]): Promise<Map<string, Timings>> {
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

  const results = new Map<string, Timings>();
  if (existsSync(jsonOut)) {
    const raw = JSON.parse(await Bun.file(jsonOut).text());
    for (let i = 0; i < targets.length; i++) {
      const res = raw.results[i];
      if (res) {
        results.set(targets[i].name, {
          mean: res.mean * 1000,
          min: res.min * 1000,
          max: res.max * 1000,
          median: res.median * 1000,
          stddev: res.stddev * 1000,
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

function sizeStr(bytes: number): string {
  if (bytes <= 0) return "-";
  return bytes < 1024 * 1024 ? `${bytes} B` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function build(
  label: string,
  cmd: string[],
  outPath: string,
): Promise<number> {
  try {
    const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    if (existsSync(outPath)) {
      const size = statSync(outPath).size;
      console.log(`  ✓ ${label}: ${sizeStr(size)}`);
      return size;
    }
  } catch {}
  return 0;
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
  const denoBin = await Bun.which("deno");
  const denoVersion = denoBin ? (await getVersion("deno", ["--version"])).split("\n")[0] : "";
  const perfOk = await hasPerf();

  console.log(`\n======================================================`);
  console.log(`🏟️  ONDE ARENA SHOWDOWN: ${caseName}`);
  console.log(`======================================================`);
  console.log(`  • onde:  native x86_64 ELF compiler`);
  console.log(`  • bun:   ${bunVersion}`);
  if (nodeVersion) console.log(`  • node:  ${nodeVersion}`);
  if (denoVersion) console.log(`  • deno:  ${denoVersion}`);
  if (tsgoVersion) console.log(`  • tsgo:  ${tsgoVersion}`);
  console.log(`  • perf:  ${perfOk ? "retired instructions enabled" : "unavailable (skipping)"}`);
  console.log(`------------------------------------------------------`);

  // 1. Compile targets
  console.log(`[1/4] Compiling targets...`);
  const ondeCompiler = join(rootDir, "src", "onde.ts");
  const compileProc = Bun.spawn(["bun", ondeCompiler, caseAbs, "-o", elfPath], {
    stdout: "pipe",
    stderr: "inherit",
  });
  await compileProc.exited;
  const elfSize = existsSync(elfPath) ? statSync(elfPath).size : 0;
  console.log(`  ✓ onde native ELF: ${sizeStr(elfSize)}`);

  const bunAotPath = join(binDir, `${caseName}.bun-aot.elf`);
  const bunAotSize = elfSize > 0
    ? await build("bun --aot", ["bun", "build", "--compile", "--aot", caseAbs, "--outfile", bunAotPath], bunAotPath)
    : 0;

  const bunCcPath = join(binDir, `${caseName}.bun-cc.elf`);
  const bunCcSize = elfSize > 0
    ? await build("bun --compile", ["bun", "build", "--compile", caseAbs, "--outfile", bunCcPath], bunCcPath)
    : 0;

  // C baseline: only when a sibling .c source exists next to the case.
  const cSource = join(casesDir, caseName.replace(/\.ts$/, ".c"));
  const ccPath = join(binDir, `${caseName}.cc`);
  const ccSize = existsSync(cSource)
    ? await build("cc -O2", ["cc", "-O2", "-o", ccPath, cSource], ccPath)
    : 0;

  // 2. Assemble targets
  const targets: BenchTarget[] = [
    { name: "onde (native ELF)", cmd: [elfDisplay], size: elfSize },
  ];
  if (bunAotSize > 0) targets.push({ name: `bun --aot`, cmd: [toDisplayPath(bunAotPath)], size: bunAotSize });
  if (bunCcSize > 0) targets.push({ name: `bun --compile`, cmd: [toDisplayPath(bunCcPath)], size: bunCcSize });
  if (ccSize > 0) targets.push({ name: `cc -O2 (C)`, cmd: [toDisplayPath(ccPath)], size: ccSize });
  targets.push({ name: `bun run`, cmd: ["bun", caseDisplay], size: statSync(process.execPath).size });
  if (nodeBin) {
    const nodeCmd = ["node"];
    if (caseAbs.endsWith(".ts")) nodeCmd.push("--experimental-strip-types", "--no-warnings");
    nodeCmd.push(caseDisplay);
    targets.push({ name: `node (${nodeVersion})`, cmd: nodeCmd, size: 0 });
  }
  if (denoBin) targets.push({ name: `deno (${denoVersion})`, cmd: [denoBin, "run", caseDisplay], size: statSync(denoBin).size });
  if (tsgoBin && existsSync(tsgoBin)) targets.push({ name: `tsgo`, cmd: [tsgoBin, caseDisplay], size: statSync(tsgoBin).size });

  // 3. Cold-start + resource profile
  console.log(`[2/4] Profiling cold start, RSS, page faults and CPU time...`);
  const resMap = new Map<string, Resources>();
  for (const t of targets) {
    const r = await profileRun(t.cmd, perfOk);
    resMap.set(t.name, r);
    console.log(`  • ${t.name}: cold ${r.coldMs.toFixed(2)} ms, ${r.rssKb.toLocaleString()} KB, ${r.pageFaults.toLocaleString()} faults`);
  }

  // 4. Warm execution speed
  console.log(`[3/4] Benchmarking warm execution speed (Hyperfine 50 runs)...`);
  const timingMap = await runHyperfine(targets);

  const results: BenchResult[] = targets.map((t) => {
    const timing = timingMap.get(t.name) || { mean: 0, min: 0, max: 0, median: 0, stddev: 0 };
    const res = resMap.get(t.name)!;
    return { name: t.name, ...timing, ...res, sizeBytes: t.size };
  });

  const ondeRes = results.find((r) => r.name.startsWith("onde"));

  console.log(`\n⏱️  WARM TIMINGS:`);
  console.log("-------------------------------------------------------------------------------------------");
  console.log(
    `Runtime / Target`.padEnd(22) +
    `Mean`.padStart(11) + `Median`.padStart(11) + `Stddev`.padStart(11) +
    `Min`.padStart(11) + `Max`.padStart(11) + `vs onde`.padStart(13)
  );
  console.log("-------------------------------------------------------------------------------------------");
  for (const r of results) {
    const ratio = ondeRes && r.mean > 0 && r !== ondeRes ? (r.mean / ondeRes.mean).toFixed(1) + "x" : "-";
    console.log(
      r.name.padEnd(22) +
      `${r.mean.toFixed(3)}ms`.padStart(11) +
      `${r.median.toFixed(3)}ms`.padStart(11) +
      `${r.stddev.toFixed(3)}ms`.padStart(11) +
      `${r.min.toFixed(3)}ms`.padStart(11) +
      `${r.max.toFixed(3)}ms`.padStart(11) +
      ratio.padStart(13)
    );
  }
  console.log("-------------------------------------------------------------------------------------------");

  console.log(`\n🧠 COLD START & RESOURCES:`);
  console.log("-------------------------------------------------------------------------------------------");
  console.log(
    `Runtime / Target`.padEnd(22) +
    `Cold`.padStart(11) + `Peak RSS`.padStart(12) + `Faults`.padStart(10) +
    `User`.padStart(10) + `Sys`.padStart(9) + `Size`.padStart(12) +
    (perfOk ? `Instr`.padStart(14) : "")
  );
  console.log("-------------------------------------------------------------------------------------------");
  for (const r of results) {
    const instrCol = perfOk ? `${(r.instructions / 1e6).toFixed(1)}M`.padStart(14) : "";
    console.log(
      r.name.padEnd(22) +
      `${r.coldMs.toFixed(2)}ms`.padStart(11) +
      `${r.rssKb.toLocaleString()} KB`.padStart(12) +
      `${r.pageFaults.toLocaleString()}`.padStart(10) +
      `${r.userMs.toFixed(1)}ms`.padStart(10) +
      `${r.sysMs.toFixed(1)}ms`.padStart(9) +
      sizeStr(r.sizeBytes).padStart(12) +
      instrCol
    );
  }
  console.log("-------------------------------------------------------------------------------------------");

  const primaryRival =
    results.find((r) => r.name.includes("bun --aot")) ||
    results.find((r) => r.name.includes("bun --compile")) ||
    results.find((r) => r.name.includes("bun run"));
  if (ondeRes && ondeRes.mean > 0 && primaryRival && primaryRival.mean > 0) {
    const speedup = (primaryRival.mean / ondeRes.mean).toFixed(1);
    const memRatio = (primaryRival.rssKb / Math.max(ondeRes.rssKb, 1)).toFixed(1);
    console.log(`\n💥 SUMMARY:`);
    console.log(`  • onde is ${speedup}x faster than ${primaryRival.name} (warm mean)`);
    console.log(`  • onde uses ${memRatio}x less RAM than ${primaryRival.name}`);
    console.log(`  • onde cold start: ${ondeRes.coldMs.toFixed(2)} ms, binary footprint: ${sizeStr(elfSize)}`);
    console.log("");
  }
}

const defaultCase = join(casesDir, "hello.ts");
const testCase = Bun.argv[2] ? resolve(Bun.argv[2]) : defaultCase;
await runArena(testCase);
