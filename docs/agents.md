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
bun src/cli.ts --help
```

The published CLI still runs on Node (`#!/usr/bin/env node`). After `bun run build`, smoke-test with `node dist/cli.js --help` when you change the entrypoint.

## Language

English only: commit messages, comments, documentation, error strings, TUI labels.

Comments explain non-obvious constraints, not the story of the change.

## Where code goes

| Area | Path |
|---|---|
| CLI argv / mode | `src/cli.ts` |
| PDF values | `src/pdf/model.ts` |
| qpdf JSON | `src/pdf/qpdf-json.ts` |
| WASM / `callMain` | `src/pdf/qpdf-wasm.ts` |
| Adapter interface | `src/pdf/adapter.ts` |
| Reverse index / cwd | `src/graph/` |
| Verbs | `src/commands/` |
| Ink UI | `src/tui/` |
| MCP tools | `src/mcp/` |
| Caps | `src/limits.ts` |
| Typed errors | `src/errors.ts` |
| Fixtures | `fixtures/` |
| WASM build | `wasm/` + `docs/wasm.md` |
| Vendored binary | `vendor/qpdf/` |

## Adding a command

1. Add the handler and parser in `src/commands` (pure, tested).
2. Expose it from the TUI help/prompt if it is a TUI verb.
3. Expose it as an MCP tool if it is an MCP verb.
4. Update the README command table and `docs/design.md` in the **same** change.

Do not reimplement the verb inside the TUI or MCP.

## Do not

- Depend on a third-party npm qpdf/wasm wrapper.
- Compile qpdf on the user’s machine at `npm install` time.
- Start TUI and MCP in the same process.
- Dump unbounded graphs from `export_graph`.
- Eval user `--where` strings as JavaScript.
- Commit `node_modules/`, `*.tgz`, or build logs.

## Regenerating qpdf WASM

Follow [docs/wasm.md](wasm.md) (Docker, pinned URLs, checksums). Bumping qpdf or emsdk is its own change: pin → rebuild → commit `vendor/qpdf/` → note in `docs/wasm.md`.

## Tests

- Default: `bun test` (unit, JSON fixtures, no WASM required).
- WASM integration only when `vendor/qpdf/` exists and the job is meant to load it.

## Publishing

Version stays `0.0.0` until TUI + MCP can open a real PDF. Then `0.1.0` via `npm publish --access public`. Making the GitHub repository public is a human account action.
