#!/usr/bin/env bash
# Downloads the on-device speech model (Whisper tiny, English, 8-bit) into ./models
# so the app can serve it from its own origin. Run once, from the app folder,
# before deploying. About 41 MB. After this the app never contacts Hugging Face.
set -euo pipefail
MODEL="${1:-Xenova/whisper-tiny.en}"
DEST="models/$MODEL"
BASE="https://huggingface.co/$MODEL/resolve/main"
mkdir -p "$DEST/onnx"
for f in config.json generation_config.json preprocessor_config.json tokenizer.json tokenizer_config.json \
         onnx/encoder_model_quantized.onnx onnx/decoder_model_merged_quantized.onnx; do
  echo "Fetching $f"
  curl -fL --retry 3 -o "$DEST/$f" "$BASE/$f"
done
echo "Done. Model saved in $DEST"
