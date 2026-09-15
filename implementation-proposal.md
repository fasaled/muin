# Implementation Proposal — Muin, a PDF Internal Structure Explorer

## Summary

**Muin** is a command-line tool (TUI + REPL) that represents the internal structure of a PDF file — indirect objects, streams, page tree, cross-references — as a navigable graph. It exposes the same functionality to two clients: a person (interactive TUI) and an automated agent (MCP server), both on top of a single command core with no duplicated logic.

## What it builds

- **Graph navigation, not just tree navigation.** Every object shows both its outgoing references (what it points to) and its incoming references (who points to it). The incoming ones aren't given by the PDF format itself; they require building a reverse index over the document.
- **A REPL-style command language**, with the verbs defined in "Core commands" below.
- **A single command core**, of which the TUI and MCP are thin clients, **mutually exclusive on each run** — the binary starts in one mode or the other, never both at once:
  - **TUI mode**: step-by-step incremental navigation, just like a person would do it.
  - **MCP mode**: starts an MCP server with two access modes —
    - incremental navigation (`ls`, `cd`, `refs`), and
    - subgraph export (`export_graph`: nodes + edges at once, bounded by depth or by the result of a `find`), meant for an agent to reason about the document's overall shape without having to walk it command by command or dump an unbounded large PDF.
- **Robustness against irregular documents**: predictable behavior, explicit size/memory limits, and defined handling for the cases where the tool cannot or should not act (a partially corrupt or non-conformant PDF, without crashing).
- The design separates the graph model from low-level PDF access via an adapter layer (see Architecture), so the graph engine, the REPL, and the MCP server don't depend directly on the PDF access library.

## Core commands

All commands operate on the same session state (current object + history) and are implemented once in the command core; the TUI and MCP only differ in how they invoke these functions and how they present the result.

| Command | Syntax | Description | Available in |
|---|---|---|---|
| `ls` | `ls [<ref>]` | Lists the entries of the current object (or the given one): keys if it's a dictionary, indices if it's an array, metadata if it's a stream. | TUI, MCP |
| `cd` | `cd <ref>` | Changes the current object to the one given, by reference (`O G R`) or by key/index name from the current object. | TUI, MCP |
| `pwd` | `pwd` | Shows the reference of the current object and the key path followed from `/Root` to reach it. | TUI, MCP |
| `back` | `back` | Returns to the object visited immediately before, in the navigation history. | TUI, MCP |
| `refs` | `refs [<ref>]` | Shows the outgoing and incoming references of the current object (or the given one), using the reverse index. | TUI, MCP |
| `cat` | `cat [<ref>]` | Shows the full content of the current object (or the given one): dictionary, primitive value, or header + declared length if it's a stream. | TUI, MCP |
| `stream` | `stream <ref> [--raw \| --decoded]` | Extracts the content of a stream, either raw or after applying its declared decompression filters. | TUI, MCP |
| `find` | `find --type <Type> [--where "<expr>"]` | Searches the whole graph for objects matching the given type and, optionally, the given condition — e.g. `find --type Stream --where "/Filter == /FlateDecode"`. | TUI, MCP |
| `tree` | `tree [<ref>] [--depth <n>]` | Shows the page tree (or the subtree from the given object) up to the given depth. | TUI, MCP |
| `check` | `check` | Runs the document's structural validation (xref, generations, broken references) and lists the detected inconsistencies. | TUI, MCP |
| `export_graph` | `export_graph [--from <ref>] [--depth <n>] [--find "<expr>"]` | Exports a subgraph (nodes + edges) as JSON, bounded by depth from an object or by the result of a `find`. | MCP |
| `help` | `help [<command>]` | Lists the available commands or shows help for a specific one. | TUI, MCP |
| `quit` / `exit` | `quit` | Closes the interactive session. | TUI |

## Distribution and installation

- **Distribution as an npm/bun package.** The installation path is `npm install -g muin` or `bun add -g muin`; there's no separate binary distribution.
- **Cross-platform.** Once installed, the package exposes a command that runs directly from the terminal on macOS, Linux, and Windows, with no additional per-OS configuration steps.
- **Mode selection via CLI.** The command itself decides the execution mode via a flag or subcommand (`muin` for TUI, `muin --mcp` or `muin mcp` for the MCP server). Both modes share the same binary and the same command core; the mode is chosen once, at process startup.
- **Cross-platform compatibility considerations** to resolve during implementation:
  - File paths and separators (Node's `path`, no hardcoded `/` or `\`).
  - Terminal behavior for the TUI (Ink) across the common terminal emulators of each OS, including Windows Terminal/PowerShell.
  - `bin` field in `package.json` with the correct shebang (`#!/usr/bin/env node`) and execute permissions handled by the package manager itself during install.

## Technical stack

- **Language**: TypeScript.
- **Low-level PDF access**: `qpdf`, compiled to WASM from its official source code and vendored inside the package (see "WASM binary build" below) — with no dependency on third-party npm wrappers. It's a single active upstream project, with no fork fragmentation, and its tolerance for irregular documents (xref repair, inconsistency detection via `--check`) is directly the behavior the tool needs to offer. It's queried through its stable, versioned JSON interface:
  - `--json` / `--json-object=<id>` to get the object graph (or a single object) as JSON, with each indirect object under an `obj:O G R` key and references represented as `"O G R"` strings.
  - `--show-object=<id>` for incremental access to a single object without dumping the whole document, needed to navigate large PDFs without loading them entirely into memory.
- **Terminal interface**: `Ink` (component-based declarative TUI).
- **Agent protocol**: official TypeScript SDK for MCP, to expose the internal REPL's verbs as *tools*.

### Identified technical risk

Two distinct risks:

1. `qpdf` is invoked as a WASM binary (`callMain`), not as a native API of typed objects; every query involves invoking the binary and parsing its JSON output, instead of navigating in-memory structures directly like `PDFRef`/`PDFDict`.

   **Mitigation**: the adapter layer (see Architecture) translates `qpdf`'s JSON responses into the graph engine's own object model, and keeps a single instance of the WASM module alive per session to avoid the startup cost on every query.

2. By compiling `qpdf` to WASM in-house (instead of depending on an already-published npm wrapper), the build pipeline itself becomes the project's responsibility: it has to be maintained every time `qpdf`'s version is updated.

   **Mitigation**: automate the build as a CI job (see "WASM binary build") instead of compiling it manually, and pin a specific version of `qpdf` and of the Emscripten toolchain so the process is reproducible.

## WASM binary build

`qpdf` isn't consumed as an npm dependency; instead, its WASM binary is compiled from the official source code (`qpdf/qpdf`) as part of the project's infrastructure, and the result (`.wasm` + JS glue) is vendored inside the published package.

### Build dependencies

- A C++17 compiler and CMake (required by `qpdf`).
- `zlib` and `libjpeg-turbo`, compiled to WASM before `qpdf` itself (they're its native dependencies).
- Emscripten SDK (`emsdk`), pinned to a specific version.
- GnuTLS/OpenSSL are omitted if the tool doesn't need to open password-encrypted PDFs, to reduce the build's dependency surface.

### Compilation pipeline

1. Compile `zlib` to WASM with `emconfigure`/`emmake`.
2. Compile `libjpeg-turbo` to WASM with `emcmake` (requires a minor patch, already documented in existing reference builds).
3. Compile `qpdf` to WASM with `emcmake cmake`, linking against the two libraries above.
4. Link the result with `emcc`, exposing `callMain` and the virtual filesystem (`FS`), producing the `.wasm` together with its loader JS module (`MODULARIZE`, `EXPORT_ES6`).

### How it's managed

- The pipeline is defined in a `Dockerfile` with a version-pinned `emsdk` image, so the build is reproducible regardless of the machine running it.
- It runs as a CI job, not manually on each development machine: it's triggered when the `qpdf` version is pinned or updated, and its result (`.wasm` + JS glue) is either versioned as an artifact inside the repository or published as an internal package that the main package depends on.
- Updating the `qpdf` version is an explicit, traceable change (version bump in the pipeline + artifact regeneration), never a silent update of a third-party dependency.

## Proposed architecture (high level)

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

## Components to implement

1. **PDF adapter layer**: invokes `qpdf`'s WASM module (`--json-object=`, `--show-object=`), parses its JSON output, and exposes objects, streams, dictionaries, and references in its own model, decoupled from `qpdf`'s output format.
2. **WASM build pipeline**: `Dockerfile` + CI job that compiles `zlib`, `libjpeg-turbo`, and `qpdf` to WASM with Emscripten, producing the vendored `.wasm` + JS glue that the adapter layer consumes (see "WASM binary build").
3. **Graph engine**: builds the reverse reference index over the adapter layer's model; exposes queries (`find`) and navigation (`cd`, `refs`).
4. **Command core (internal REPL)**: implements the commands defined in "Core commands" (`ls`, `cd`, `pwd`, `back`, `refs`, `cat`, `stream`, `find`, `tree`, `check`, `export_graph`, `help`) as pure functions over the graph engine, with no dependency on the TUI or MCP.
5. **TUI client**: Ink interface that consumes the command core for interactive navigation.
6. **MCP server**: exposes the same verbs as MCP *tools*, with support for incremental navigation and bounded subgraph export.
7. **Error and limit handling**: size/memory validation, detection and reporting of structural inconsistencies, defined behavior for non-conformant PDFs.
8. **CLI entrypoint and mode selection**: the package's single entry point (defined in `package.json`'s `bin`) that parses the startup arguments and decides whether the process runs as TUI or as an MCP server, delegating to the corresponding component.
9. **Packaging and publishing**: build and `package.json` configuration for publishing to the npm registry, also installable with `bun`, with verified correct startup on macOS, Linux, and Windows.

## Data handling considerations

- The tool exposes the PDF's structure as-is; it doesn't semantically interpret the content — interpretation is left to whoever is querying it (a person or an agent).
- `export_graph` must support explicit bounding (by depth or by a `find` result) to avoid full dumps of large documents.
