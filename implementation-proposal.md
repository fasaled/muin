# Implementation Proposal — Muin, a PDF Internal Structure Explorer

> **Historical note:** this document is the original proposal, kept as-is for context. It described a VS Code extension as a third client; that extension was later built and then removed (see `docs/decisions.md`, D20) to focus development on the TUI and MCP server.

## Summary

**Muin** is a tool that represents the internal structure of a PDF file — indirect objects, streams, page tree, cross-references — as a navigable graph. It exposes the same functionality to three clients on top of a single command core with no duplicated logic: a person at the terminal (interactive TUI), an automated agent (MCP server, available both via the CLI and auto-registered inside VS Code), and a person inside VS Code (a visual graph panel, with a command box).

## What it builds

- **Graph navigation, not just tree navigation.** Every object shows both its outgoing references (what it points to) and its incoming references (who points to it). The incoming ones aren't given by the PDF format itself; they require building a reverse index over the document.
- **A REPL-style command language**, with the verbs defined in "Core commands" below.
- **A single command core**, of which the TUI, the MCP server, and the VS Code extension are thin clients:
  - **TUI mode and MCP mode are mutually exclusive on each run of the CLI** — the `muin` binary starts in one or the other, never both at once.
    - **TUI mode**: step-by-step incremental navigation, just like a person would do it.
    - **MCP mode**: starts an MCP server with two access modes —
      - incremental navigation (`ls`, `cd`, `refs`), and
      - subgraph export (`export_graph`: nodes + edges at once, bounded by depth or by the result of a `find`), meant for an agent to reason about the document's overall shape without having to walk it command by command or dump an unbounded large PDF.
  - **VS Code extension**: a third client, independent of the CLI, that imports the command core as a library (no subprocess involved) to display the graph visually inside the editor — see "VS Code extension" below.
- **Robustness against irregular documents**: predictable behavior, explicit size/memory limits, and defined handling for the cases where the tool cannot or should not act (a partially corrupt or non-conformant PDF, without crashing).
- The design separates the graph model from low-level PDF access via an adapter layer (see Architecture), so the graph engine, the REPL, and the MCP server don't depend directly on the PDF access library.

## Core commands

All commands operate on the same session state (current object + history) and are implemented once in the command core; the TUI, the MCP server, and the VS Code extension only differ in how they invoke these functions and how they present the result.

| Command | Syntax | Description | Available in |
|---|---|---|---|
| `ls` | `ls [<ref>]` | Lists the entries of the current object (or the given one): keys if it's a dictionary, indices if it's an array, metadata if it's a stream. | TUI, MCP, VS Code |
| `cd` | `cd <ref>` | Changes the current object to the one given, by reference (`O G R`) or by key/index name from the current object. | TUI, MCP, VS Code |
| `pwd` | `pwd` | Shows the reference of the current object and the key path followed from `/Root` to reach it. | TUI, MCP, VS Code |
| `back` | `back` | Returns to the object visited immediately before, in the navigation history. | TUI, MCP, VS Code |
| `refs` | `refs [<ref>]` | Shows the outgoing and incoming references of the current object (or the given one), using the reverse index. | TUI, MCP, VS Code |
| `cat` | `cat [<ref>]` | Shows the full content of the current object (or the given one): dictionary, primitive value, or header + declared length if it's a stream. | TUI, MCP, VS Code |
| `stream` | `stream <ref> [--raw \| --decoded]` | Extracts the content of a stream, either raw or after applying its declared decompression filters. | TUI, MCP, VS Code |
| `find` | `find --type <Type> [--where "<expr>"]` | Searches the whole graph for objects matching the given type and, optionally, the given condition — e.g. `find --type Stream --where "/Filter == /FlateDecode"`. | TUI, MCP, VS Code |
| `tree` | `tree [<ref>] [--depth <n>]` | Shows the page tree (or the subtree from the given object) up to the given depth. | TUI, MCP, VS Code |
| `check` | `check` | Runs the document's structural validation (xref, generations, broken references) and lists the detected inconsistencies. | TUI, MCP, VS Code |
| `export_graph` | `export_graph [--from <ref>] [--depth <n>] [--find "<expr>"]` | Exports a subgraph (nodes + edges) as JSON, bounded by depth from an object or by the result of a `find`. This is the call that feeds the VS Code visual panel. | MCP, VS Code |
| `help` | `help [<command>]` | Lists the available commands or shows help for a specific one. | TUI, MCP, VS Code |
| `quit` / `exit` | `quit` | Closes the interactive session. | TUI |

## Distribution and installation

Muin is distributed through two independent channels that share the same core internally, but **installation is mutually exclusive from the user's perspective**: it's installed as an npm/bun package to use it as a CLI (TUI or MCP), or installed as an extension from the VS Code Marketplace to use the visual panel — never one as a requirement of the other. The internal core package (see "Components to implement") is a shared build-time/dependency implementation detail, not something the person installs or sees: each channel bundles what it needs from the core inside its own artifact (the CLI's npm package, or the extension's `.vsix`), so installing one doesn't pull in or require the other.

### CLI (npm/bun)

- **Distribution as an npm/bun package.** The installation path is `npm install -g muin` or `bun add -g muin`; there's no separate binary distribution.
- **Cross-platform.** Once installed, the package exposes a command that runs directly from the terminal on macOS, Linux, and Windows, with no additional per-OS configuration steps.
- **Mode selection via CLI.** The command itself decides the execution mode via a flag or subcommand (`muin` for TUI, `muin --mcp` or `muin mcp` for the MCP server). Both modes share the same binary and the same command core; the mode is chosen once, at process startup.
- **Cross-platform compatibility considerations** to resolve during implementation:
  - File paths and separators (Node's `path`, no hardcoded `/` or `\`).
  - Terminal behavior for the TUI (Ink) across the common terminal emulators of each OS, including Windows Terminal/PowerShell.
  - `bin` field in `package.json` with the correct shebang (`#!/usr/bin/env node`) and execute permissions handled by the package manager itself during install.

### VS Code extension

- **Distribution as a `.vsix` on the VS Code Marketplace**, a channel and packaging (`vsce`) completely separate from the npm package — it doesn't reuse the CLI's `bin` or its publishing process.
- **The command core is consumed as a library, not via subprocess.** The graph engine, the `qpdf` adapter layer, and the command core are published as an internal npm package that both the CLI and the extension depend on at build time — each bundles it inside its own final artifact. The extension imports that package directly into its own process, instead of invoking the `muin` binary as a child process; installing the extension doesn't install or require the CLI's npm package.
- **Visual interface inside the editor**: a panel (webview) that renders the graph returned by `export_graph` as navigable nodes and edges — clicking a node internally runs a `cd`, and the panel updates with the outgoing/incoming references of the new current object (`refs`).
- **A command box inside the panel**, just like in the TUI: a text input field in the webview itself where the same core commands can be typed (`find --type Stream --where "..."`, `stream --raw`, `check`, etc.), for queries that don't have a natural click gesture on the graph. It reuses the same command parser used by the TUI and the MCP server — it's not a separate reimplementation of the command language. Click navigation and the text box are two ways of invoking the same core, not two separate interfaces: typing `cd <ref>` in the box and clicking that same node on the graph produce exactly the same effect.
- **No hidden CLI inside the extension**: the extension doesn't start or manage the `muin` binary; the `.vsix` bundles the graph engine embedded, just like the CLI, each with its own instance of `qpdf`'s WASM module.
- **MCP automatically available to agents inside VS Code.** The extension registers the same core MCP server (the one also exposed by the CLI via `muin --mcp`) as a native VS Code provider, using `contributes.mcpServerDefinitionProviders` in `package.json` and `vscode.lm.registerMcpServerDefinitionProvider()` at runtime. Once the extension is installed, VS Code's agent mode (Copilot Chat) discovers and can use Muin's tools without the person editing any `mcp.json` by hand — it's the same core MCP server, just advertised by the extension instead of being manually configured by the user.

## Technical stack

- **Language**: TypeScript.
- **Low-level PDF access**: `qpdf`, compiled to WASM from its official source code and vendored inside the package (see "WASM binary build" below) — with no dependency on third-party npm wrappers. It's a single active upstream project, with no fork fragmentation, and its tolerance for irregular documents (xref repair, inconsistency detection via `--check`) is directly the behavior the tool needs to offer. It's queried through its stable, versioned JSON interface:
  - `--json` / `--json-object=<id>` to get the object graph (or a single object) as JSON, with each indirect object under an `obj:O G R` key and references represented as `"O G R"` strings.
  - `--show-object=<id>` for incremental access to a single object without dumping the whole document, needed to navigate large PDFs without loading them entirely into memory.
- **Terminal interface**: `Ink` (component-based declarative TUI).
- **Agent protocol**: official TypeScript SDK for MCP, to expose the internal REPL's verbs as *tools*.
- **VS Code extension**: VS Code Extension API + `Webview` for the graph visualization panel; a lightweight graph-rendering library (e.g. `vis-network` or `d3`) inside the webview to draw nodes and edges from `export_graph`'s JSON.

### Identified technical risk

Four distinct risks:

1. `qpdf` is invoked as a WASM binary (`callMain`), not as a native API of typed objects; every query involves invoking the binary and parsing its JSON output, instead of navigating in-memory structures directly like `PDFRef`/`PDFDict`.

   **Mitigation**: the adapter layer (see Architecture) translates `qpdf`'s JSON responses into the graph engine's own object model, and keeps a single instance of the WASM module alive per session to avoid the startup cost on every query.

2. By compiling `qpdf` to WASM in-house (instead of depending on an already-published npm wrapper), the build pipeline itself becomes the project's responsibility: it has to be maintained every time `qpdf`'s version is updated.

   **Mitigation**: automate the build as a CI job (see "WASM binary build") instead of compiling it manually, and pin a specific version of `qpdf` and of the Emscripten toolchain so the process is reproducible.

3. With two distribution channels (the CLI's npm package and the extension's `.vsix`) depending on the same core, there's a risk of them drifting apart — the extension ending up published against a different core version than the one the CLI uses.

   **Mitigation**: the core (graph engine + `qpdf` adapter + commands) is versioned as a single internal package that both the CLI and the extension depend on with a pinned version, bumped explicitly in both consumers in the same change, never independently.

4. Inside the extension, the core is consumed in two simultaneous ways with different needs: one-off calls to feed the visual panel (click on a node → `cd` + `refs`, one query at a time, tied to the webview's lifecycle), and as a long-running MCP server registered via `McpServerDefinitionProvider` (a persistent session an agent can use in parallel, with its own navigation state). If the internal core package's public API isn't designed for both uses from the start, there's a risk of ending up with duplicated session/state logic between the panel's code and the code that starts the MCP server inside the extension.

   **Architectural recommendation**: the internal core package should explicitly expose **session management as part of its public API**, not just standalone command functions — that is, a `createSession(pdf)`-type function that returns an object holding the navigation state (current object, history) with the same commands (`ls`, `cd`, `refs`, `find`, `export_graph`...) bound to that session. This way:
   - The visual panel creates one session per open document and reuses it for as long as the webview is alive.
   - The MCP server registered by the extension creates one session per connection/agent, without interfering with the panel's session or reimplementing state handling.
   - The CLI (TUI and `muin --mcp`) uses the exact same `createSession` function, so session behavior is identical across all three clients by construction, not by discipline of keeping them manually in sync.

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
                         │  internal package    │
                         └──────────┬───────────┘
                                    │
              ┌──────────────────┬─┴──────────────────┐
              │                  │                     │
     ┌────────▼────────┐ ┌───────▼────────┐  ┌─────────▼─────────┐
     │   TUI client     │ │  MCP server    │  │  VS Code extension │
     │   (Ink)          │ │  (official TS  │  │  (Webview + graph) │
     │                  │ │   SDK)         │  │                     │
     └────────┬─────────┘ └───────┬────────┘  └─────────┬─────────┘
              │                   │                      │
              └───────────────────┴──────────┬───────────┘
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

Note: the CLI (TUI + MCP) and the VS Code extension are two separate distribution packages/artifacts that depend on the same internal core package — they don't share a process or a binary at runtime.

## Components to implement

1. **PDF adapter layer**: invokes `qpdf`'s WASM module (`--json-object=`, `--show-object=`), parses its JSON output, and exposes objects, streams, dictionaries, and references in its own model, decoupled from `qpdf`'s output format.
2. **WASM build pipeline**: `Dockerfile` + CI job that compiles `zlib`, `libjpeg-turbo`, and `qpdf` to WASM with Emscripten, producing the vendored `.wasm` + JS glue that the adapter layer consumes (see "WASM binary build").
3. **Graph engine**: builds the reverse reference index over the adapter layer's model; exposes queries (`find`) and navigation (`cd`, `refs`).
4. **Command core (internal REPL)**: implements the commands defined in "Core commands" (`ls`, `cd`, `pwd`, `back`, `refs`, `cat`, `stream`, `find`, `tree`, `check`, `export_graph`, `help`) as pure functions over the graph engine, exposed through a session API (`createSession(pdf)`) that encapsulates per-session navigation state (current object, history), with no dependency on the TUI, MCP, or VS Code.
5. **Internal core package**: publishes the graph engine + adapter layer + command core as an npm package that both the CLI and the VS Code extension depend on, with a pinned version.
6. **TUI client**: Ink interface that consumes the command core for interactive navigation.
7. **MCP server**: exposes the same verbs as MCP *tools*, with support for incremental navigation and bounded subgraph export.
8. **VS Code extension**: imports the internal core package, renders the graph in a webview from `export_graph`, translates clicking a node into commands (`cd`, `refs`) against the core, includes a text box inside the webview that reuses the same command parser as the TUI, and registers the core's MCP server as an `McpServerDefinitionProvider` so VS Code's agent mode discovers it automatically on install.
9. **Error and limit handling**: size/memory validation, detection and reporting of structural inconsistencies, defined behavior for non-conformant PDFs.
10. **CLI entrypoint and mode selection**: the package's single entry point (defined in `package.json`'s `bin`) that parses the startup arguments and decides whether the process runs as TUI or as an MCP server, delegating to the corresponding component.
11. **CLI packaging and publishing**: build and `package.json` configuration for publishing to the npm registry, also installable with `bun`, with verified correct startup on macOS, Linux, and Windows.
12. **Extension packaging and publishing**: `vsce` configuration and publishing to the VS Code Marketplace, as a distribution channel independent of the CLI's npm package.

## Data handling considerations

- The tool exposes the PDF's structure as-is; it doesn't semantically interpret the content — interpretation is left to whoever is querying it (a person or an agent).
- `export_graph` must support explicit bounding (by depth or by a `find` result) to avoid full dumps of large documents.
