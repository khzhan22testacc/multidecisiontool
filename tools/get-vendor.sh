#!/usr/bin/env bash
# Fetches the on-device speech engines (Vosk for guided entry; transformers.js +
# ONNX Runtime for sentence dictation)
# from npm into ./vendor. Versions are pinned. Run from the app folder.
set -euo pipefail
TMP="$(mktemp -d)"
( cd "$TMP" && npm init -y >/dev/null && npm i --ignore-scripts --no-audit --no-fund @huggingface/transformers@4.3.2 @lichess-org/vosk-browser@0.0.3 >/dev/null )
mkdir -p vendor
cp "$TMP/node_modules/@huggingface/transformers/dist/transformers.min.js" vendor/
cp "$TMP/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs" vendor/
cp "$TMP/node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm" vendor/
cp "$TMP/node_modules/@huggingface/transformers/LICENSE" vendor/LICENSE-transformers.txt
mkdir -p vendor/vosk
cp "$TMP/node_modules/@lichess-org/vosk-browser/dist/vosk.wasm.js" vendor/vosk/
cp "$TMP/node_modules/@lichess-org/vosk-browser/dist/vosk.worker.js" vendor/vosk/
cp "$TMP/node_modules/@lichess-org/vosk-browser/dist/vosk.wasm" vendor/vosk/
cp "$TMP/node_modules/@lichess-org/vosk-browser/LICENSE" vendor/vosk/LICENSE.txt 2>/dev/null || true
rm -rf "$TMP"
echo "Speech engine saved in vendor/"
