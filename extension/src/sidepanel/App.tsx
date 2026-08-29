import { useEffect, useRef, useState } from "react";
import "./App.css";
import type { Macro } from "../types";
import type { ContentMessage, RuntimeEvent } from "../messages";
import { deleteMacro, getMacros, saveMacro } from "./storage";
import { beginRecording, endRecording } from "../recording-state";
import { describeStep } from "../describe-step";

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

/** Pages where extensions are not allowed to run a content script. */
function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    /^(chrome|brave|edge|about|devtools|view-source):/i.test(url) ||
    url.startsWith("https://chromewebstore.google.com/") ||
    url.startsWith("https://chrome.google.com/webstore")
  );
}

/**
 * chrome.tabs.sendMessage rejects with "Receiving end does not exist" whenever
 * the target tab has no live content script — a restricted page, or a page that
 * loaded before the extension was last reloaded. Surface that as a usable
 * message instead of an unhandled rejection.
 */
async function sendToContentScript(tabId: number, message: ContentMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch {
    throw new Error(
      "Aperture isn't active on this page. Reload the page and try again — extensions can't run on browser or Web Store pages.",
    );
  }
}

function App() {
  const [macros, setMacros] = useState<Macro[]>([]);
  const [recording, setRecording] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [recordingFeed, setRecordingFeed] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const recordingTabId = useRef<number | null>(null);

  useEffect(() => {
    getMacros().then(setMacros);
  }, []);

  useEffect(() => {
    function onMessage(message: RuntimeEvent) {
      if (message.type === "STEP_RECORDED") {
        setRecordingFeed((prev) => [...prev, describeStep(message.step)]);
      } else if (message.type === "REPLAY_STEP") {
        const tag = message.status === "failed" ? "FAILED" : message.status === "ok" ? "OK" : "...";
        setLog((prev) => [...prev, `[${message.index + 1}/${message.total}] ${tag} — ${message.description}`]);
      } else if (message.type === "REPLAY_DONE") {
        setReplaying(false);
      }
    }
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  async function handleStartRecording() {
    setError(null);
    const tab = await getActiveTab();
    if (!tab?.id) return;
    if (isRestrictedUrl(tab.url)) {
      setError("Aperture can't record on browser or Web Store pages. Open a regular website first.");
      return;
    }
    recordingTabId.current = tab.id;
    setRecordingFeed([]);
    await beginRecording(tab.id);
    setRecording(true);
  }

  async function handleStopRecording() {
    const tabId = recordingTabId.current;
    if (!tabId) return;
    setStopping(true);
    // Give the most recent click's storage write time to land before we
    // read the final list — it's an async round trip to the page.
    await delay(300);
    const steps = await endRecording(tabId);
    setRecording(false);
    setStopping(false);
    if (steps.length === 0) {
      window.alert("No actions were recorded.");
      return;
    }

    const name = window.prompt("Name this macro:", `Macro ${macros.length + 1}`);
    if (!name) return;
    const macro: Macro = { id: crypto.randomUUID(), name, createdAt: Date.now(), steps };
    await saveMacro(macro);
    setMacros(await getMacros());
  }

  async function handleReplay(macro: Macro) {
    setError(null);
    const tab = await getActiveTab();
    if (!tab?.id) return;
    if (isRestrictedUrl(tab.url)) {
      setError("Aperture can't run on browser or Web Store pages. Open a regular website first.");
      return;
    }
    setLog([]);
    setReplaying(true);
    try {
      await sendToContentScript(tab.id, { type: "REPLAY_MACRO", macro });
    } catch (err) {
      setReplaying(false);
      setError((err as Error).message);
    }
  }

  async function handleDelete(id: string) {
    await deleteMacro(id);
    setMacros(await getMacros());
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Aperture</h1>
        <p className="tagline">Record and replay browser macros — entirely on-device.</p>
      </header>

      {error && (
        <div className="error-banner">
          {error}
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
          <button className="btn btn-stop" onClick={handleStopRecording} disabled={stopping}>
            {stopping ? "Finishing…" : "■ Stop recording"}
          </button>
        )}
        {recording && (
          <>
            <p className="hint">
              Click and type on the page — every action is captured live below, even across page navigations.
            </p>
            <ul className="log-list feed">
              {recordingFeed.length === 0 && <li className="empty">Waiting for your first action…</li>}
              {recordingFeed.map((line, i) => (
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
