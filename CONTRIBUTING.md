# Contributing

Development uses Bun. Read these before changing behavior:

1. [README.md](README.md)
2. [docs/design.md](docs/design.md)
3. [docs/decisions.md](docs/decisions.md)
4. [docs/agents.md](docs/agents.md)
5. [docs/wasm.md](docs/wasm.md) if you touch PDF loading or `vendor/qpdf/`

```bash
bun install
bun test
bun run typecheck
bun run build
```

Rebuild qpdf WASM only with Docker, as documented in `docs/wasm.md`. Do not add a third-party qpdf npm wrapper.

## Testing the VS Code extension

The extension only runs built (`dist/extension.js`, `dist/mcp-stdio.js`, `dist/session-worker.js`); there is no source-mode debug path.

**Extension Development Host (fastest loop):**

1. Open this repo's root folder in VS Code.
2. Press `F5` (or Run and Debug → "Run Muin extension"). This runs the `muin: build vscode extension` task first, then opens a second VS Code window with the extension loaded, workspace-rooted at `fixtures/pdf/`.
3. In that window: right-click `minimal.pdf` in the Explorer → **Muin: Explore PDF**, or use the Command Palette (`Muin: Explore PDF`). A tab titled `Muin: minimal.pdf` opens **beside** the editor — there is no Activity Bar icon. If opening fails, VS Code shows an error toast. Reload the dev host window (`Cmd+R` / `Ctrl+R`) after code changes; there is no hot reload, so re-run the build task first if you only edited `.ts` files (the `F5` launch does this for you, but a manual reload does not).
4. To test Copilot's MCP integration, open Copilot Chat in agent mode in the dev host window — it should discover the `muin.mcp` server without any `mcp.json` edit and can `open` a workspace PDF itself.

**Packaged `.vsix` (closer to what users install):**

```bash
bun run --filter muin build
cd packages/vscode
bunx @vscode/vsce package --no-dependencies
code --install-extension muin-0.0.0.vsix
```

Use this before a release, or when a bug might be specific to packaging (vendored `vendor/qpdf/`, or path resolution that differs between the dev host and an installed `.vsix`). Uninstall with **Extensions → Muin → Uninstall** when done.
