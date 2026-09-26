# SOCO animated investigation

Open `index.html` for a 26-second animated explanation in English. It autoplays once, supports pause, replay, seeking and chapter selection, and starts paused when reduced motion is requested. No external resources, credentials, or API calls are needed.

The film shows semantic screening, candidate collapse, helper expansion, contextual judgment, source verification and the final diagnosis. Probabilities and aggregate counts come from `dispatch-jev-5`. Line-by-line scanning, intermediate counters and timing are choreographed for explanation: Jev actually ran batched requests. The source counter counts handlers and helper modules; the task contracts are not included. Code excerpts in the explanation are simplified and labeled. No token or KV-cache savings are claimed.

`inspect.html` preserves the original detailed trace viewer. It separates state loaded outside root from original source actually printed to root. `replay.json` contains its data. Provenance: `../eval/POC-2026-09-26.md`.

Edit `film-template.html`, then build from retained replay data:

```sh
node eval/scripts/build-demo.mjs
```

To re-export the featured run (checks source hashes, rebuilds both views):

```sh
node eval/scripts/export-poc.mjs runs/poc/dispatch-jev-5.json
```

The film is specifically choreographed for run 5; exporting other runs changes only the inspector. `template.html` is the detailed inspector template. Raw traces stay under ignored `runs/`. All embedded source belongs to the authored fixture.
