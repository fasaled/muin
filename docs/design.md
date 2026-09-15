# Muin design

Living spec. Implement against this document, not against `implementation-proposal.md`.

Muin treats a PDF’s indirect objects as a navigable graph (outgoing refs from the file, incoming refs from a reverse index). **One command core**, four clients:

| Client | Process | Session |
|---|---|---|
| TUI / REPL | `muin file.pdf` | one per CLI process |
| One-shot CLI | `muin file.pdf <command> …` | open → one verb → close |
| MCP (CLI) | `muin --mcp` | none until the agent calls `open`; then one worker session |
| VS Code panel | extension host, library import | one per open PDF webview |
| VS Code Copilot MCP | vsix `mcp-stdio.js` child (not the CLI binary) | none until `open`; then one worker session |

The CLI npm package and the VS Code `.vsix` are **independent artifacts**. Each bundles `@muin/core` and `vendor/qpdf/`. Installing one does not install the other.

## Monorepo

```
packages/core     @muin/core (private workspace package; not published)
packages/cli      @fasaled/muin (npm)
packages/vscode   fasaled.muin (.vsix)
vendor/qpdf       shared WASM
```

Public API of core:

```ts
createSession(filePath, options?: { maxBytes?: number }): Promise<MuinSession>
session.run(line): Promise<CommandResult>
session.runCommand(cmd): Promise<CommandResult>
session.snapshot(): { cwd, path, historyLength }
session.close(): void
parseCommand(line): ParsedCommand
createMcpServer(session): McpServer
serveMcpStdio(session): Promise<void>
```

WASM: **one module instance per session**, loaded on a **Node worker thread** (`session-worker`). `callMain`, MEMFS, and `JSON.parse` of the object graph run in that worker. The TUI / extension host keep a thin RPC proxy (`createSession` → `createWorkerSession`) so the UI event loop is not blocked. Two open PDFs still do not share MEMFS (two workers).

This does **not** make qpdf faster; it improves responsiveness. The worker script is emitted next to each bundle (`dist/session-worker.js`).

Ink lives only in `packages/cli`. The webview never runs qpdf; the extension host calls `session.run` (IPC to the worker) and posts JSON to the webview.

## Opening a PDF (core)

1. `stat` then size limit (default 200 MiB) before reading bytes.
2. Copy into MEMFS; drop the JS `Buffer`.
3. `qpdf --json=2 --json-stream-data=none --json-key=qpdf` to a MEMFS file.
4. JSON size cap 512 MiB; object cap 200_000.
5. Encrypted files → `EncryptedPdfError`.
6. Reverse index; cwd = `/Root`.

Streams are fetched on demand.

## Commands

Same table as the README. `quit` is TUI-only. `export_graph` feeds the VS Code graph and MCP.

`find --where`: `/Key == value`, `!=`, `>`, `<`, optional AND. No JS eval.

`export_graph`: default depth 2, max 8, max 5_000 nodes; or `--find` (nodes matching the where, edges among them).

`neighbors`: current object plus its incoming and outgoing refs, each capped (default 8) with a total count. JSON, machine-readable pair of `refs`. Feeds the CLI TUI's graph panel; keyboard-navigable there (`Tab` to focus it, arrows to pick a neighbor, `Enter` = `cd`).

## TUI and VS Code UI model

Both clients follow the same interaction model, in their own idioms, so the experience matches across surfaces even though the rendering is unrelated:

- **State panes** show the current object and never scroll: they redraw in place on `cd`/`back`. TUI: a graph panel (`neighbors`) plus an object panel (`ls`). VS Code: the vis-network graph plus the `#ls`/`#refs` panes.
- **Everything else is transient.** Any command that isn't `cd`/`back` (`find`, `tree`, `check`, `help`, `history`, …) shows its result in a panel that replaces the state panes and is dismissed explicitly — `Esc` (both clients) or the panel's own close button (VS Code only, since the TUI has no mouse). `cd`/`back` always dismiss it and refresh the state panes.
- **The panel scrolls; the terminal doesn't.** The TUI runs in the alternate screen (no scrollback — see D19), so content taller than the screen would otherwise be unreachable. The TUI's `Overlay` (`App.tsx`) measures its own rendered height with `measureElement` and renders only that many lines, moved by `↑`/`↓`/`PageUp`/`PageDown`, with a `first-last/total` counter. VS Code's overlay gets this for free from the browser (`overflow: auto` in `webview.ts`).
- There is no growing transcript in either client. Errors are a single status line, replaced by the next outcome, not appended to history. VS Code's host distinguishes the two over the wire: a `state`/`overlay` message replaces panel content, a `log` message is always an error or empty (`host.ts`'s `HostLog`), never used for command output.
- `history` is client-only in both UIs (the typed-command list backing `↑`/`↓` recall) — it opens the same dismissible panel as any core command, but core has no `history` command; the client intercepts the literal line before calling `session.run`.

**Completion**: `packages/core/src/commands/complete.ts` (`complete(line, cursor, ctx)`) is the single source of truth for command-name, flag, and ref completion — both clients call it instead of re-implementing the grammar. `ctx.neighborRefs` comes from data each client already has loaded (the `neighbors` result powering the graph panel), so completing a ref never triggers a fresh PDF read. The TUI calls `complete()` directly (same process); the VS Code webview asks the extension host over `postMessage` (`{type: "complete", line, cursor}` → `{type: "completions", items, replaceFrom}`) since the webview cannot import `@muin/core` under its CSP. `Tab` opens/cycles the menu, `Enter` only fills the word in — never submits — matching shell completion conventions. `complete()` itself caps the returned list (`COMPLETION_MAX_ITEMS`, 8) — a neighborhood can have up to `NEIGHBORS_DEFAULT_LIMIT` refs, and a menu that long isn't usable in either client, so the cap lives in the one place both call instead of each remembering to slice.

**Square brackets mark muin's own summaries, never literal PDF content.** A leading `/` already marks a real PDF name (`/Pages`, `/FlateDecode`) — anything muin generated to describe a shape instead of showing it (`[Stream]`/`[Dict]`/`[Array]` when there is no `/Type` to show, `[dict×2]`/`[array×3]` previews, `[stream]` as a structural marker, `[none]`, `[+N more]`, `[missing]`, `[cycle]`) is bracketed. `pdf/model.ts`'s `bracketKind()` is the shared decision (`name.startsWith("/") ? name : \`[${name}]\``); `displayTypeName()`/`objectTypeName()` stay unbracketed plain strings so `neighbors`/`export_graph` JSON stays clean for MCP/VS Code — bracketing happens only at render time (`GraphView.tsx`'s `KindSpan`, `webview.ts`'s label building) or, for plain-text commands (`ls`, `cat`, `tree`) where there is no separate structured consumer, baked directly into `commands/format.ts`'s output. New commands or panes that show a muin-generated summary next to real content should follow the same convention rather than inventing another marker.

## VS Code

- Command **Muin: Explore PDF** opens a webview: vis-network graph from `export_graph --depth 2`, click → `cd`, command box → `session.run`.
- MCP: `contributes.mcpServerDefinitionProviders` + `registerMcpServerDefinitionProvider`. Stdio command is Node + `dist/mcp-stdio.js` with **no** PDF argument. The agent calls `open` / `close`. The panel session is separate from Copilot’s session.

## Non-goals

Encrypted PDFs, native qpdf, HTTP MCP, spawning the `muin` CLI from the extension, publishing `@muin/core` to npm, GitHub Actions, WASM in the webview.
