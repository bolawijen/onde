# onde

**onde** is an experimental project exploring direct compilation of TypeScript to native ELF executables and stripped-down toolchains, forked from the TypeScript compiler codebase.

---

## ⚖️ Upstream Attribution & Open Source Notice

`onde` is a derivative work based on [Microsoft TypeScript](https://github.com/microsoft/TypeScript), originally licensed under the [Apache License, Version 2.0](LICENSE.txt).

- **Original Project**: [TypeScript](https://www.typescriptlang.org/) by Microsoft Corporation.
- **Fork Checkpoint**: Forked from [**TypeScript 6.0.3**](https://github.com/microsoft/TypeScript/commits/050880ce59e30b356b686bd3144efe24f875ebc8/) — the latest and final JavaScript-based release of TypeScript before Microsoft transitioned active compiler development to [`typescript-go`](https://github.com/microsoft/typescript-go).
- **Disclaimer**: This project is an independent open-source initiative and is **not** affiliated with, sponsored by, or endorsed by Microsoft Corporation. TypeScript is a registered trademark of Microsoft Corp.

All original Microsoft copyright notices and third-party notices are preserved in [`LICENSE.txt`](LICENSE.txt), [`NOTICE`](NOTICE), and [`ThirdPartyNoticeText.txt`](ThirdPartyNoticeText.txt).

---

## ⚙️ Architecture & Scope

- **Frontend (Parser & AST):** Reuses Microsoft's TypeScript parser and AST engine.
- **Backend (Emitter):** Custom bytecode and native ELF generator (targeting Linux x86_64).
- **Current Status:** Direct bytecode/ELF emission.
- **Vision:** Aims to evolve into a fast, native compiler alternative for TypeScript workflows.

---

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (v1.0+)

### Running / Compiling

```bash
# Example compilation with Bun
bun run src/onde.ts tests/hi.ts -o bin/halo.onde

# Run the generated native ELF binary (Linux x86_64)
./bin/halo.onde
```

---

## 📜 License

Licensed under the **Apache License, Version 2.0**.
See [LICENSE.txt](LICENSE.txt) and [NOTICE](NOTICE) for the full license text and copyright attribution details.
