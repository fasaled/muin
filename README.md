# Muin

A command-line tool (TUI + REPL) that represents the internal structure of a PDF file — indirect objects, streams, page tree, cross-references — as a navigable graph.

The same command core serves two clients, chosen once at process start:

- a person, via an interactive TUI
- an agent, via an MCP server on stdio

**Status:** The command core, TUI, MCP server, and vendored qpdf WASM (`vendor/qpdf/`) are in tree. The npm registry still has `0.0.0` until you publish `0.1.0`.

The unscoped name `muin` is blocked by npm’s similarity filter. Install the scoped package; the binary is still `muin`.

## Install

```bash
npm install -g @fasaled/muin
# or
bun add -g @fasaled/muin
```

Requires Node.js 18 or later to run. Development uses [Bun](https://bun.sh).

## Usage

```bash
muin document.pdf          # TUI
muin --mcp document.pdf    # MCP server on stdio
muin --help
muin --version
```

`--mcp` and the TUI are mutually exclusive.

## Commands

Implemented once in the command core. The TUI and MCP only differ in how they invoke these verbs and how they present the result.

| Command | Syntax | TUI | MCP |
|---|---|---|---|
| `ls` | `ls [<ref>]` | yes | yes |
| `cd` | `cd <ref>` | yes | yes |
| `pwd` | `pwd` | yes | yes |
| `back` | `back` | yes | yes |
| `refs` | `refs [<ref>]` | yes | yes |
| `cat` | `cat [<ref>]` | yes | yes |
| `stream` | `stream <ref> [--raw \| --decoded]` | yes | yes |
| `find` | `find --type <Type> [--where "<expr>"]` | yes | yes |
| `tree` | `tree [<ref>] [--depth <n>]` | yes | yes |
| `check` | `check` | yes | yes |
| `export_graph` | `export_graph [--from <ref>] [--depth <n>] [--find "<expr>"]` | no | yes |
| `help` | `help [<command>]` | yes | yes |
| `quit` / `exit` | `quit` | yes | no |

`cd` accepts an object reference (`O G R` or `O,G`), a dictionary key from the current object (`/Pages`), or an array index.

Encrypted PDFs are not supported in v1 (the vendored qpdf WASM is built without OpenSSL/GnuTLS).

## MCP

```bash
muin --mcp document.pdf
```

Speak MCP over stdio. Tools match the table above (`export_graph` included). Example client config:

```json
{
  "mcpServers": {
    "muin": {
      "command": "muin",
      "args": ["--mcp", "/absolute/path/to/document.pdf"]
    }
  }
}
```

## Limits (defaults)

- Max input file: 200 MiB (`--max-bytes` overrides)
- Max objects: 200_000
- `export_graph`: default depth 2, max depth 8, max 5_000 nodes

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
bun src/cli.ts --help
```

## Documentation

| Doc | What it is |
|---|---|
| [docs/design.md](docs/design.md) | Living spec (architecture, commands, adapter, MCP) |
| [docs/decisions.md](docs/decisions.md) | Technical decisions |
| [docs/wasm.md](docs/wasm.md) | qpdf download and compile (added with the WASM pipeline) |
| [docs/agents.md](docs/agents.md) | How this repo is built with coding agents |
| [implementation-proposal.md](implementation-proposal.md) | Original proposal (historical) |

## License

MIT. See [LICENSE](LICENSE).
