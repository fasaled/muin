# Technical decisions

Each entry: context, decision, consequences.

## D1 — Scoped npm name `@fasaled/muin`

**Context:** The CLI is published under the `@fasaled` scope; the installed binary is still `muin`.

**Decision:** Publish `@fasaled/muin`. Keep the binary name `muin`.

**Consequences:** Install is `npm install -g @fasaled/muin` (or `bun add -g`). Docs must never tell users to `npm i -g muin`. The CLI command after install is still `muin`.

## D2 — Bun for development, Node-compatible publish

**Context:** The project should be developed with Bun. End users install from npm and may not have Bun.

**Decision:** Bun is the toolchain (`bun install`, `bun test`, `bun run build`, pinned `packageManager`). The published `bin` shebang is `#!/usr/bin/env node`. Emitted JS targets Node ≥ 18 and also runs on Bun.

**Consequences:** Local tests and builds use Bun. Smoke-run `dist/cli.js` with Node before publish. We do not require Bun at runtime for the published package.

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

## D11 — Private workspace core, one artifact

**Context:** The CLI needs the graph engine, adapter, and command core without the person installing an extra npm package.

**Decision:** `@muin/core` is a private Bun workspace package. `@fasaled/muin` bundles it. `@muin/core` is not published to npm.

**Consequences:** One version in the repo. `createSession` is the only supported way to open a PDF.

## D12 — RETIRED (VS Code MCP provider)

Retired by D20. The VS Code extension no longer exists; there is no `.vsix` MCP
child process. Full text preserved in git history
(`git log --follow -- docs/decisions.md`).

## D13 — RETIRED (VS Code webview panel)

Retired by D20. The VS Code extension no longer exists; there is no webview
panel. Full text preserved in git history
(`git log --follow -- docs/decisions.md`).

## D14 — No GitHub Actions

**Context:** Hosted Actions consume the private-repo minute quota (WASM compile was especially expensive).

**Decision:** No workflows under `.github/workflows`. Tests, typecheck, and builds run locally (`bun test`, `bun run build`). qpdf WASM is vendored and rebuilt with Docker on a developer machine. Version tags and GitHub Releases are created locally with `gh release create` (notes + the source archives GitHub attaches automatically). Do not attach npm tarballs to the GitHub Release.

**Consequences:** Nothing runs on push. Cutting a release is `gh release create vX.Y.Z --generate-notes` after the version bump is on `main`.

## D15 — WASM `callMain` on a worker thread

**Context:** `callMain` is synchronous C++ in WASM. On the TUI process it froze the prompt. Moving it to a worker does not shrink CPU time for qpdf or `JSON.parse`.

**Decision:** `createSession` opens a `worker_threads` Worker that owns the adapter, MEMFS, and graph. The main thread holds a cached `snapshot()` and talks via sequenced RPC (`open` / `run` / `runCommand` / `close`). Tests that do not need WASM keep using `bindSession` in-process. Bundles emit `dist/session-worker.js` beside the CLI.

**Consequences:** Opening a PDF is still as slow as qpdf, but the prompt stays responsive. Memory is one WASM heap **per session** (the worker), plus IPC copies of command results. MCP stdio was already a child process; it now has a worker inside that process as well (small extra RAM, consistent API).

## D16 — MCP is a server; the agent opens and closes PDFs

**Context:** Binding MCP to `muin --mcp file.pdf` copied the TUI model (one human, one file, one process). An agent already holds a long-lived stdio connection and should choose documents over that connection.

**Decision:** MCP starts with no PDF. Tools `open` (path, optional maxBytes) and `close` own the worker session. Query tools require an open session (`no PDF is open; call the open tool first`). `open` replaces a previous PDF. One active PDF per MCP process. CLI `muin --mcp` is the normal form; `muin --mcp file.pdf` still pre-opens for scripts.

**Consequences:** TUI is unchanged. Concurrent PDFs in one MCP connection are out of scope.

## D17 — One-shot CLI commands

**Context:** MCP is a long-lived agent connection; the TUI is a REPL. Scripts and CI need “run this verb on this PDF and exit.”

**Decision:** `muin <file.pdf> <command> [args…]` opens a worker session, runs one parsed line (same parser as the TUI), prints to stdout (`stream` as raw bytes), then closes. No extra tokens after the file still starts the TUI. `--mcp` cannot be mixed with a one-shot line. `muin help` prints core help without opening a PDF. `quit` is rejected as a one-shot.

**Consequences:** Each invocation starts at `/Root`. `cd`/`back` do not persist. Same core, no new verbs.

## D18 — Shell completion (bash, zsh, fish, PowerShell)

**Context:** One-shot commands and flags are easy to mistype. Completions should work on Linux, macOS, and Windows (PowerShell / pwsh).

**Decision:** `muin completion bash|zsh|fish|powershell` prints a script (`pwsh` is an alias of `powershell`). Completes global flags, `*.pdf` paths, command names, and per-command flags. Does not run qpdf to complete object IDs (too slow for Tab). No `postinstall` hook that edits shell rc files.

**Consequences:** Opt-in install. Completions stay in sync if we regenerate the printed script from the same command list in `completion.ts`.

## D19 — TUI runs in the alternate screen; the overlay scrolls itself

**Context:** The TUI initially rendered inline (Ink's default), which read as a growing terminal transcript rather than an application — the opposite of the fixed-panel, no-log design in this doc's TUI UI model. It also made "muin's box vs. everything else on screen" ambiguous.

**Decision:** `render(<App/>, { alternateScreen: true })` — Ink 7's built-in full-screen mode, the same mechanism `vim`/`htop`/`lazygit` use. The alternate screen has no scrollback, so any content taller than the terminal would otherwise be permanently unreachable; the `Overlay` component compensates by measuring its own height (`measureElement`) and paginating with `↑`/`↓`/`PageUp`/`PageDown` instead of relying on the terminal.

**Consequences:** The terminal's prior contents return unchanged on exit, and the app now has a real screen to lay out (see `docs/design.md`'s "TUI UI model": centered, width-capped, vertically distributed via `useStdout`). Every long-output surface (currently only `Overlay`) is responsible for its own scrolling; a future pane that can grow unbounded needs the same treatment, not a plain `<Text>`. Flex rows are contractual, not emergent: fixed chrome (header, prompt) and the graph pane never yield (`flexShrink={0}`); scrollable panes absorb whatever the graph leaves (`flexShrink={1}`, `minHeight={0}`) and page to the measured remainder. Letting the measure/slice loop compress the header produced overlapping rows once (the object pane with a 40-key dict ate the header's first line).

## D20 — VS Code extension removed

**Context:** `packages/vscode` shipped a webview panel and a Copilot MCP provider alongside the TUI and CLI MCP server. Maintaining a third client — webview UI, extension packaging, `.vsix` releases — split effort that was better spent on the CLI's TUI and MCP surfaces, which cover both human and agent use without an editor dependency.

**Decision:** Drop `packages/vscode` and the VS Code-only bits of `@muin/core` (the MCP `focused` tool and `MUIN_FOCUSED_PDF_FILE` hint file; `workerScript`/`workerProcess` remain as generally useful session options). Effort concentrates on the CLI's TUI and MCP.

**Consequences:** Two clients remained at the time: TUI/REPL and MCP, both via `@fasaled/muin` (the read-only follower joined later, D21). D12–D13 above are retired stubs; D11, D15, and D16 were edited to remove extension scope. The full extension design is preserved in git history, not in this document.

## D21 — Read-only observation via an append-only journal

**Context:** Watching what an agent does through the MCP server cannot mean a second MCP client: stdio is 1:1, and HTTP MCP is a non-goal. The observation channel must be one-directional and must not slow the agent or let the observer interfere.

**Decision:** `muin --mcp --events <path>` appends one JSONL event per agent operation (`packages/core/src/journal/`). Observation is layered: core exposes the journal writer/reader plus a `withJournal` session decorator (the single instrumentation point — hosts record lifecycle `open`/`close` themselves). `muin --follow <path>` runs a separate TUI component (`FollowApp`, no prompt, no history) over its own mirror session: it seeks by `cd <catalog-ref>` plus forward replay of `ok` nav ops (no qpdf re-parse, LRU-cached), flags cwd divergence, and auto-plays on an observation clock (default 1 op/s, 100 ms–5 s) that ignores real event timestamps. The follower reuses the TUI's panes, overlay keys, and exit keys; the header badge is the single always-visible mode indicator (green play / yellow paused / dim waiting / red diverged-or-error, red being otherwise unused).

**Consequences:** One writer per journal file (concurrent writers would interleave lines); journal previews are capped (`JOURNAL_PREVIEW_MAX_CHARS`) so large results don't bloat the file; keyboard navigation of the graph is display-only. Future clients that want recording (e.g. the TUI recording itself) reuse `withJournal` without touching the MCP server.

## D22 — Journal rotation per opened PDF

**Context:** The journal appends forever (D21): every new agent session's operations concatenate after the previous session's, and the file grows without bound. The follower cannot tell sessions apart. Rotating on server start was considered, but start does not mean a new session — handshakes and `mcp list` probes spawn short-lived servers that must not rotate, and only `open` starts actual work.

**Decision:** Every successful `open` (tool call or pre-opened file) rotates a non-empty journal aside to a timestamped backup in the same directory (`live-20260926-213500.jsonl`, counter suffix on collision) before recording — one journal file per opened PDF, regardless of server restarts. The previous session's `close` (if any) is recorded to the old file before rotating, so it stays attributed correctly. Rotation and recording stay best-effort (a stale journal beats no server). The tail detects the replacement (size below the read offset) and reports it, so the follower drops the previous timeline and waits for the new session instead of concatenating. Backups are never auto-deleted; they stay replayable via `muin --follow <backup>`.

**Consequences:** An MCP restart mid-session only splits the journal once the agent re-opens (unavoidable — a fresh process holds no session); manual truncation behaves like a rotation. Writers re-anchor to the path before each record (dev/ino check), so a live writer survives any rotation and follows the fresh file instead of the renamed inode — and a deleted journal is recreated on the next record. Old sessions remain inspectable as long as their backups are kept.
