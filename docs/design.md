# Muin design

Living spec. Implement against this document, not against `implementation-proposal.md`.

Muin is a CLI that treats a PDF’s indirect objects as a navigable graph: outgoing references from the file, incoming references from a reverse index built at session start. One command core; two mutually exclusive clients (TUI and MCP).

## Architecture

```
                         ┌─────────────────────┐
                         │    Command core      │
                         │  (ls, cd, refs, find,│
                         │   export_graph...)   │
                         └──────────┬───────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 │                                      │
        ┌────────▼────────┐                   ┌─────────▼─────────┐
        │   TUI client     │                   │   MCP server       │
        │   (Ink)          │                   │   (official TS SDK)│
        └────────┬─────────┘                   └─────────┬─────────┘
                 │                                        │
                 └───────────────────┬────────────────────┘
                                     │
                          ┌──────────▼───────────┐
                          │   PDF adapter layer   │
                          │ (translates qpdf JSON)│
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │  qpdf (WASM, single   │
                          │  module per session)  │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │   Reverse reference   │
                          │   index (graph)       │
                          └───────────────────────┘
```

Source layout:

```
src/cli.ts                 argv; TUI vs --mcp; never both
src/pdf/model.ts           PdfRef and object values
src/pdf/adapter.ts         PdfAdapter interface
src/pdf/qpdf-json.ts       qpdf JSON v2 → model
src/pdf/qpdf-wasm.ts       load module, FS, callMain, capture stdout
src/graph/                 reverse index, session (cwd, history, path)
src/commands/              parser + pure handlers
src/tui/                   Ink app
src/mcp/                   stdio MCP tools
src/limits.ts
src/errors.ts
vendor/qpdf/               generated wasm + glue
```

The graph engine, command core, TUI, and MCP must not import qpdf’s JSON shape. They speak `PdfAdapter` and `model.ts` only.

## Session

Opening a file:

1. Enforce size limit (default 200 MiB, `--max-bytes` overrides).
2. Load qpdf WASM once for the process.
3. Write the PDF into MEMFS.
4. Run `qpdf --json=2 --json-stream-data=none` to load object **structure** without stream bodies.
5. Fail with a typed error if the file is encrypted or the object count exceeds 200_000.
6. Build the reverse index from every `"O G R"` string in the structure.
7. Set cwd to the catalog (`/Root` from the trailer), history empty, path `[/Root]`.

Stream bytes are fetched later, on demand.

## Adapter contract

`PdfAdapter` (names may match the implementation):

- `loadStructure(path): Structure` — full object map, no stream data
- `getObject(ref): PdfObject` — from the already-loaded structure
- `readStream(ref, mode: "raw" | "decoded"): Uint8Array`
- `check(): CheckReport` — qpdf `--check` plus dangling refs from the reverse index

qpdf is invoked via `callMain`. Host stdout/stderr must not be inherited; capture `print` / `printErr`.

Typical invocations:

- Structure: `--json=2 --json-stream-data=none <in>`
- One object: `--json=2 --json-object=O,G --json-stream-data=none <in>`
- Stream: `--show-object=O,G` and filtered-stream-data flags as required
- Check: `--check <in>` (non-zero exit is data, not a process crash)

## Object model

- `PdfRef`: `{ objectNumber, generation }`
- Values: null, bool, number, string, name (`/Type`), ref, array, dict, stream `{ dict, length }` (bytes not stored on the structure object)
- Indirect objects keyed by ref
- Trailer is distinct from numbered objects

qpdf JSON v2 details live in the parser (`obj:O G R` keys, `"O G R"` ref strings, `value` vs `stream`). See `docs/wasm.md` for the binary; this spec does not depend on qpdf C++ types.

## Commands

Handlers are pure: `(session, args) → Result`. TUI prints `Result`. MCP maps `Result` to tool output. `quit` is TUI-only and exits the process.

| Command | Semantics |
|---|---|
| `ls [<ref>]` | Keys if dict; indices if array; stream metadata (`/Length`, `/Filter`, …) if stream. Default: cwd. |
| `cd <target>` | Target is `O G R`, `O,G`, a key of the current dict (`/Pages`), or an array index. Pushes history. |
| `pwd` | Current ref and the key path from `/Root`. |
| `back` | Pop history. Error if empty. |
| `refs [<ref>]` | Outgoing refs (from the object) and incoming refs (reverse index). |
| `cat [<ref>]` | Full dict/array/scalar; for streams, header + declared length, not bytes. |
| `stream <ref> [--raw \| --decoded]` | Stream bytes. Default `--decoded`. |
| `find --type <Type> [--where "<expr>"]` | Scan all objects. `--type` matches `/Type` or the kind Stream/Dict/Array/… `--where`: see below. |
| `tree [<ref>] [--depth n]` | Page tree from `/Pages` (or the given node). Default depth 3. |
| `check` | Structural findings from qpdf plus dangling refs. Does not crash on irregular files. |
| `export_graph` | MCP only. `{ nodes, edges }` JSON. Bounds below. |
| `help [<command>]` | List verbs or one verb. |
| `quit` / `exit` | TUI only. |

### `find --where`

Small language, not JS eval:

- `/Key == value`, `!=`, numeric `>` `<`
- Optional AND of clauses
- Values: names (`/FlateDecode`), strings, numbers, booleans, `null`

Example: `find --type Stream --where "/Filter == /FlateDecode"`

### `export_graph` bounds

- `--from <ref>` (default: cwd) with `--depth` (default 2, max 8), **or**
- `--find "<expr>"` — nodes matching find, edges among those nodes only
- Max 5_000 nodes; refuse unbounded dumps

## TUI

Ink, command-driven:

- Header: filename, current ref, path
- Scrollable output of recent commands
- Prompt
- `quit` / `exit` / Ctrl+C / Ctrl+D end the process

No visual graph canvas in v1.

## MCP

stdio only. Tools: `ls`, `cd`, `pwd`, `back`, `refs`, `cat`, `stream`, `find`, `tree`, `check`, `export_graph`, `help`. Arguments mirror the CLI flags. `export_graph` returns JSON `{ nodes, edges }` only.

## Errors and limits

Typed errors (do not crash):

- `UsageError` — bad argv or REPL syntax (exit 2 from CLI)
- `EncryptedPdfError`
- `CorruptPdfError` — unreadable even for qpdf’s repair path when we cannot build a session
- `LimitError` — file size or object count
- `NotFoundError` — missing ref, key, or history entry

Defaults: 200 MiB files, 200_000 objects. Irregular but loadable files stay in session; `check` lists problems.

## Non-goals (v1)

- Encrypted PDFs
- Native (non-WASM) qpdf distribution
- HTTP MCP
- Text extraction / rendering
- Visual graph UI
- Requiring Bun to *run* the published CLI
