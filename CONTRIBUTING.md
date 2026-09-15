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
