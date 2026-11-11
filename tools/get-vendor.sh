#!/usr/bin/env bash
# Fetches the on-device speech engine (transformers.js + ONNX Runtime WebAssembly)
# from npm into ./vendor. Versions are pinned. Run from the app folder.
set -euo pipefail
TMP="$(mktemp -d)"
( cd "$TMP" && npm init -y >/dev/null && npm i --ignore-scripts --no-audit --no-fund @huggingface/transformers@4.3.2 >/dev/null )
mkdir -p vendor
cp "$TMP/node_modules/@huggingface/transformers/dist/transformers.min.js" vendor/
cp "$TMP/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs" vendor/
cp "$TMP/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm" vendor/
cp "$TMP/node_modules/@huggingface/transformers/LICENSE" vendor/LICENSE-transformers.txt
rm -rf "$TMP"
echo "Speech engine saved in vendor/"
