import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import type { Macro } from "../types";
import type { PanelState, StopRecordingResult, ToBackground, ToPanel } from "../messages";
import { deleteMacro, getMacros, saveMacro } from "./storage";
import { describeStep } from "../describe-step";

function send<T>(message: ToBackground): Promise<T | undefined> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/** Pages where extensions are not allowed to run a content script. */
function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    /^(chrome|brave|edge|about|devtools|view-source|file):/i.test(url) ||
    url.startsWith("https://chromewebstore.google.com/") ||
    url.startsWith("https://chrome.google.com/webstore")
  );
}

function App() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [recording, setRecording] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [feed, setFeed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const activeTabId = useRef<number | null>(null);
  const feedRef = useRef<HTMLUListElement | null>(null);

  const refreshMacros = useCallback(async () => setMacros(await getMacros()), []);

  // Re-sync with the service worker, which is the source of truth — the panel
  // can be closed and reopened mid-recording.
  const syncState = useCallback(async () => {
    const tab = await getActiveTab();
    activeTabId.current = tab?.id ?? null;
    if (tab?.id == null) return;
    const state = await send<PanelState>({ type: "GET_PANEL_STATE", tabId: tab.id });
    if (!state) return;
    setRecording(state.recording);
    setReplaying(state.replaying);
    setFeed(state.recordedSteps.map(describeStep));
  }, []);

  useEffect(() => {
    void refreshMacros();
    void syncState();
  }, [refreshMacros, syncState]);

  useEffect(() => {
    function onMessage(message: ToPanel) {
      if (message.type === "STEP_RECORDED") {
        setFeed((prev) => [...prev, describeStep(message.step)]);
      } else if (message.type === "REPLAY_PROGRESS") {
        const tag = message.status === "failed" ? "✕" : message.status === "ok" ? "✓" : "▸";
        setLog((prev) => {
          const line = `${tag} [${message.index + 1}/${message.total}] ${message.description}`;
          // Replace the in-progress line for this step rather than duplicating it.
          const prefix = `▸ [${message.index + 1}/${message.total}]`;
          const withoutRunning = prev.filter((l) => !l.startsWith(prefix));
          return [...withoutRunning, line];
        });
      } else if (message.type === "REPLAY_DONE") {
        setReplaying(false);
        setLog((prev) => [...prev, message.aborted ? "— Stopped —" : "— Finished —"]);
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [feed]);

  async function handleStartRecording() {
    setError(null);
    const tab = await getActiveTab();
    if (tab?.id == null) return;
    if (isRestrictedUrl(tab.url)) {
      setError("Aperture can't run on browser or Web Store pages. Open a regular website first.");
      return;
    }
    activeTabId.current = tab.id;
    setFeed([]);
    setLog([]);
    await send({ type: "START_RECORDING", tabId: tab.id });
    setRecording(true);
  }

  async function handleStopRecording() {
    const tabId = activeTabId.current;
    if (tabId == null) return;
    const result = await send<StopRecordingResult>({ type: "STOP_RECORDING", tabId });
    setRecording(false);
    const steps = result?.steps ?? [];
    if (steps.length === 0) {
      setError("No actions were captured. Make sure you interact with the page while recording.");
      return;
    }
    const name = window.prompt("Name this macro:", `Macro ${macros.length + 1}`);
    if (!name) return;
    await saveMacro({
      id: crypto.randomUUID(),
      name,
      createdAt: Date.now(),
      startUrl: result?.startUrl ?? "",
      steps,
    });
    await refreshMacros();
  }

  async function handleReplay(macro: Macro) {
    setError(null);
    const tab = await getActiveTab();
    if (tab?.id == null) return;
    if (isRestrictedUrl(tab.url)) {
      setError("Aperture can't run on browser or Web Store pages. Open a regular website first.");
      return;
    }
    activeTabId.current = tab.id;
    setLog([]);
    setReplaying(true);
    await send({ type: "START_REPLAY", tabId: tab.id, macro });
  }

  async function handleAbort() {
    const tabId = activeTabId.current;
    if (tabId == null) return;
    await send({ type: "ABORT_REPLAY", tabId });
    setReplaying(false);
  }

  async function handleDelete(id: string) {
    await deleteMacro(id);
    await refreshMacros();
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Aperture</h1>
        <p className="tagline">Record and replay browser macros — entirely on-device.</p>
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <section className="recorder">
        {!recording ? (
          <button className="btn btn-primary" onClick={handleStartRecording} disabled={replaying}>
            ● Record new macro
          </button>
        ) : (
          <button className="btn btn-stop" onClick={handleStopRecording}>
            ■ Stop recording
          </button>
        )}
        {replaying && (
          <button className="btn btn-stop" onClick={handleAbort} style={{ marginLeft: 8 }}>
            ■ Stop replay
          </button>
        )}

        {recording && (
          <>
            <p className="hint">
              Clicks, typing, Enter/Tab/Escape and scrolling are captured live — across page
              navigations too.
            </p>
            <ul className="log-list feed" ref={feedRef}>
              {feed.length === 0 && <li className="empty">Waiting for your first action…</li>}
              {feed.map((line, i) => (
                <li key={i}>
                  {i + 1}. {line}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="macros">
        <h2>Saved macros</h2>
        {macros.length === 0 && <p className="empty">No macros yet — record one above.</p>}
        <ul className="macro-list">
          {macros.map((m) => (
            <li key={m.id} className="macro-item">
              <div className="macro-info">
                <b>{m.name}</b>
                <span>
                  {m.steps.length} step{m.steps.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="macro-actions">
                <button
                  className="btn btn-small"
                  onClick={() => handleReplay(m)}
                  disabled={recording || replaying}
                >
                  ▶ Run
                </button>
                <button
                  className="btn btn-small btn-danger"
                  onClick={() => handleDelete(m.id)}
                  disabled={recording || replaying}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {log.length > 0 && (
        <section className="log">
          <h2>Action log</h2>
          <ul className="log-list">
            {log.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default App;
