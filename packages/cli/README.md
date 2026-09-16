# Muin

<img src="https://raw.githubusercontent.com/fasaled/muin/main/brand/logo.png" width="128" height="128" alt="Muin">

Explore a PDF’s internals from the terminal — indirect objects, streams, page tree, and cross-references — as a navigable graph.

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

Requires Node.js 18+. Encrypted PDFs are not supported.

The unscoped name `muin` is blocked by npm’s similarity filter. The package is `@fasaled/muin`; the command is still `muin`.

## TUI

`muin document.pdf` opens a full-screen explorer: the current object’s neighborhood (incoming / current / outgoing refs), the object itself, and a command box. Those panes redraw in place on `cd` / `back` and never scroll.

- `Tab` with an empty command box switches focus between the graph and the prompt.
- With the graph focused, `←`/`→` pick a pane, `↑`/`↓` pick a neighbor, `Enter` is `cd <ref>`.
- Any other command (`find`, `tree`, `check`, `help`, `history`, `cat`, `stream`, …) opens a dismissible overlay. If it is taller than the screen, `↑`/`↓`/`PageUp`/`PageDown` scroll it; `Esc` closes it.
- `Tab` in the command box opens completion (commands, flags, neighborhood refs).

If stdin is not a TTY, Muin uses a line-oriented REPL instead of the TUI.

One-shot commands (`muin file.pdf check`) open the file, run one verb, and exit. They do not keep `cd` state.

## MCP

`muin --mcp` is a long-lived server. The agent calls `open` with a PDF path, then `ls` / `cd` / `find` / … on that session, then `close`. `muin --mcp document.pdf` pre-opens that file.

## Shell completion

```bash
# bash (current session)
eval "$(muin completion bash)"

# zsh
mkdir -p ~/.zfunc
muin completion zsh > ~/.zfunc/_muin
# then in ~/.zshrc: fpath=(~/.zfunc $fpath) && autoload -Uz compinit && compinit

# fish
mkdir -p ~/.config/fish/completions
muin completion fish > ~/.config/fish/completions/muin.fish
```

```powershell
# PowerShell 5.1+ / pwsh — current session
muin completion powershell | Out-String | Invoke-Expression
```

Completes flags, `*.pdf` files, and one-shot command names. It does not open the PDF to complete object refs.

## Commands

| Command | TUI | MCP | One-shot |
|---|---|---|---|
| `ls` `cd` `pwd` `back` `refs` `neighbors` `cat` `stream` `find` `tree` `check` `help` | yes | yes | yes |
| `open` / `close` | no | yes | no |
| `export_graph` | JSON text | yes | yes |
| `quit` / `exit` | yes | no | no |

`cd` accepts `O G R`, `O,G`, a dictionary key (`/Pages`), or an array index.

## Limits (defaults)

- Max input file: 200 MiB (`--max-bytes`). Size is checked with `stat` before the file is read.
- Max objects: 200_000
- Max structure JSON: 512 MiB (object graph only; stream bodies are not loaded at open)
- `export_graph`: default depth 2, max depth 8, max 5_000 nodes

## License

MIT. Source: [github.com/fasaled/muin](https://github.com/fasaled/muin)
