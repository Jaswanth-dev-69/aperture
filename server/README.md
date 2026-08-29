# Aperture agent server

The server side of the SIH26171 spec-compliance demo — see
`../extension/src/vision/README.md` for the full picture, honest limitations, and
what this is (and isn't) a substitute for.

Receives an already-redacted image (faces and DOM-flagged sensitive fields blacked
out client-side, before this server ever sees it), a task, and a label-only
structural summary. Runs it through a local, offline-deployable, open-weights
vision-language model via [Ollama](https://ollama.com), and returns a
plain-language instruction for the client to re-resolve and execute — never raw
pixel coordinates.

## Setup

```bash
# once
ollama pull moondream

# each session
ollama serve &         # if not already running
cd server
npm install
npm start
```

Runs on `http://localhost:8787`. Check `http://localhost:8787/health`.

## Why moondream

Small (~1.7GB), genuinely multimodal, and runs comfortably on modest hardware —
this ran in well under a second per request on a laptop RTX 3050 with 4GB VRAM
once warm. It's not a strong instruction-follower, so `index.js`'s prompt asks a
direct visual question ("which element should I click to do X?") rather than
demanding a rigid output format, and the client resolves the resulting sentence
against real page labels with fuzzy token matching rather than expecting an exact
match.

## Swapping the model

Set `VLM_MODEL` (any Ollama vision-capable model) and `OLLAMA_URL` if not running
on the default port. The PS explicitly allows a cloud-hosted equivalent during
the actual SIH event — swap `OLLAMA_URL` for a hosted endpoint if needed; the
`/api/chat`-shaped request in `index.js` would need adjusting to match that
provider's API.
