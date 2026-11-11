# IMcalc

Clinical decision tools for internal medicine, built to run as a standalone app on an Android phone.

Pick several tools, enter each shared value once (by voice, by typing a phrase, or field by field), and read every score on one screen.

## What is in it

43 tools, grouped by system. Tap ☆ on any tool to pin it to a Favourites section at the top, with a one-tap "Select all".

- Cardiology: Framingham (with CCS family-history adjustment), HEART, CHA2DS2-VASc with CHADS-65, HAS-BLED, MAP
- Thrombosis: Wells PE, PERC, Wells DVT
- Respirology and sepsis: CURB-65, qSOFA, PaO2/FiO2
- GI and hepatology: Glasgow-Blatchford, MELD-Na and MELD 3.0, Child-Pugh, FIB-4, R factor
- Kidney: CKD-EPI 2021 eGFR, Cockcroft-Gault, KDIGO CKD staging, KFRE 4- and 8-variable (North American calibration), FENa, FEurea, urea:creatinine (BUN:Cr), AIN risk (Moledina), ATN-ISI (Liaño), SHARF II at diagnosis, Mehran, McMahon
- Acid–base: anion gap, delta gap and delta ratio, Winters, acid–base compensation, urine anion gap, serum osmolality
- Electrolytes and fluids: corrected calcium, glucose-corrected sodium, free water deficit, sodium deficit with Adrogué-Madias, maintenance fluids
- Body weight: ideal body weight (Devine), adjusted body weight
- Rheumatology: GCA Probability Score (GCAPS)

Units are SI (µmol/L, mmol/L, g/L; urine creatinine in mmol/L; ACR in mg/mmol).

### Notes on specific tools
- SHARF II uses prothrombin activity in Quick % (European reporting), not INR.
- GCA uses the Southend GCA Probability Score (Laskou 2019). The Ing logistic model was not used because its published coefficients do not reproduce the paper's own examples.
- KFRE, CKD staging and Mehran compute eGFR from creatinine with CKD-EPI 2021 (Mehran's original used MDRD).

## Put it on a phone

The app is a Progressive Web App. It must be served over HTTPS once, after which it installs to the home screen and runs with no connection.

1. Create a GitHub repository and push this folder to the `main` branch.
2. In the repository, open Settings, then Pages, and set Source to "GitHub Actions". The included workflow runs the tests, downloads the speech model and publishes the site.
3. On the phone, open the Pages address in Chrome, then menu, then "Add to Home screen" (or "Install app").
4. Open the app once while online and tap Start voice entry once, so the voice engine and model (about 43 MB) are stored. From then on it works in airplane mode.

To host it elsewhere, run `./tools/get-vendor.sh` and `./tools/get-model.sh` once in this folder and upload everything to any static HTTPS host.

To try it on a computer: `./tools/get-vendor.sh`, `./tools/get-model.sh`, then `python3 -m http.server 8000`, then open http://localhost:8000.

## Privacy design

- Patient values exist only in the memory of the open screen. They are not written to localStorage, IndexedDB, cookies, the URL or the service-worker cache. "New patient" or closing the app erases them.
- The only things saved between sessions are the lists of ticked and starred (favourite) tools.
- Speech recognition (Vosk for guided entry, Whisper for sentence dictation) runs in WebAssembly on the phone. The browser's built-in speech recognition is deliberately not used, because on Android it sends audio to Google.
- The page carries a Content-Security-Policy that allows connections to its own origin only. The speech worker additionally refuses any request to another origin, and remote model loading is switched off.
- No analytics, no fonts or scripts from other sites, no accounts.
- Audio is held in memory for one dictation and then dropped.

One thing outside the app's control: the phone's keyboard may learn typed text, as it does in any app.

## How voice entry works

### Guided entry (main mode)
Tap **Start voice entry**. The app highlights each blank field your selected tools need, one at a time, and you say the value.

- Numbers the way you'd say them: "one twenty five", "one hundred and twenty five", "one oh five", "seven point four", "point nine", "twelve hundred".
- Commands: "skip" or "next", "back", "clear", "stop" or "done". The Back, Skip and Stop buttons do the same.
- Yes/No fields: say "yes" or "no". Multiple-choice fields: say the option number shown. Sex: "male" or "female".
- A value outside the plausible range is kept but flagged, and the app stays on that field so you can say it again or "next" to keep it.
- Every field stays editable by hand, including while voice entry is running. Fields you fill by hand are skipped.
- The mic button beside any field records just that one value.

Speech recognition is Vosk (Kaldi) with the small English model, running in WebAssembly on the phone. It is restricted to number words and the commands above, so it cannot output anything else, and it shows the words live as you speak. A short pause ends a value; phrases split by a brief pause ("one ... twenty five") are joined.

### Sentence dictation (secondary)
"Or dictate a full sentence instead" opens free dictation ("sodium 125, ALP 130, BP 110 over 70") using Whisper tiny on the phone, read by a rule-based parser (`js/parser.js`). It only loads if you use it. For better accuracy, switch to Whisper base (about 77 MB): `./tools/get-model.sh Xenova/whisper-base.en` and change `MODEL_ID` in `js/stt-worker.js`. In the GitHub workflow, add `Xenova/whisper-base.en` after `get-model.sh`.

### Downloads on first use
- Guided entry: about 43 MB (engine plus model), stored on the phone after the first use.
- Sentence dictation: about 68 MB, only if used.

## Code layout

- `js/variables.js`: canonical variables (label, unit, plausible range, spoken names). Owned globally.
- `js/scores.js`: scoring rules. Each score lists the variable ids it needs and a `compute` function.
- `js/engine.js`: works out the de-duplicated input list for the selected scores and evaluates them.
- `js/parser.js`: dictation text to values.
- `js/voice.js`, `js/vosk-worker.js`, `js/mic-worklet.js`, `js/spoken.js`: guided voice entry (Vosk, number words, commands).
- `js/speech.js`, `js/stt-worker.js`: sentence dictation with on-device Whisper.
- `js/app.js`: interface.
- `sw.js`: offline cache. Change `CACHE` to a new name whenever you publish an update.
- `tests/run.mjs`: `node tests/run.mjs` checks every formula and the parser.

To add a score, add any new variables to `variables.js`, add one entry to `scores.js`, and add a test.

## Limits

- Decision support for trained clinicians. Not a medical device. Confirm inputs and apply clinical judgment.
- Yes/No items default to No. Each result lists every component so you can see what was counted.
- HAS-BLED's stroke item reuses the "prior stroke, TIA or systemic embolism" answer from CHA2DS2-VASc.
