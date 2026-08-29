import { useState } from "react";
import {
  analyzeAndRedact,
  askAgent,
  captureVisibleTab,
  type AgentDecision,
  type RedactionResult,
} from "../vision/vision-agent";
import type { ScreenContext, ToBackground } from "../messages";

function send<T>(message: ToBackground): Promise<T | undefined> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

type Stage = "idle" | "capturing" | "analyzing" | "ready" | "asking" | "executing";

export function VisionAgent() {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RedactionResult | null>(null);
  const [context, setContext] = useState<ScreenContext | null>(null);
  const [task, setTask] = useState("");
  const [decision, setDecision] = useState<AgentDecision | null>(null);
  const [execResult, setExecResult] = useState<string | null>(null);

  const busy = stage === "capturing" || stage === "analyzing" || stage === "asking" || stage === "executing";

  async function handleCapture() {
    setError(null);
    setDecision(null);
    setExecResult(null);
    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("No active tab");

      setStage("capturing");
      const ctx = await send<ScreenContext>({ type: "GET_SCREEN_CONTEXT", tabId: tab.id });
      if (!ctx) throw new Error("Could not read this page — try a regular website, not a browser page");
      const screenshot = await captureVisibleTab();

      setStage("analyzing");
      const redaction = await analyzeAndRedact(
        screenshot,
        ctx.sensitiveRegions,
        ctx.viewportWidth,
        ctx.viewportHeight,
      );

      setContext(ctx);
      setResult(redaction);
      setStage("ready");
    } catch (err) {
      setError((err as Error).message);
      setStage("idle");
    }
  }

  async function handleAsk() {
    if (!result || !context || !task.trim()) return;
    setError(null);
    setStage("asking");
    try {
      const d = await askAgent(result.redactedDataUrl, task.trim(), context.structuralSummary);
      setDecision(d);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStage("ready");
    }
  }

  async function handleExecute() {
    if (!decision) return;
    setError(null);
    setStage("executing");
    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("No active tab");
      const res = await send<{ found: boolean; label?: string }>({
        type: "FIND_ELEMENT_BY_DESCRIPTION",
        tabId: tab.id,
        description: decision.target,
      });
      setExecResult(res?.found ? `Clicked "${res.label}"` : "Could not find a matching element on the page");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStage("ready");
    }
  }

  return (
    <div className="vision-agent">
      <p className="hint">
        Proof of concept for SIH26171's literal spec: a local vision model (YOLOS, a ViT, via
        WebGPU/WASM) finds and redacts faces and DOM-flagged sensitive fields before anything is sent
        to a server-side VLM, which returns a plain-language instruction the client re-resolves and
        executes. Separate from Aperture's main product — see{" "}
        <code>extension/src/vision/README.md</code>.
      </p>

      <button className="btn btn-primary" onClick={handleCapture} disabled={busy}>
        {stage === "capturing"
          ? "Reading page…"
          : stage === "analyzing"
            ? "Detecting & redacting…"
            : "📷 Capture & analyze current page"}
      </button>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
        </div>
      )}

      {result && (
        <>
          <div className="vision-compare">
            <div>
              <span className="vision-label">Original — never sent anywhere</span>
              <img src={result.originalDataUrl} alt="Original screenshot" />
            </div>
            <div>
              <span className="vision-label">Redacted — this is what gets sent</span>
              <img src={result.redactedDataUrl} alt="Redacted screenshot" />
            </div>
          </div>

          <p className="vision-stats mono">
            {result.faceRegionsFound} face region{result.faceRegionsFound === 1 ? "" : "s"} redacted ·{" "}
            {result.sensitiveRegionsFound} sensitive field{result.sensitiveRegionsFound === 1 ? "" : "s"}{" "}
            redacted
          </p>

          <div className="vision-task">
            <input
              type="text"
              placeholder='Task, e.g. "search for a product"'
              value={task}
              onChange={(e) => setTask(e.target.value)}
            />
            <button className="btn btn-small" onClick={handleAsk} disabled={!task.trim() || busy}>
              {stage === "asking" ? "Asking…" : "Ask agent"}
            </button>
          </div>
        </>
      )}

      {decision && (
        <div className="vision-decision">
          <p>
            <b>Agent says:</b> {decision.action} on "{decision.target}"
          </p>
          <button className="btn btn-small" onClick={handleExecute} disabled={busy}>
            {stage === "executing" ? "Executing…" : "▶ Execute"}
          </button>
          {execResult && <p className="muted">{execResult}</p>}
        </div>
      )}
    </div>
  );
}
