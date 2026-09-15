# syntax=docker/dockerfile:1
# Rebuild: see docs/wasm.md
FROM emscripten/emsdk:3.1.73

ARG QPDF_TAG=v12.4.1
ARG ZLIB_TAG=v1.3.1
ARG JPEG_TAG=3.0.3

RUN apt-get update && apt-get install -y --no-install-recommends \
      pkg-config python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY patches/jpeg-turbo.patch /src/patches/jpeg-turbo.patch
COPY js/pre.js js/post.js /src/js/

RUN git clone --depth 1 --branch "$ZLIB_TAG" https://github.com/madler/zlib.git /src/lib/zlib \
 && git clone --depth 1 --branch "$JPEG_TAG" https://github.com/libjpeg-turbo/libjpeg-turbo.git /src/lib/jpeg-turbo \
 && git clone --depth 1 --branch "$QPDF_TAG" https://github.com/qpdf/qpdf.git /src/lib/qpdf

ENV OUT_DIR=/src/out
ENV CPPFLAGS="-I/src/out/include"
ENV LDFLAGS="-L/src/out/lib"
ENV PKG_CONFIG_PATH=/src/out/lib/pkgconfig
ENV EM_PKG_CONFIG_PATH=/src/out/lib/pkgconfig
ENV CFLAGS="-Oz -flto"
ENV CXXFLAGS="-Oz -flto -std=c++20"

RUN mkdir -p "$OUT_DIR" \
 && cd /src/lib/zlib \
 && emconfigure ./configure --prefix="$OUT_DIR" --static \
 && emmake make -j"$(nproc)" install

RUN cd /src/lib/jpeg-turbo \
 && (patch -p1 < /src/patches/jpeg-turbo.patch || true) \
 && emcmake cmake . \
      -DCMAKE_INSTALL_PREFIX="$OUT_DIR" \
      -DENABLE_SHARED=OFF \
      -DWITH_SIMD=0 \
      -DCMAKE_BUILD_TYPE=Release \
 && emmake make -j"$(nproc)" install

RUN cd /src/lib/qpdf \
 && emcmake cmake -S . -B build \
      -DCMAKE_INSTALL_PREFIX="$OUT_DIR" \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DBUILD_STATIC_LIBS=ON \
      -DUSE_IMPLICIT_CRYPTO=OFF \
      -DREQUIRE_CRYPTO_NATIVE=ON \
      -DSKIP_OS_SECURE_RANDOM=ON \
      -DBUILD_TESTING=OFF \
      -DOSS_FUZZ=OFF \
      -DINSTALL_EXAMPLES=OFF \
 && cmake --build build -j"$(nproc)" --target libqpdf

# Link the CLI (qpdf.cc) against the static library.
RUN mkdir -p /src/dist \
 && emcc $LDFLAGS $CPPFLAGS $CFLAGS $CXXFLAGS \
      --pre-js /src/js/pre.js \
      --post-js /src/js/post.js \
      -s WASM_BIGINT=1 \
      -s ALLOW_MEMORY_GROWTH=1 \
      -s MODULARIZE=1 \
      -s EXPORT_ES6=1 \
      -s ENVIRONMENT=node \
      -s EXPORTED_RUNTIME_METHODS='["callMain","FS"]' \
      -s INCOMING_MODULE_JS_API='["noInitialRun","locateFile","print","printErr"]' \
      -s NO_DISABLE_EXCEPTION_CATCHING=1 \
      -o /src/dist/qpdf.mjs \
      /src/lib/qpdf/qpdf/qpdf.cc \
      -I /src/lib/qpdf/include \
      /src/lib/qpdf/build/libqpdf/libqpdf.a \
      -lz -ljpeg \
 || emcc $LDFLAGS $CPPFLAGS $CFLAGS $CXXFLAGS \
      --pre-js /src/js/pre.js \
      --post-js /src/js/post.js \
      -s WASM_BIGINT=1 \
      -s ALLOW_MEMORY_GROWTH=1 \
      -s MODULARIZE=1 \
      -s EXPORT_ES6=1 \
      -s ENVIRONMENT=node \
      -s EXPORTED_RUNTIME_METHODS='["callMain","FS"]' \
      -s INCOMING_MODULE_JS_API='["noInitialRun","locateFile","print","printErr"]' \
      -s NO_DISABLE_EXCEPTION_CATCHING=1 \
      -o /src/dist/qpdf.mjs \
      /src/lib/qpdf/qpdf/qpdf.cc \
      -I /src/lib/qpdf/include \
      /src/out/lib/libqpdf.a \
      -lz -ljpeg

CMD ["sh", "-c", "mkdir -p /out && cp /src/dist/qpdf.mjs /src/dist/qpdf.wasm /out/"]
