# Muin

A tool that represents the internal structure of a PDF file — indirect objects, streams, page tree, cross-references — as a navigable graph.

Three clients share one command core. You install **either** the CLI **or** the VS Code extension; neither requires the other.

| Client | How to get it | What you get |
|---|---|---|
| TUI / REPL | `npm install -g @fasaled/muin` | `muin file.pdf` |
| MCP (terminal / agents) | same CLI | `muin --mcp file.pdf` |
| VS Code panel + Copilot MCP | Marketplace extension `fasaled.muin` | **Muin: Explore PDF**; MCP registered automatically |

The unscoped npm name `muin` is blocked by npm’s similarity filter. The CLI package is `@fasaled/muin`; the command is still `muin`.

## CLI

```bash
npm install -g @fasaled/muin
# or
bun add -g @fasaled/muin

muin document.pdf
muin --mcp document.pdf
muin --max-bytes 10485760 document.pdf
muin --help
```

Requires Node.js 18+. If stdin is not a TTY, the CLI uses a line-oriented REPL instead of Ink. Encrypted PDFs are not supported.

## VS Code

Install the **Muin** extension. Run **Muin: Explore PDF**, pick a file. The panel shows a graph (`export_graph`) and a command box that uses the same language as the TUI. Copilot agent mode discovers Muin’s MCP tools without editing `mcp.json`. The extension does **not** spawn the `muin` CLI; it bundles the core and qpdf WASM in the `.vsix`.

## Commands

| Command | TUI | MCP | VS Code |
|---|---|---|---|
| `ls` `cd` `pwd` `back` `refs` `cat` `stream` `find` `tree` `check` `help` | yes | yes | yes |
| `export_graph` | JSON text | yes | feeds the graph |
| `quit` / `exit` | yes | no | close the panel |

`cd` accepts `O G R`, `O,G`, a dictionary key (`/Pages`), or an array index.

## Limits (defaults)

- Max input file: 200 MiB (`--max-bytes`). Size is checked with `stat` before the file is read.
- Max objects: 200_000
- Max structure JSON: 512 MiB (object graph only; stream bodies are not loaded at open)
- `export_graph`: default depth 2, max depth 8, max 5_000 nodes

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
bun packages/cli/src/cli.ts fixtures/pdf/minimal.pdf
```

This is a Bun workspace: `packages/core` (private), `packages/cli` (`@fasaled/muin`), `packages/vscode` (extension).

## Documentation

| Doc | What it is |
|---|---|
| [docs/design.md](docs/design.md) | Living spec |
| [docs/decisions.md](docs/decisions.md) | Technical decisions |
| [docs/wasm.md](docs/wasm.md) | qpdf download and compile |
| [docs/agents.md](docs/agents.md) | How this repo is built |
| [implementation-proposal.md](implementation-proposal.md) | Original proposal (historical) |

## License

MIT. See [LICENSE](LICENSE).
