# Muin design

Living spec. Implement against this document, not against `implementation-proposal.md`.

Muin treats a PDF’s indirect objects as a navigable graph (outgoing refs from the file, incoming refs from a reverse index). **One command core**, three clients:

| Client | Process | Session |
|---|---|---|
| TUI / REPL | `muin file.pdf` | one per CLI process |
| MCP (CLI) | `muin --mcp file.pdf` | one per CLI process |
| VS Code panel | extension host, library import | one per open PDF webview |
| VS Code Copilot MCP | vsix `mcp-stdio.js` child (not the CLI binary) | one per connection / PDF |

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

## VS Code

- Command **Muin: Explore PDF** opens a webview: vis-network graph from `export_graph --depth 2`, click → `cd`, command box → `session.run`.
- MCP: `contributes.mcpServerDefinitionProviders` + `registerMcpServerDefinitionProvider`. Stdio command is Node + `dist/mcp-stdio.js` + PDF path (last explored file, or a file picker in `resolveMcpServerDefinition`).
- Panel session and Copilot session are separate.

## Non-goals

Encrypted PDFs, native qpdf, HTTP MCP, spawning the `muin` CLI from the extension, publishing `@muin/core` to npm, compiling qpdf on GitHub Actions, WASM in the webview.
