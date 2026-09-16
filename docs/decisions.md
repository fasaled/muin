# Technical decisions

Each entry: context, decision, consequences.

## D1 — Scoped npm name `@fasaled/muin`

**Context:** Unscoped `muin` is unused on the registry but npm’s typosquatting filter rejects it as too similar to `must`, `mri`, `cuid`, `uid`, `uuid`, and `bun`.

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

## D11 — Private workspace core, two artifacts

**Context:** CLI and VS Code must share commands without the person installing an extra npm package, and without the extension spawning `muin`.

**Decision:** `@muin/core` is a private Bun workspace package. `@fasaled/muin` and the vsix each bundle it. `@muin/core` is not published to npm.

**Consequences:** One version in the repo; both consumers bump together. `createSession` is the only supported way to open a PDF.

## D12 — VS Code MCP is a vsix stdio script

**Context:** VS Code discovers MCP via `McpStdioServerDefinition`, which starts a child process.

**Decision:** The child is `node dist/mcp-stdio.js <pdf>` inside the vsix, calling `serveMcpStdio`. Never the published CLI binary.

**Consequences:** Copilot does not need `mcp.json`. Panel and agent sessions are separate processes/WASM instances.

## D13 — Graph in the webview only

**Context:** qpdf WASM is Node-oriented (`callMain`, MEMFS). A vis-network plot of `export_graph` did not match the TUI (neighborhood of the current object) and clicks did not feel like `cd`.

**Decision:** The webview renders the same `neighbors` + `ls` panes as the TUI (HTML/CSS, no graph library). The extension host runs `neighbors` / `ls` / `cd` and posts JSON. Mouse clicks are `cd`; keyboard matches the TUI.

**Consequences:** No WASM in the browser. No vis-network dependency. `export_graph` remains an MCP / one-shot tool, not the panel’s data source.

## D14 — No GitHub Actions

**Context:** Hosted Actions consume the private-repo minute quota (WASM compile was especially expensive).

**Decision:** No workflows under `.github/workflows`. Tests, typecheck, and builds run locally (`bun test`, `bun run build`). qpdf WASM is vendored and rebuilt with Docker on a developer machine. Version tags and GitHub Releases are created locally with `gh release create` (notes + the source archives GitHub attaches automatically). Do not attach npm tarballs or vsix files to the GitHub Release.

**Consequences:** Nothing runs on push. Cutting a release is `gh release create vX.Y.Z --generate-notes` after the version bump is on `main`.

## D15 — WASM `callMain` on a worker thread

**Context:** `callMain` is synchronous C++ in WASM. On the TUI process it froze the prompt; on the VS Code extension host it stalled the panel’s message loop. It does not run on the editor renderer (already a separate process). Moving it to a worker does not shrink CPU time for qpdf or `JSON.parse`.

**Decision:** `createSession` opens a `worker_threads` Worker that owns the adapter, MEMFS, and graph. The main thread holds a cached `snapshot()` and talks via sequenced RPC (`open` / `run` / `runCommand` / `close`). Tests that do not need WASM keep using `bindSession` in-process. Bundles emit `dist/session-worker.js` beside the CLI and the vsix.

**Consequences:** Opening a PDF is still as slow as qpdf, but the prompt and extension host stay responsive. Memory is one WASM heap **per session** (the worker), plus IPC copies of command results. MCP stdio was already a child process; it now has a worker inside that process as well (small extra RAM, consistent API). The VS Code **panel** forks `session-worker.js` as a child (`ELECTRON_RUN_AS_NODE`) instead of `worker_threads`: qpdf WASM aborting in an Electron worker thread takes down the whole window.

## D16 — MCP is a server; the agent opens and closes PDFs

**Context:** Binding MCP to `muin --mcp file.pdf` copied the TUI model (one human, one file, one process). An agent already holds a long-lived stdio connection and should choose documents over that connection.

**Decision:** MCP starts with no PDF. Tools `open` (path, optional maxBytes) and `close` own the worker session. Query tools require an open session (`no PDF is open; call the open tool first`). `open` replaces a previous PDF. One active PDF per MCP process. CLI `muin --mcp` is the normal form; `muin --mcp file.pdf` still pre-opens for scripts. VS Code always advertises MCP without a file picker.

**Consequences:** Copilot can `open` any workspace PDF. In VS Code, `open` with no path (and the `focused` tool) use the PDF in the active tab, or the file already in the Muin panel — the extension writes that path to a hint file the MCP child reads. TUI is unchanged. Concurrent PDFs in one MCP connection are out of scope.

## D17 — One-shot CLI commands

**Context:** MCP is a long-lived agent connection; the TUI is a REPL. Scripts and CI need “run this verb on this PDF and exit.”

**Decision:** `muin <file.pdf> <command> [args…]` opens a worker session, runs one parsed line (same parser as the TUI), prints to stdout (`stream` as raw bytes), then closes. No extra tokens after the file still starts the TUI. `--mcp` cannot be mixed with a one-shot line. `muin help` prints core help without opening a PDF. `quit` is rejected as a one-shot.

**Consequences:** Each invocation starts at `/Root`. `cd`/`back` do not persist. Same core, no new verbs.

## D18 — Shell completion (bash, zsh, fish, PowerShell)

**Context:** One-shot commands and flags are easy to mistype. Completions should work on Linux, macOS, and Windows (PowerShell / pwsh).

**Decision:** `muin completion bash|zsh|fish|powershell` prints a script (`pwsh` is an alias of `powershell`). Completes global flags, `*.pdf` paths, command names, and per-command flags. Does not run qpdf to complete object IDs (too slow for Tab). No `postinstall` hook that edits shell rc files.

**Consequences:** Opt-in install. Completions stay in sync if we regenerate the printed script from the same command list in `completion.ts`.

## D19 — TUI runs in the alternate screen; the overlay scrolls itself

**Context:** The TUI initially rendered inline (Ink's default), which read as a growing terminal transcript rather than an application — the opposite of the fixed-panel, no-log design in this doc's TUI/VS Code section. It also made "muin's box vs. everything else on screen" ambiguous.

**Decision:** `render(<App/>, { alternateScreen: true })` — Ink 7's built-in full-screen mode, the same mechanism `vim`/`htop`/`lazygit` use. The alternate screen has no scrollback, so any content taller than the terminal would otherwise be permanently unreachable; the `Overlay` component compensates by measuring its own height (`measureElement`) and paginating with `↑`/`↓`/`PageUp`/`PageDown` instead of relying on the terminal.

**Consequences:** The terminal's prior contents return unchanged on exit, and the app now has a real screen to lay out (see `docs/design.md`'s "TUI and VS Code UI model": centered, width-capped, vertically distributed via `useStdout`). Every long-output surface (currently only `Overlay`) is responsible for its own scrolling; a future pane that can grow unbounded needs the same treatment, not a plain `<Text>`.
