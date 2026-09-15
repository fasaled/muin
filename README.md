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
muin document.pdf check
muin document.pdf ls 3 0 R
muin document.pdf find --type Stream --where "/Filter == /FlateDecode"
muin --mcp
muin --mcp document.pdf          # optional: pre-open this file
muin --max-bytes 10485760 document.pdf
muin help
muin --help
```

Shell completion (bash, zsh, fish, and PowerShell / `pwsh`):

```bash
# bash (current session)
eval "$(muin completion bash)"

# zsh — put the script on your fpath, e.g.
mkdir -p ~/.zfunc
muin completion zsh > ~/.zfunc/_muin
# then in ~/.zshrc: fpath=(~/.zfunc $fpath) && autoload -Uz compinit && compinit

# fish
mkdir -p ~/.config/fish/completions
muin completion fish > ~/.config/fish/completions/muin.fish
```

```powershell
# PowerShell 5.1+ / pwsh (Windows, macOS, Linux) — current session
muin completion powershell | Out-String | Invoke-Expression

# persist: add that line to your profile
#   code $PROFILE
```

Completes flags, `*.pdf` files, and one-shot command names (`ls`, `find`, …). It does not open the PDF to complete object refs.

The TUI has two state panes that redraw in place — the current object's neighborhood (incoming/outgoing refs) and the object itself — plus a command box, all always visible; the panes themselves never scroll. `Tab` with an empty command box switches focus between the graph and the prompt; while the graph is focused, `←`/`→` pick a pane, `↑`/`↓` pick a neighbor, and `Enter` does the equivalent of `cd <ref>`. Any command other than `cd`/`back` (`find`, `tree`, `check`, `help`, `history`, `cat`, `stream`, …) opens its result in a dismissible panel over the graph; if the result is taller than the screen, `↑`/`↓`/`PageUp`/`PageDown` scroll it (a `12-34/80`-style counter shows where you are) and `Esc` closes it. `cd`/`back` always close that panel and refresh both state panes.

Typing a partial command, flag, or ref and pressing `Tab` opens a completion menu (command names, per-command flags, and refs from the current neighborhood); `Tab` again cycles it, `↑`/`↓` move the selection, `Enter` fills the word in (a second `Enter` runs it), `Esc` closes the menu. The VS Code panel's command box has the same `Tab` completion, as a dropdown under the input.

Requires Node.js 18+. If stdin is not a TTY, the CLI uses a line-oriented REPL instead of Ink. Encrypted PDFs are not supported.

MCP is a long-lived server. The agent calls `open` with a PDF path, then `ls` / `cd` / `find` / … on that session, then `close`. The TUI still takes the file on the command line. One-shot commands (`muin file.pdf check`) open the file, run one verb, and exit — useful in scripts; they do not keep `cd` state.

## VS Code

Install the **Muin** extension. Run **Muin: Explore PDF**, pick a file. Like the TUI, the panel keeps the graph and the current object always visible and never scrolling; any command other than `cd`/`back` (`find`, `tree`, `check`, `help`, `history`, …) opens its result in a panel over the graph, closed with `Esc` or its own close button. The command box has the same `Tab` completion as the TUI. Copilot agent mode discovers Muin’s MCP tools without editing `mcp.json` and should `open` a workspace PDF itself. The extension does **not** spawn the `muin` CLI; it bundles the core and qpdf WASM in the `.vsix`.

## Commands

| Command | TUI | MCP | VS Code |
|---|---|---|---|
| `ls` `cd` `pwd` `back` `refs` `neighbors` `cat` `stream` `find` `tree` `check` `help` | yes | yes | yes |
| `open` / `close` | no | yes | MCP only |
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

## Development process

Design, decisions, and code are developed in collaboration with AI coding agents (Claude Code). Architectural choices are recorded in [docs/decisions.md](docs/decisions.md) as they're made; [docs/agents.md](docs/agents.md) is the working process the agents follow. Every change is reviewed, tested (`bun test`), and typechecked before it merges.

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
