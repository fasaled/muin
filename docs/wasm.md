# qpdf download and compile

Muin vendors a WebAssembly build of the official [qpdf](https://github.com/qpdf/qpdf) CLI. There is **no** third-party npm qpdf wrapper. Rebuilds are our job: pin versions, compile in Docker, commit `vendor/qpdf/`.

Install-time compile is forbidden. `npm install -g @fasaled/muin` must unpack a prebuilt `.wasm`.

## Why in-house WASM

qpdf’s JSON v2 interface (`--json`, `--json-object`, `--show-object`, `--check`) is the PDF backend. Wrappers on npm lag upstream and are not the pin we want. Compiling from the official tag keeps `--check` behavior and JSON shape under our control.

## Pinned versions

Declared in `wasm/pins.env` and the `ARG`s in `wasm/Dockerfile`. Current pins:

| Component | Pin | Upstream |
|---|---|---|
| emsdk image | `emscripten/emsdk:3.1.73` | https://hub.docker.com/r/emscripten/emsdk |
| qpdf | git tag `v12.4.1` | https://github.com/qpdf/qpdf.git |
| zlib | git tag `v1.3.1` | https://github.com/madler/zlib.git |
| libjpeg-turbo | git tag `3.0.3` | https://github.com/libjpeg-turbo/libjpeg-turbo.git |

Checksums of the current committed outputs (`shasum -a 256`):

```
8a4aed6f8f5ee675f359b8b5dcf0e772a2de3884706c743e8dad1a517bf21c10  vendor/qpdf/qpdf.wasm
478e36e1933a6f0e2f3060d0e6dcc622146a14668416d771f7df4e5943112fe3  vendor/qpdf/qpdf.mjs
```

Source pins are git tags, not floating `main`.

## What is omitted

OpenSSL and GnuTLS are **not** compiled. CMake is invoked with `-DUSE_IMPLICIT_CRYPTO=OFF -DREQUIRE_CRYPTO_NATIVE=ON`. Encrypted PDFs are unsupported; the adapter raises `EncryptedPdfError`.

## Host requirements

Docker. Contributors do not need emsdk, CMake, or a C++ toolchain on the host.

## Download steps

The Dockerfile `git clone --depth 1 --branch <tag>` each upstream. To debug the same clones by hand:

```bash
git clone --depth 1 --branch v1.3.1 https://github.com/madler/zlib.git
git clone --depth 1 --branch 3.0.3 https://github.com/libjpeg-turbo/libjpeg-turbo.git
git clone --depth 1 --branch v12.4.1 https://github.com/qpdf/qpdf.git
```

## Compile sequence

1. **zlib** — `emconfigure ./configure --prefix=$OUT --static` then `emmake make install`.
2. **libjpeg-turbo** — apply `wasm/patches/jpeg-turbo.patch` if it still applies (BIT_BUF_SIZE on Emscripten). `emcmake cmake` with `-DENABLE_SHARED=OFF -DWITH_SIMD=0`. `emmake make install`.
3. **qpdf** — `emcmake cmake` with native crypto only, static lib, `-DBUILD_TESTING=OFF`. Build **only** the `libqpdf` target (full `cmake --build` also compiles qpdf’s own tests/fuzzers, which are unrelated and can SIGSEGV under Emscripten).
4. **Link the CLI** — `emcc` on `qpdf/qpdf.cc` plus `libqpdf.a`, `-lz -ljpeg`, with:
   - `callMain`, `FS`
   - `MODULARIZE=1`, `EXPORT_ES6=1`, `ENVIRONMENT=node`
   - `ALLOW_MEMORY_GROWTH=1`, `WASM_BIGINT=1`
   - `NO_DISABLE_EXCEPTION_CATCHING=1`
   - `--pre-js wasm/js/pre.js` (`noInitialRun`)
   - `--post-js wasm/js/post.js`

Stdout from `callMain` is captured in JS via the module `print` / `printErr` hooks as a **list of chunks** (see `src/pdf/qpdf-wasm.ts`). Never inherit host stdout. Structure dumps go to a MEMFS file (`--json … /work/structure.json`) so a large object graph is not concatenated line-by-line on stdout.

## Outputs

Copied to `vendor/qpdf/`:

- `qpdf.mjs` — ES module glue
- `qpdf.wasm` — binary

Committed. `src/pdf/qpdf-wasm.ts` loads them via `fileURLToPath`.

## Local rebuild

```bash
docker build -f wasm/Dockerfile -t muin-qpdf-wasm wasm/
docker run --rm -v "$PWD/vendor/qpdf:/out" muin-qpdf-wasm
shasum -a 256 vendor/qpdf/qpdf.wasm vendor/qpdf/qpdf.mjs
bun test
```

## CI

There is no GitHub Actions workflow. Rebuild locally with Docker when you bump pins, then commit `vendor/qpdf/`.

## Bump procedure

1. Edit `wasm/pins.env` and the `ARG` defaults / `FROM` line in `wasm/Dockerfile`.
2. Rebuild as above.
3. Commit pins + `vendor/qpdf/` + this table.
4. Note the qpdf tag in the commit message (`vendor: qpdf v12.x.y`).

## Failure modes

| Symptom | Likely cause |
|---|---|
| `jpeg-turbo` BIT_BUF_SIZE error | Patch not applied; SIMD left on |
| `no crypto provider is available` | Forgot `-DREQUIRE_CRYPTO_NATIVE=ON` |
| `cannot find -lqpdf` / missing `.a` | lib path is `build/libqpdf/libqpdf.a` vs `out/lib/libqpdf.a` — Dockerfile tries both |
| `callMain is not a function` | Missing `EXPORTED_RUNTIME_METHODS` |
| Glue looks for `.wasm` next to the JS | `locateFile` in `qpdf-wasm.ts` must point at `vendor/qpdf/qpdf.wasm` |
| Encrypted file “succeeds” | Should not; treat `--is-encrypted` / trailer `/Encrypt` as errors |
