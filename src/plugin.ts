import { readFileSync } from "fs";
import { CompilerContext, OndeModule } from "./internals/context";

// ─── onde extensions ─────────────────────────────────────────────────────
// An onde extension is a Bun plugin: it registers once with
// `plugin({ name, setup })` and its `setup(build)` contributes modules with
// `build.module(specifier, loader, contents)`. `loader` is carried through for
// Bun fidelity; onde knows how to compile the "object" loader, whose
// `contents` maps each exported name to the codegen function that lowers a
// call to it. Extensions live in src/extensions/ and self-register on import.

// A module member: the codegen function behind one exported name.
export type OndeFunction = OndeModule["members"][string];

export type Build = {
  module(specifier: string, loader: string, contents: { [name: string]: OndeFunction }): void;
};

export type OndePlugin = {
  name: string;
  setup: (build: Build) => void;
};

const registry: OndePlugin[] = [];

export function plugin(p: OndePlugin): void {
  registry.push(p);
}

// Plugin names enabled by `"onde": { "plugins": [...] }` in the nearest
// package.json. No list (or no package.json) enables every registered
// extension, which is what keeps existing user code compiling unchanged.
function enabledNames(): string[] | undefined {
  let pkg: any;
  try { pkg = JSON.parse(readFileSync("package.json", "utf8")); }
  catch { return undefined; }
  const list = pkg?.onde?.plugins;
  return Array.isArray(list) ? list : undefined;
}

// Run the enabled plugins setups and collect the modules they contribute.
export function loadModules(): OndeModule[] {
  const names = enabledNames();
  const modules: OndeModule[] = [];
  const build: Build = {
    module(specifier, loader, contents) {
      modules.push({ specifier, loader, members: contents });
    },
  };

  for (const p of registry) {
    if (names && !names.includes(p.name)) continue;
    p.setup(build);
  }
  return modules;
}

// Is `specifier` a module contributed by an enabled extension? Decides whether
// `import ... from "<specifier>"` binds anything.
export function isModule(specifier: string, ctx: CompilerContext): boolean {
  return ctx.modules.some((m) => m.specifier === specifier);
}

// The member a `<specifier>.<member>(...)` call resolves to, or undefined when
// no enabled extension contributed it.
export function resolveMember(specifier: string, member: string, ctx: CompilerContext): OndeFunction | undefined {
  return ctx.modules.find((m) => m.specifier === specifier)?.members[member];
}
