# Working on Muin with agents

This repository is implemented from a written spec by coding agents as well as humans. Follow this file so changes stay consistent.

## Origin

1. `implementation-proposal.md` — original product proposal (historical).
2. `docs/design.md` — living spec. **Implement against this.**
3. `docs/decisions.md` — locked technical decisions. Do not silently reverse them.
4. Stacked implementation: scaffold → model → qpdf JSON → WASM/adapter → graph → commands → CLI → TUI → MCP → packaging.

## Required reading (in order)

1. [README.md](../README.md)
2. [docs/design.md](design.md)
3. [docs/decisions.md](decisions.md)
4. [docs/wasm.md](wasm.md) — only when touching PDF loading, qpdf, Docker, or `vendor/qpdf/`

## Tooling

Use Bun, not npm/yarn, as the primary tool:

```bash
bun install
bun test
bun run typecheck
bun run build
bun packages/cli/src/cli.ts --help
```

The published CLI still runs on Node (`#!/usr/bin/env node`). After `bun run build`, smoke-test with `node packages/cli/dist/cli.js --help`. Before `npm publish`, pack and install the tarball in a clean directory (`npm pack` in `packages/cli`, then `npm install ./fasaled-muin-<version>.tgz` elsewhere) and run `npx muin fixtures/pdf/minimal.pdf check`.

## Language

English only: commit messages, comments, documentation, error strings, TUI labels.

Comments explain non-obvious constraints, not the story of the change.

## Where code goes

| Area | Path |
|---|---|
| Session API | `packages/core/src/session.ts` (`createSession` = worker) |
| In-process session (tests / worker internals) | `packages/core/src/session-local.ts` |
| WASM worker | `packages/core/src/worker/` |
| PDF / qpdf / graph / commands / MCP | `packages/core/src/` |
| CLI argv / TUI | `packages/cli/src/` |
| VS Code extension | `packages/vscode/src/` |
| Vendored WASM | `vendor/qpdf/` |
| Fixtures | `fixtures/` |
| WASM build | `wasm/` + `docs/wasm.md` |

## Adding a command

1. Add the handler and parser in `packages/core/src/commands` (pure, tested).
2. Expose it from the TUI if it is a TUI verb (`packages/cli`).
3. MCP tools in `packages/core/src/mcp` pick it up if you add the tool there.
4. VS Code graph/log uses `session.run` — no second parser.
5. Update the README command table and `docs/design.md` in the **same** change.

Do not reimplement the verb inside the TUI or MCP.

## Do not

- Depend on a third-party npm qpdf/wasm wrapper.
- Compile qpdf on the user’s machine at `npm install` time.
- Start TUI and MCP in the same process.
- Call `createSession` from the session worker (that would nest workers). Use `createSessionInProcess` there.
- Run qpdf WASM on a `worker_threads` Worker inside the VS Code extension host. The panel must `fork` the session worker (`workerProcess: true`).
- Dump unbounded graphs from `export_graph`.
- Eval user `--where` strings as JavaScript.
- Commit `node_modules/`, `*.tgz`, or build logs.

## Regenerating qpdf WASM

Follow [docs/wasm.md](wasm.md) (Docker, pinned URLs, checksums). Bumping qpdf or emsdk is its own change: pin → rebuild → commit `vendor/qpdf/` → note in `docs/wasm.md`.

## Tests

- Default: `bun test` — unit tests, MCP in-process tests, CLI process tests, and WASM integration when `vendor/qpdf/` is present.
- `src/**/*.test.ts` next to the code; process-level tests live in `src/e2e/`.
- WASM integration only when `vendor/qpdf/` exists (`describe.skipIf` otherwise).

## Publishing

Package versions stay in lockstep (`packages/core`, `packages/cli`, `packages/vscode`, and `packages/core/src/version.ts`). Bump all four together, push to `main`, then create the GitHub Release locally (tag + notes; GitHub attaches source zip/tar.gz):

```bash
gh release create v0.1.0 --title "Muin 0.1.0" --generate-notes --target main
```

Do not attach npm tarballs or vsix files. npm publish of `@fasaled/muin` and Marketplace publish are separate (`npm publish --access public` from `packages/cli`, `vsce publish` from `packages/vscode`).
