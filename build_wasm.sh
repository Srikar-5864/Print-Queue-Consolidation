#!/usr/bin/env bash
# Compiles the C++ core to WebAssembly (needs Emscripten: https://emscripten.org).
set -e
cd "$(dirname "$0")"
emcc src/core.cpp -O3 -std=c++17 --no-entry -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1 -o web/core.wasm
echo "Built web/core.wasm - reload the website; the header note on the dashboard will say Wasm."
