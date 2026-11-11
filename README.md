# IMcalc

Clinical decision tools for internal medicine, built to run as a standalone app on an Android phone.

Pick several tools, enter each shared value once (by voice, by typing a phrase, or field by field), and read every score on one screen.

## What is in it

20 tools: Framingham (with CCS family-history adjustment), HEART, CHA2DS2-VASc with CHADS-65, HAS-BLED, Wells PE, PERC, Wells DVT, CURB-65, qSOFA, Glasgow-Blatchford, MELD-Na and MELD 3.0, Child-Pugh, FIB-4, R factor, CKD-EPI 2021 eGFR, Cockcroft-Gault, anion gap with delta ratio, corrected calcium, glucose-corrected sodium, serum osmolality.

Units are SI (µmol/L, mmol/L, g/L).

## Put it on a phone

The app is a Progressive Web App. It must be served over HTTPS once, after which it installs to the home screen and runs with no connection.

1. Create a GitHub repository and push this folder to the `main` branch.
2. In the repository, open Settings, then Pages, and set Source to "GitHub Actions". The included workflow runs the tests, downloads the speech model and publishes the site.
3. On the phone, open the Pages address in Chrome, then menu, then "Add to Home screen" (or "Install app").
4. Open the app once while online and tap Speak once, so the voice engine and model (about 68 MB in total) are cached. From then on it works in airplane mode.

To host it elsewhere, run `./tools/get-vendor.sh` and `./tools/get-model.sh` once in this folder and upload everything to any static HTTPS host.

To try it on a computer: `./tools/get-vendor.sh`, `./tools/get-model.sh`, then `python3 -m http.server 8000`, then open http://localhost:8000.

## Privacy design

- Patient values exist only in the memory of the open screen. They are not written to localStorage, IndexedDB, cookies, the URL or the service-worker cache. "New patient" or closing the app erases them.
- The only thing saved between sessions is the list of ticked tools.
- Speech recognition is Whisper (tiny, English) running in WebAssembly on the phone. The browser's built-in speech recognition is deliberately not used, because on Android it sends audio to Google.
- The page carries a Content-Security-Policy that allows connections to its own origin only. The speech worker additionally refuses any request to another origin, and remote model loading is switched off.
- No analytics, no fonts or scripts from other sites, no accounts.
- Audio is held in memory for one dictation and then dropped.

One thing outside the app's control: the phone's keyboard may learn typed text, as it does in any app.

## How voice entry works

Speech becomes text with Whisper on the device. The text is then read by a rule-based parser (`js/parser.js`), not a generative model, so it can only record a number that is literally in the transcript. It understands phrases such as:

- "sodium 125, ALP 130, creatinine 180"
- "BP 110 over 70, heart rate 104, sats 93"
- "67 year old woman"
- "INR one point eight"

Every recognised value is shown as a chip and filled into its field for you to check. Yes/No items and multiple-choice items are tapped, not dictated.

For better recognition of lab names at the cost of speed and size, use the base model: run `./tools/get-model.sh Xenova/whisper-base.en` and change `MODEL_ID` in `js/stt-worker.js`.

## Code layout

- `js/variables.js`: canonical variables (label, unit, plausible range, spoken names). Owned globally.
- `js/scores.js`: scoring rules. Each score lists the variable ids it needs and a `compute` function.
- `js/engine.js`: works out the de-duplicated input list for the selected scores and evaluates them.
- `js/parser.js`: dictation text to values.
- `js/speech.js`, `js/stt-worker.js`: microphone capture and on-device Whisper.
- `js/app.js`: interface.
- `sw.js`: offline cache. Change `CACHE` to a new name whenever you publish an update.
- `tests/run.mjs`: `node tests/run.mjs` checks every formula and the parser.

To add a score, add any new variables to `variables.js`, add one entry to `scores.js`, and add a test.

## Limits

- Decision support for trained clinicians. Not a medical device. Confirm inputs and apply clinical judgment.
- Yes/No items default to No. Each result lists every component so you can see what was counted.
- HAS-BLED's stroke item reuses the "prior stroke, TIA or systemic embolism" answer from CHA2DS2-VASc.
