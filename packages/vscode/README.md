# Muin

<img src="https://raw.githubusercontent.com/fasaled/muin/main/brand/logo.png" width="128" height="128" alt="Muin">

Explore a PDF’s internals in the editor — indirect objects, streams, page tree, and cross-references — as a navigable graph.

## Usage

Install the **Muin** extension. Run **Muin: Explore PDF** from the Command Palette, or right-click a `.pdf` in the Explorer. Pick a file if one is not already selected. A tab titled `Muin: <file>` opens beside the editor.

The panel shows the current object’s neighborhood (incoming / current / outgoing refs), the object itself, and a command box.

- Click a neighbor, or a ref in the object pane, to `cd`.
- `Tab` / arrows / `Enter` / `Esc` move between the graph and the prompt, pick a neighbor, and complete commands.
- Any command other than `cd` / `back` (`find`, `tree`, `check`, `help`, `history`, `cat`, `stream`, …) opens its result in a panel over the graph. Close it with `Esc` or the panel’s close button.

Encrypted PDFs are not supported.

## Copilot / MCP

Once the extension is installed, Copilot agent mode discovers Muin’s tools without editing `mcp.json`. The agent should call `open` on a workspace PDF (the path may be omitted to use the focused file: the active tab if it is a `.pdf`, otherwise the file already in the Muin panel). `focused` returns that path. `close` ends the session.

## Commands

| Command | Panel | MCP |
|---|---|---|
| `ls` `cd` `pwd` `back` `refs` `neighbors` `cat` `stream` `find` `tree` `check` `help` | yes | yes |
| `open` / `close` | no | yes (`open` can omit path → focused PDF) |
| `focused` | no | path of the focused PDF |
| `export_graph` | no (panel uses `neighbors`) | yes |

`cd` accepts `O G R`, `O,G`, a dictionary key (`/Pages`), or an array index.

## Limits (defaults)

- Max input file: 200 MiB
- Max objects: 200_000
- Max structure JSON: 512 MiB (object graph only; stream bodies are not loaded at open)

## License

MIT. Source: [github.com/fasaled/muin](https://github.com/fasaled/muin)
