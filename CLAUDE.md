# Aperture — SIH 2026 (SIH26171)

## What this repo is

A working Chrome/Brave extension (Manifest V3) plus its supporting artifacts:

- `extension/` — the actual product: React side panel, service worker, content script.
- `practice-site/` — a small static fake-shop site (shop → product → cart → checkout →
  confirmation) used as a stable demo/test target instead of a real website.
- `extension/e2e/` — a Playwright test that loads the real built extension, records a
  full multi-page checkout on the practice site, and replays it.
- `landing/index.html` — the public-facing landing page (also published as an Artifact).
- `sih_report.html` — "The Aperture Brief," the original research report that screened
  all 172 SIH 2026 software problem statements and selected this one. Read it for the
  *why* behind the product decision; it is not re-litigated here.
- GitHub: https://github.com/Jaswanth-dev-69/aperture (public).

## The decision (unchanged from the report)

**Aperture**: a privacy-first Chrome extension that records browser macros (click, type,
scroll) and replays them, mapped to problem statement **SIH26171** (ISRO). Everything in
V1 runs on-device with zero network calls in the core loop — no AI yet, which is itself
the strongest form of the privacy claim. Full reasoning and runner-up comparison in
`sih_report.html` §5–7.

## Architecture, as actually built (not as originally planned)

The single biggest lesson from building this: **a page is destroyed on every
navigation, so it cannot hold state.** Every early bug (recording losing steps,
replay stopping after a few actions) traced back to state living in the content
script. The fix was a full rearchitecture:

- **The service worker owns all state** (`extension/src/background/service-worker.ts`).
  It's the only component that survives navigation, and it gets the sender's tab id
  for free from `sender.tab`, so a content script never has to ask who it is before
  reporting an event.
- **The content script is a dumb sensor/actuator** (`extension/src/content/content-script.ts`).
  It attaches listeners at `document_start` and either reports an event (`RECORD_STEP`)
  or executes a step the worker hands it (`EXECUTE_STEP`). It holds no state of its own.
- **The selector engine** (`extension/src/content/selector-engine.ts`) fingerprints an
  element five ways and resolves through that same fallback chain: id (compatibility-
  checked) → aria-label/role → exact text (+ structural tiebreak) → structural
  ancestor-path → bounding-box proximity as a last resort.
- **Replay reproduces real 1× timing** — the actual gaps between recorded actions
  (capped at 8s), not a fixed per-step delay — and highlights each element before
  acting so a human can watch it work.
- **Navigating steps are handled explicitly**: the worker waits for `chrome.tabs.onUpdated`
  to report `complete` before continuing past a step that triggered navigation, with a
  guard (`activeLoops`) against two replay loops driving the same tab at once.
- A real bug the Playwright suite caught on its first run: the replay code grabbed
  `HTMLInputElement`'s native value-setter unconditionally and applied it to `<select>`
  and `<textarea>` too, which throws "Illegal invocation" on the wrong element type —
  silently swallowed by the per-step `try/catch`, so fields just never got set. Fixed
  in `content-script.ts`'s `nativeValueSetter()` by picking the setter from the
  matching prototype per element tag. Worth remembering as the shape of bug this
  codebase is prone to: anything that works for `<input>` needs to be checked against
  `<select>`/`<textarea>` too.

## The literal SIH26171 spec vs. what's built

Important, easy to forget: the product described above is a deliberate **reframe**
of SIH26171's actual text, not an implementation of it (this was already the case
in `sih_report.html`'s own original proposal — see its methodology section). The
official spec requires a client-side ViT that redacts PII before sending visual
context to a server-side LLM/VLM, which returns commands for the client to execute.
That's a different architecture from an on-device, no-server macro recorder — as
built, V1 satisfied **zero** of the PS's five "Expected Solution" components and
none of its evaluation-rubric metrics were even measurable, because none of the
underlying systems (vision model, redaction, server, VLM loop) existed.

`extension/src/vision/` + `server/` closes that gap as a separate, clearly labeled
**proof of concept** — real local ViT (YOLOS via WebGPU/WASM), real DOM+visual
redaction, a real server calling a real local VLM (moondream via Ollama). It does
not touch or depend on the main product. Read
`extension/src/vision/README.md` for the exact spec-to-code mapping and its
honestly-disclosed limitations (approximated face regions, a small VLM that
doesn't reliably follow rigid output formats, etc.) before claiming spec
compliance anywhere — it's a demo, not a production redaction system.

## Build plan status

1. ✅ Scaffold (Vite + React + TS + `@crxjs/vite-plugin`, MV3 skeleton)
2. ✅ Selector engine
3. ✅ Recorder (click, input, Enter/Tab/Escape, scroll; typing collapses to one step per field)
4. ✅ Replayer (1× timing, cross-navigation, element highlighting)
5. ✅ Side panel UI (macro list, live capture feed, replay log, error banner for restricted pages)
6. ✅ Sandboxed practice site
7. ✅ Playwright E2E test (`extension/e2e/record-replay.spec.ts`, `npm run test:e2e`)
8. ✅ Landing page (`landing/index.html`)
9. ⬜ **Packaging & ship** — README, architecture diagram, CI (lint/typecheck/E2E on
   push), MIT license file, Chrome Web Store submission (expect review lag — keep a
   downloadable `.zip` release as a fallback install path).
10. ⬜ *(V2, not started)* on-device vision fallback for canvas/shadow-DOM elements the
    deterministic selector chain can't see, via WebGPU. Don't start this before step 9.

## Working notes for future sessions

- The privacy claim ("nothing leaves the device") is the whole product thesis. Any new
  feature that silently sends data off-device breaks the pitch.
- Before recommending or reusing any specific function/file mentioned here, verify it
  still exists — this file is a snapshot, `git log`/the code are the source of truth.
- Resume/portfolio framing (bullets, talking points) is drafted in the report §11 but
  was explicitly deferred by the user — pick it up only when asked.
- Run the extension locally: `cd extension && npm run build`, then load `extension/dist`
  as an unpacked extension in `brave://extensions` (Developer mode → Load unpacked).
  Reload the extension after every rebuild; refresh any already-open test tabs too.
