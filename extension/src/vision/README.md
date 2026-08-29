# Vision Agent — SIH26171 spec-compliance demo

Aperture's main product (record/replay macros) is a deliberate **reframe** of the
official SIH26171 problem statement, not a literal implementation of it — see
`sih_report.html` and the root `CLAUDE.md` for that history. This folder, plus
`../../server/`, is a separate, clearly-labeled **proof of concept** that closes the
gap against the literal spec text, for submission purposes.

## What the spec actually asks for

> Implement a client-side ViT (or equivalent) that reads the screen. Detect and
> redact sensitive/PII regions locally. Send only the redacted, anonymized visual
> context to a server-side LLM/VLM. The server returns an actionable command (e.g.
> "click the submit button") for the client to execute.

## What this demo does, mapped 1:1

| Spec requirement | This demo |
|---|---|
| Local ViT/vision model reading the screen | [`Xenova/yolos-tiny`](https://huggingface.co/Xenova/yolos-tiny) — YOLOS is literally a Vision Transformer adapted for object detection — running client-side via `@huggingface/transformers`, WebGPU with WASM fallback |
| Privacy-preserving filter | Detected people → face region approximated as the top ~35% of the person's bounding box, blacked out. DOM-flagged sensitive fields (passwords, payment, email, phone) → blacked out by real bounding box, reusing the same `getBoundingClientRect()` approach as `selector-engine.ts` |
| Server-side LLM/VLM integration | `server/index.js` — a small Express server calling a local, offline-deployable, open-weights model (`moondream`) via Ollama, exactly as the PS explicitly allows ("Participants are free to use any offline deployable open-source/open-weights model on server side") |
| Actionable command returned & executed | Server returns a plain-language target description (never coordinates); the client re-resolves it via `findAndClickByDescription()` in `content-script.ts`, reusing the same element-matching philosophy as the rest of Aperture |
| End-to-end task demo | Capture → redact → ask → execute, all from the "Vision Agent" tab in the side panel |

## Where the redaction actually happens — read this before trusting the privacy claim

1. `chrome.tabs.captureVisibleTab()` grabs a screenshot of the **active tab**,
   entirely client-side.
2. `content-script.ts`'s `GET_SCREEN_CONTEXT` handler scans the DOM for password/
   payment/email/phone fields via `getBoundingClientRect()` — never their values —
   plus a structural summary of visible control *labels only*.
3. `vision-agent.ts`'s `analyzeAndRedact()` runs YOLOS locally, blacks out detected
   face regions and every DOM-flagged sensitive region on a canvas.
4. **Only the canvas output (`redactedDataUrl`) and the label-only structural
   summary are sent to the server.** The original screenshot never leaves
   `vision-agent.ts` — the side panel UI displays it next to the redacted version
   specifically so this is visible and checkable, not just claimed.

## Honest limitations (this is a proof of concept, not production)

- **Face detection is approximated.** YOLOS-tiny detects the "person" class, not
  faces specifically; the top-35%-of-bounding-box heuristic is a stand-in for a
  dedicated face detector. It will over- or under-crop on unusual poses.
- **The VLM is small (moondream, ~1.7GB) and not strongly instruction-tuned.**
  It answers direct visual questions far more reliably than it follows a rigid
  output format — see `server/index.js`'s prompt design notes. Expect looser,
  sentence-style answers rather than strict JSON; the client's fuzzy label
  matcher (`content-script.ts`'s `scoreMatch()`) is designed around that.
- **Model weights are fetched from Hugging Face's CDN on first use, then
  cached.** This is a one-time download of static model files, not a
  transmission of anything the user did — worth being precise about the
  difference when explaining the privacy claim.
- **The DOM-based sensitive-field rules are a fixed list** (password, cc-*,
  email, tel, ssn-ish names) — not exhaustive, and not a replacement for the
  face/PII detection a production version would need for arbitrary visual PII
  (visible ID cards, screenshots-within-screenshots, etc.).

## Running it

1. Start a local VLM: `ollama serve` (separately: `ollama pull moondream` once)
2. Start the agent server: `cd server && npm install && npm start`
3. Build and load the extension as usual
4. Side panel → **Vision Agent (SIH demo)** tab → **Capture & analyze current
   page** → type a task → **Ask agent** → **Execute**
