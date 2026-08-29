import { fingerprint, resolve } from "./selector-engine";
import { appendRecordingStep, getRecordingSteps, recordingStorageKey } from "../recording-state";
import { getReplayState, setReplayState } from "../replay-state";
import { describeStep } from "../describe-step";
import type { BackgroundMessage, BackgroundResponse, ContentMessage, RuntimeEvent } from "../messages";
import type { Macro, MacroStep } from "../types";

console.log("[Aperture] content script loaded on", location.href);

let myTabId: number | null = null;
let recording = false;

// chrome.storage's read-modify-write cycle isn't atomic: two rapid clicks can
// both read the same list before either write lands, and one step silently
// disappears. Chaining every append onto one promise forces them to happen
// strictly one at a time.
let writeQueue: Promise<void> = Promise.resolve();

function enqueueStep(step: MacroStep): Promise<void> {
  if (myTabId == null) return Promise.resolve();
  const tabId = myTabId;
  const task = writeQueue.then(async () => {
    await appendRecordingStep(tabId, step);
    sendRuntimeEvent({ type: "STEP_RECORDED", step });
  });
  writeQueue = task.catch(() => {});
  return task;
}

function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

/** An <a href> click that will navigate *this* tab, tearing down this page context. */
function findNavigatingAnchor(target: Element): HTMLAnchorElement | null {
  const a = target.closest("a[href]") as HTMLAnchorElement | null;
  if (!a) return null;
  if (a.target && a.target !== "_self") return null; // opens elsewhere; this page survives
  const href = a.getAttribute("href") ?? "";
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) return null;
  return a;
}

async function onClick(e: MouseEvent) {
  if (!recording || myTabId == null) return;
  const target = e.target as Element | null;
  if (!target) return;

  const step: MacroStep = { type: "click", fingerprint: fingerprint(target), timestamp: Date.now() };
  const anchor = isPlainLeftClick(e) ? findNavigatingAnchor(target) : null;

  if (anchor) {
    // Hold the navigation until the step is actually persisted, since a
    // pending storage write is not guaranteed to survive a page unload.
    e.preventDefault();
    await enqueueStep(step);
    window.location.href = anchor.href;
    return;
  }

  void enqueueStep(step);
}

function onChange(e: Event) {
  if (!recording || myTabId == null) return;
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!target) return;
  if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && target.tagName !== "SELECT") return;
  void enqueueStep({
    type: "input",
    fingerprint: fingerprint(target),
    value: target.value,
    timestamp: Date.now(),
  });
}

function attachListeners() {
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
}

function detachListeners() {
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("change", onChange, true);
}

async function init() {
  const res = (await chrome.runtime.sendMessage({ type: "WHOAMI" } satisfies BackgroundMessage)) as
    | BackgroundResponse
    | undefined;
  myTabId = res?.tabId ?? null;
  if (myTabId == null) return;

  // Resume a recording that was already in progress before this page loaded
  // (e.g. the user just navigated here mid-recording).
  const existing = await getRecordingSteps(myTabId);
  if (existing) {
    recording = true;
    attachListeners();
  }

  // Resume a replay that a navigating step interrupted on the previous page.
  const pendingReplay = await getReplayState(myTabId);
  if (pendingReplay && pendingReplay.nextIndex < pendingReplay.macro.steps.length) {
    await delay(600); // let the freshly loaded page settle before acting on it
    void replayMacro(pendingReplay.macro, pendingReplay.nextIndex);
  } else if (pendingReplay) {
    await setReplayState(myTabId, null);
    sendRuntimeEvent({ type: "REPLAY_DONE" });
  }

  // Live toggle while this page instance stays alive (record started/stopped
  // from the side panel without a navigation happening).
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "session" || myTabId == null) return;
    const key = recordingStorageKey(myTabId);
    if (!(key in changes)) return;
    const isNowRecording = changes[key].newValue !== undefined;
    if (isNowRecording && !recording) {
      recording = true;
      attachListeners();
    } else if (!isNowRecording && recording) {
      recording = false;
      detachListeners();
    }
  });
}
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
)?.set;

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function sendRuntimeEvent(event: RuntimeEvent) {
  chrome.runtime.sendMessage(event).catch(() => {
    // Side panel may be closed — nothing to do.
  });
}

/** Outline the element being replayed so a human watching can follow along. */
function highlightElement(el: HTMLElement): () => void {
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "3px solid #4FD1C0";
  el.style.outlineOffset = "2px";
  return () => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
  };
}

/** True once the page has started tearing down for a navigation. */
let unloading = false;
window.addEventListener("beforeunload", () => {
  unloading = true;
});

async function replayMacro(macro: Macro, startIndex: number) {
  if (myTabId == null) return;
  const tabId = myTabId;
  const macroSteps = macro.steps;
  const total = macroSteps.length;

  for (let i = startIndex; i < total; i++) {
    const step = macroSteps[i];
    const description = describeStep(step);

    // Persist progress *before* acting: if this step navigates, the next
    // page's content script picks up exactly here.
    await setReplayState(tabId, { macro, nextIndex: i + 1 });

    const el = resolve(step.fingerprint) as HTMLElement | null;
    if (!el) {
      sendRuntimeEvent({
        type: "REPLAY_STEP",
        index: i,
        total,
        status: "failed",
        description: `${description} — element not found`,
      });
      continue;
    }

    el.scrollIntoView({ block: "center" });
    const restoreHighlight = highlightElement(el);
    sendRuntimeEvent({ type: "REPLAY_STEP", index: i, total, status: "running", description });
    await delay(300); // let the highlight register before acting

    try {
      if (step.type === "click") {
        el.click();
      } else {
        const inputEl = el as HTMLInputElement;
        if (nativeInputValueSetter) nativeInputValueSetter.call(inputEl, step.value ?? "");
        else inputEl.value = step.value ?? "";
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
      sendRuntimeEvent({ type: "REPLAY_STEP", index: i, total, status: "ok", description });
    } catch (err) {
      sendRuntimeEvent({
        type: "REPLAY_STEP",
        index: i,
        total,
        status: "failed",
        description: `${description} — ${(err as Error).message}`,
      });
    }

    await delay(400);
    // The click triggered a navigation: stop here and let the next page's
    // content script resume from the persisted index.
    if (unloading) return;
    restoreHighlight();
    await delay(150);
  }

  await setReplayState(tabId, null);
  sendRuntimeEvent({ type: "REPLAY_DONE" });
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse: (r: { type: "ACK" }) => void) => {
  if (message.type === "REPLAY_MACRO") {
    void replayMacro(message.macro, 0);
    sendResponse({ type: "ACK" });
  }
});

void init();
