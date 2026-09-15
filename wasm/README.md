# qpdf WASM

Full download and compile instructions: [docs/wasm.md](../docs/wasm.md)

```bash
docker build -f wasm/Dockerfile -t muin-qpdf-wasm wasm/
docker run --rm -v "$PWD/vendor/qpdf:/out" muin-qpdf-wasm
```
