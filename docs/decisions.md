# Technical decisions

Each entry: context, decision, consequences.

## D1 — Scoped npm name `@fasaled/muin`

**Context:** Unscoped `muin` is unused on the registry but npm’s typosquatting filter rejects it as too similar to `must`, `mri`, `cuid`, `uid`, `uuid`, and `bun`.

**Decision:** Publish `@fasaled/muin`. Keep the binary name `muin`.

**Consequences:** Install is `npm install -g @fasaled/muin` (or `bun add -g`). Docs must never tell users to `npm i -g muin`. The CLI command after install is still `muin`.

## D2 — Bun for development, Node-compatible publish

**Context:** The project should be developed with Bun. End users install from npm and may not have Bun.

**Decision:** Bun is the toolchain (`bun install`, `bun test`, `bun run build`, pinned `packageManager`). The published `bin` shebang is `#!/usr/bin/env node`. Emitted JS targets Node ≥ 18 and also runs on Bun.

**Consequences:** CI installs Bun for tests and also smoke-runs `dist/cli.js` with Node. We do not require Bun at runtime for the published package.

## D3 — In-house qpdf WASM, no npm wrapper

**Context:** Low-level PDF access should be qpdf’s JSON v2 CLI (`--json`, `--json-object`, `--show-object`, `--check`). Third-party wasm wrappers are unpinned forks.

**Decision:** Compile qpdf (and zlib, libjpeg-turbo) to WASM in a pinned Docker/emsdk pipeline. Vendor `vendor/qpdf/` in git. Adapter wraps `callMain` + `FS`.

**Consequences:** We own rebuilds when qpdf or emsdk changes. Install does not compile C++. See `docs/wasm.md` once the pipeline lands.

## D4 — Structure dump without stream bodies

**Context:** Incoming refs require a reverse index over the document. Loading every stream body would blow memory on large files. Walking `--json-object` one-by-one is too slow for `refs`.

**Decision:** At session start, `qpdf --json=2 --json-stream-data=none`. Reverse index from that structure. Stream bytes on demand.

**Consequences:** Memory scales with object *count* and dict size, not with image/font streams. Hard cap at 200_000 objects.

## D5 — No encryption in v1

**Context:** qpdf encryption needs OpenSSL or GnuTLS, which enlarges the WASM surface.

**Decision:** Omit those libraries. Encrypted files fail with `EncryptedPdfError`.

**Consequences:** Smaller, simpler build. Documented limitation in the README.

## D6 — Single command core; TUI and MCP are thin and exclusive

**Context:** Duplicating verbs across Ink and MCP would drift.

**Decision:** Pure handlers `(session, args) → Result`. Process starts as TUI *or* MCP, never both (stdio conflict).

**Consequences:** New commands land in `src/commands` first, then a TUI help line and an MCP tool.

## D7 — Small `find --where` language

**Context:** Agents and humans need to filter objects. A general expression engine is out of scope.

**Decision:** `/Key == value` (and `!=`, numeric `>` `<`) with optional AND. No JS eval.

**Consequences:** Easy to test and safe. Nested paths can be added later without breaking v1 syntax.

## D8 — Bounded `export_graph`

**Context:** Agents must not dump an entire large PDF as JSON.

**Decision:** Default depth 2, max depth 8, max 5_000 nodes. Depth-from-ref **or** find-set, not both unbounded.

**Consequences:** MCP tool always returns a finite graph.

## D9 — English-only repository

**Context:** The repo will be public; contributors and agents need one language.

**Decision:** Commits, comments, docs, specs, errors, and TUI chrome are English.

**Consequences:** The original proposal stays English; new docs are English.

## D10 — Docs are part of the product

**Context:** Architecture, WASM rebuild, and agent workflow are easy to lose if they live only in chat.

**Decision:** `docs/design.md`, `docs/decisions.md`, `docs/wasm.md`, and `docs/agents.md` ship in git. User-visible changes update the README in the same change.

**Consequences:** Slightly more to maintain; agents have a required reading list.
