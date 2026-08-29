# Aperture — SIH 2026 (SIH26171)

## What this repo is, right now

This directory currently holds one file: `sih_report.html` ("The Aperture Brief") — a
self-contained research report that screened all 172 Smart India Hackathon 2026
Software problem statements and landed on a final build recommendation. There is no
code yet. This CLAUDE.md exists to carry that decision forward into the build phase.

Open `sih_report.html` in a browser to read the full reasoning, scoring tables, and
runner-up analysis. Summary below so future sessions don't need to re-read it in full.

## The decision

**Build Aperture**: a privacy-first Chrome extension that performs on-device UI
perception and web automation, mapped to problem statement **SIH26171 — "On-device
Visual Perception for Light-weight Browser Agents"** (sponsor: ISRO).

Core idea: record a macro by performing a task once (click, type, extract) → Aperture
grounds it in the DOM/accessibility tree using resilient multi-strategy selectors
(id → aria-label → text → visual position) → replay on demand. All inference — the
optional vision fallback for canvas/shadow-DOM pages, and the optional local LLM
planner — runs entirely on-device via WebGPU/WASM (ONNX Runtime Web, Transformers.js,
WebLLM). No screenshot or DOM snapshot is ever sent to a server unless the user
explicitly opts into a disclosed, text-only cloud fallback for ambiguous task parsing.

**Why this over the other candidates** (full comparison in report §5–7): Aperture is
the only top-scoring statement that is *natively* a browser-extension + frontend +
client-side-ML project, matching the stated goal of building in that specific
intersection — not an adjacent one (backend/data-heavy projects like CryptoRadar and
ChainTrace scored close but under-serve the frontend/extension priority). It also
rides the live 2025–26 industry wave of agentic browsers (Claude for Chrome, OpenAI
Atlas, Perplexity Comet) with a differentiated "local-first, privacy-by-architecture"
angle.

**Discarded initial picks**: SIH26125 (blockchain identity — saturated genre),
SIH26149 (disk-forensics tool — fails the "must have a live demo URL" requirement),
SIH26136 (procurement portal — plain CRUD), SIH26227 (does not exist in the 226-PS
catalog).

## Target architecture (V1 MVP)

- **Extension shell**: Manifest V3, TypeScript. Content script + service worker +
  React side panel (not a popup — side panel stays open during page interaction).
- **Grounding**: deterministic DOM/accessibility-tree selectors first. No ML model
  needed for V1 — this is what makes replay resilient and fast.
- **Macro recorder**: capture click/type sequences → replayable script.
- **UI**: side-panel macro library, step-by-step action log with pause/confirm before
  execution (never auto-run silently).
- **Landing page**: Next.js on Vercel, with a recorded demo GIF and a sandboxed
  practice page (fake checkout/signup) visitors can try instantly without installing.
- **Ship**: publish to Chrome Web Store; public repo with README, architecture
  diagram, MIT license, CI (lint, type-check, Playwright E2E, extension build).

Stack for V1: TypeScript, React + Vite, Manifest V3, Playwright (for both testing and
as a thematically fitting "automation tool tested by an automation framework" detail).

V2 (later, not part of V1) adds the on-device vision model (quantized ViT via ONNX
Runtime Web + WebGPU), a WebLLM local planner, a privacy transparency panel, and
macro-sharing backed by an optional Fastify + Postgres service. V3 is
production-hardening (multi-tab orchestration, scheduled automation, team controls,
Firefox port). Don't build V2/V3 features until V1 ships and works end-to-end.

## Build plan (from scratch to a shipped V1)

1. **Scaffold**: `pnpm create vite` React+TS side-panel app, wire up Manifest V3
   `manifest.json` (permissions: `activeTab`, `scripting`, `sidePanel`, `storage`).
   Get "hello world" side panel rendering on any tab.
2. **Selector engine**: build the multi-strategy selector resolver (id → aria-label →
   text → visual position) as a standalone, unit-tested module — this is the
   technical core, get it right before UI polish.
3. **Recorder**: content script listens for click/input events during a "recording"
   session, emits a step list; background service worker persists macros to
   `chrome.storage.local` / IndexedDB.
4. **Replayer**: given a saved macro, re-resolve each step's target element via the
   selector engine and dispatch the recorded action, with a visible per-step log and
   a pause/confirm gate before the first execution of a new macro.
5. **Side panel UI**: macro list (create/rename/delete/run), live action log view.
6. **Sandboxed practice page**: a small fake signup/checkout flow (static site) to
   record/replay against — this becomes both the dev testbed and the public demo.
7. **Playwright E2E**: record-then-replay regression tests against the practice page.
8. **Landing page**: Next.js on Vercel — pitch, embedded demo GIF, "Add to Chrome"
   link, link to the sandboxed practice page.
9. **Packaging & ship**: MIT license, README with architecture diagram + benchmarks
   section (fill in real replay-success-rate numbers once measured), CI badges,
   submit to Chrome Web Store (expect review lag — have a downloadable `.zip` release
   as a fallback install path in the meantime).
10. **(Later, V2)** on-device vision fallback + WebLLM planner — only after V1's
    deterministic path is solid, since these are the highest-execution-risk pieces.

Resume/portfolio framing (bullets, talking points, GitHub repo structure) is already
drafted in report §11 — deliberately not the focus right now per current instructions;
revisit once V1 is real and has real numbers to fill in.

## Working notes for future sessions

- Treat `sih_report.html` as the source of truth for *why* this project was chosen —
  don't re-litigate the selection unless new information changes the calculus.
- The privacy claim ("nothing leaves the device") is the entire product thesis. Any
  new feature that silently sends data off-device breaks the pitch — cloud fallback
  must always be opt-in and visibly disclosed in the UI.
- No code exists yet as of 2026-08-29. The next session's job is step 1 of the build
  plan above: scaffold the extension.
