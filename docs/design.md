# Muin design

Living spec. Implement against this document, not against `implementation-proposal.md`.

Muin treats a PDF’s indirect objects as a navigable graph (outgoing refs from the file, incoming refs from a reverse index). **One command core**, two clients:

| Client | Process | Session |
|---|---|---|
| TUI / REPL | `muin file.pdf` | one per CLI process |
| One-shot CLI | `muin file.pdf <command> …` | open → one verb → close |
| MCP (CLI) | `muin --mcp` | none until the agent calls `open`; then one worker session |

## Monorepo

```
packages/core     @muin/core (private workspace package; not published)
packages/cli      @fasaled/muin (npm)
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

WASM: **one module instance per session**, loaded on a **Node worker thread** (`session-worker`). `callMain`, MEMFS, and `JSON.parse` of the object graph run in that worker. The TUI keeps a thin RPC proxy (`createSession` → `createWorkerSession`) so the UI event loop is not blocked. Two open PDFs still do not share MEMFS (two workers).

This does **not** make qpdf faster; it improves responsiveness. The worker script is emitted next to the CLI bundle (`dist/session-worker.js`).

Ink lives only in `packages/cli`.

## Opening a PDF (core)

1. `stat` then size limit (default 200 MiB) before reading bytes.
2. Copy into MEMFS; drop the JS `Buffer`.
3. `qpdf --json=2 --json-stream-data=none --json-key=qpdf` to a MEMFS file.
4. JSON size cap 512 MiB; object cap 200_000.
5. Encrypted files → `EncryptedPdfError`.
6. Reverse index; cwd = `/Root`.

Streams are fetched on demand.

## Commands

Same table as the README. `quit` is TUI-only. `export_graph` feeds MCP.

`find --where`: `/Key == value`, `!=`, `>`, `<`, optional AND. No JS eval.

`export_graph`: default depth 2, max 8, max 5_000 nodes; or `--find` (nodes matching the where, edges among them). MCP / one-shot JSON.

`neighbors`: current object plus its incoming and outgoing refs, each capped (default 8) with a total count. JSON, machine-readable pair of `refs`. Feeds the CLI TUI's graph panel; keyboard-navigable there (`Tab` to focus it, arrows to pick a neighbor, `Enter` = `cd`).

## TUI UI model

- **State panes** show the current object and never scroll: they redraw in place on `cd`/`back` — a graph panel (`neighbors`: incoming / current / outgoing) plus an object panel (`ls`).
- **Everything else is transient.** Any command that isn't `cd`/`back` (`find`, `tree`, `check`, `help`, `history`, …) shows its result in a panel that replaces the state panes and is dismissed explicitly — `Esc`. `cd`/`back` always dismiss it and refresh the state panes.
- **The panel scrolls; the terminal doesn't.** The TUI runs in the alternate screen (no scrollback — see D19), so content taller than the screen would otherwise be unreachable. The TUI's `Overlay` (`App.tsx`) measures its own rendered height with `measureElement` and renders only that many lines, moved by `↑`/`↓`/`PageUp`/`PageDown`, with a `first-last/total` counter.
- There is no growing transcript. Errors are a single status line, replaced by the next outcome, not appended to history.
- `history` is client-only (the typed-command list backing `↑`/`↓` recall) — it opens the same dismissible panel as any core command, but core has no `history` command; the client intercepts the literal line before calling `session.run`.

**Completion**: `packages/core/src/commands/complete.ts` (`complete(line, cursor, ctx)`) is the single source of truth for command-name, flag, and ref completion. `ctx.neighborRefs` comes from data the TUI already has loaded (the `neighbors` result powering the graph panel), so completing a ref never triggers a fresh PDF read. `Tab` opens/cycles the menu, `Enter` only fills the word in — never submits — matching shell completion conventions. `complete()` itself caps the returned list (`COMPLETION_MAX_ITEMS`, 8) — a neighborhood can have up to `NEIGHBORS_DEFAULT_LIMIT` refs, and a menu that long isn't usable, so the cap lives in the one place instead of being reimplemented elsewhere.

**Square brackets mark muin's own summaries, never literal PDF content.** A leading `/` already marks a real PDF name (`/Pages`, `/FlateDecode`) — anything muin generated to describe a shape instead of showing it (`[Stream]`/`[Dict]`/`[Array]` when there is no `/Type` to show, `[dict×2]`/`[array×3]` previews, `[stream]` as a structural marker, `[none]`, `[+N more]`, `[missing]`, `[cycle]`) is bracketed. `pdf/model.ts`'s `bracketKind()` is the shared decision (`name.startsWith("/") ? name : \`[${name}]\``); `displayTypeName()`/`objectTypeName()` stay unbracketed plain strings so `neighbors`/`export_graph` JSON stays clean for MCP — bracketing happens only at render time (`GraphView.tsx`'s `KindSpan`) or, for plain-text commands (`ls`, `cat`, `tree`) where there is no separate structured consumer, baked directly into `commands/format.ts`'s output. New commands or panes that show a muin-generated summary next to real content should follow the same convention rather than inventing another marker.

## Non-goals

Encrypted PDFs, native qpdf, HTTP MCP, publishing `@muin/core` to npm, GitHub Actions.
