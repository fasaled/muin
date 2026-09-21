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

**Packaged CLI (as npm would install it):**

```bash
bun run --filter @fasaled/muin build
cd packages/cli
npm pack
TESTDIR=$(mktemp -d)
cd "$TESTDIR"
npm init -y
npm install "$OLDPWD/fasaled-muin-$(node -p "require('./package.json').version").tgz"
npx muin --help
npx muin /path/to/minimal.pdf check
npx muin /path/to/minimal.pdf          # TUI; needs a real terminal
```

`@muin/core` is bundled into `dist/`; the tarball must contain `dist/session-worker.js` and `vendor/qpdf/`. Uninstall the test install when done.

## Releasing

Versions stay in lockstep: `packages/core`, `packages/cli`, and `packages/core/src/version.ts`. Bump all three in the same change, run `bun test` and `bun run typecheck` locally, then merge to `main`. Create the tag and GitHub Release locally — notes plus the source zip/tar.gz GitHub attaches automatically; no extra artifacts:

```bash
gh release create v0.1.0 --title "Muin 0.1.0" --generate-notes --target main
```

Publishing to npm is still manual.
