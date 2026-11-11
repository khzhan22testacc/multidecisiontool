#!/usr/bin/env bash
# Downloads the on-device speech models into ./models so the app serves them
# from its own origin. Run once, from the app folder, before deploying.
#   Guided entry:       Vosk small English (about 40 MB)
#   Sentence dictation: Whisper tiny English, 8-bit (about 41 MB)
# Optional argument: a different Whisper model, e.g. Xenova/whisper-base.en
# After this the app never contacts any model host.
set -euo pipefail

# ---- Vosk (repacked as .tar.gz with one top-level folder, as the engine expects)
VOSK=vosk-model-small-en-us-0.15
if [ ! -f "models/$VOSK.tar.gz" ]; then
  echo "Fetching $VOSK"
  TMP="$(mktemp -d)"
  curl -fL --retry 3 -o "$TMP/$VOSK.zip" "https://alphacephei.com/vosk/models/$VOSK.zip"
  (cd "$TMP" && unzip -q "$VOSK.zip")
  mkdir -p models
  tar -C "$TMP" -czf "models/$VOSK.tar.gz" "$VOSK"
  rm -rf "$TMP"
fi

# ---- Whisper
MODEL="${1:-Xenova/whisper-tiny.en}"
DEST="models/$MODEL"
BASE="https://huggingface.co/$MODEL/resolve/main"
mkdir -p "$DEST/onnx"
for f in config.json generation_config.json preprocessor_config.json tokenizer.json tokenizer_config.json \
         onnx/encoder_model_quantized.onnx onnx/decoder_model_merged_quantized.onnx; do
  echo "Fetching $f"
  curl -fL --retry 3 -o "$DEST/$f" "https://huggingface.co/$MODEL/resolve/main/$f"
done
echo "Done. Models saved in models/"
