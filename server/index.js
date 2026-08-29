import express from "express";

/**
 * The server side of the SIH26171 spec-compliance demo (see ../extension/src/vision).
 *
 * Receives only what the client has already redacted: a screenshot with
 * detected faces and DOM-flagged sensitive fields blacked out, plus a
 * structural summary of visible control *labels* (never field values). Runs
 * it through a local, offline-deployable open-weights vision-language model
 * via Ollama and returns a short natural-language action for the client to
 * execute — never raw coordinates, so the client re-resolves the target
 * through the same resilient element matching the rest of Aperture uses.
 */

const PORT = process.env.PORT || 8787;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const MODEL = process.env.VLM_MODEL || "moondream";

const app = express();
app.use(express.json({ limit: "15mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", async (_req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/version`);
    const version = await r.json();
    res.json({ ok: true, model: MODEL, ollama: version.version });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

app.post("/agent/decide", async (req, res) => {
  const { redactedImageBase64, task, structuralSummary } = req.body ?? {};
  if (!redactedImageBase64 || !task) {
    res.status(400).json({ error: "redactedImageBase64 and task are required" });
    return;
  }

  const summary = Array.isArray(structuralSummary) ? structuralSummary.slice(0, 40) : [];
  // moondream is small and answers direct visual questions far more reliably
  // than it follows a rigid output format — so ask, don't instruct-template.
  const prompt = [
    `I want to: ${task}.`,
    "Sensitive regions in this screenshot (faces, password/payment/contact fields) have already been blacked out before you saw it.",
    summary.length ? `Known controls on the page: ${summary.slice(0, 15).join(", ")}.` : "",
    "Looking only at the screenshot, which single clickable element should I interact with?",
    "Answer in one short sentence naming its visible text label.",
  ]
    .filter(Boolean)
    .join(" ");

  const imageData = String(redactedImageBase64).replace(/^data:image\/\w+;base64,/, "");

  let content;
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt, images: [imageData] }],
        stream: false,
        options: { temperature: 0 },
      }),
    });
    if (!r.ok) throw new Error(`Ollama returned HTTP ${r.status}`);
    const data = await r.json();
    content = data.message?.content ?? "";
  } catch (err) {
    res.status(502).json({ error: `Local VLM unavailable — is "ollama serve" running? (${String(err)})` });
    return;
  }

  // The client re-resolves this description through its own fuzzy label
  // matcher (token overlap against real DOM labels) — a full sentence like
  // "Click the Search button below the header" matches "Search" just fine,
  // so no strict output format is required from a model this size.
  const target = content.trim().replace(/^[^\w]+/, "").replace(/[^\w)]+$/, "");
  const action = /\bscroll\b/i.test(content) ? "scroll" : "click";

  res.json({ action, target, raw: content });
});

app.listen(PORT, () => {
  console.log(`[aperture-agent-server] listening on http://localhost:${PORT}`);
  console.log(`[aperture-agent-server] model "${MODEL}" via Ollama at ${OLLAMA_URL}`);
});
