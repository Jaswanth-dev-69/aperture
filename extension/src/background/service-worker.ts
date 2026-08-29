import type {
  PanelState,
  StopRecordingResult,
  TabStatus,
  ToBackground,
  ToContent,
  ToPanel,
} from "../messages";
import { describeStep } from "../describe-step";
import type { Macro, MacroStep } from "../types";

/**
 * The service worker owns all recording and replay state.
 *
 * Pages are destroyed on every navigation, so they cannot hold state; the
 * worker can. It also gets the sender's tab id for free from `sender.tab`,
 * so a content script never has to ask who it is before it can report an
 * event. Worker state is mirrored into chrome.storage.session because MV3
 * terminates idle workers.
 */

interface RecordingSession {
  startUrl: string;
  steps: MacroStep[];
}

interface ReplaySession {
  macro: Macro;
  nextIndex: number;
  aborted: boolean;
}

/**
 * Guards against two replay loops running at once for the same tab: after a
 * navigation both the waiting loop and the new page's CONTENT_READY would
 * otherwise try to resume. Not persisted — it is only meaningful in-process.
 */
const activeLoops = new Set<number>();

const recordings = new Map<number, RecordingSession>();
const replays = new Map<number, ReplaySession>();

const RECORDINGS_KEY = "aperture_recordings";
const REPLAYS_KEY = "aperture_replays";

async function persist() {
  await chrome.storage.session.set({
    [RECORDINGS_KEY]: Object.fromEntries(recordings),
    [REPLAYS_KEY]: Object.fromEntries(replays),
  });
}

let restored: Promise<void> | null = null;
function ensureRestored(): Promise<void> {
  if (!restored) {
    restored = (async () => {
      const data = await chrome.storage.session.get([RECORDINGS_KEY, REPLAYS_KEY]);
      for (const [k, v] of Object.entries(data[RECORDINGS_KEY] ?? {})) {
        recordings.set(Number(k), v as RecordingSession);
      }
      for (const [k, v] of Object.entries(data[REPLAYS_KEY] ?? {})) {
        replays.set(Number(k), v as ReplaySession);
      }
    })();
  }
  return restored;
}

function toPanel(message: ToPanel) {
  // The side panel may be closed; that rejection is expected and harmless.
  chrome.runtime.sendMessage(message).catch(() => {});
}

function toContent(tabId: number, message: ToContent): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Aperture] service worker installed");
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

/* ------------------------------- recording ------------------------------- */

/**
 * Typing fires one event per keystroke. Collapse consecutive input events on
 * the same field into a single step holding the final value, so a replay types
 * "hello" once instead of h, he, hel, hell, hello.
 */
function sameField(a: MacroStep, b: MacroStep): boolean {
  if (a.type !== "input" || b.type !== "input") return false;
  const fa = a.fingerprint;
  const fb = b.fingerprint;
  if (!fa || !fb) return false;
  return fa.tagName === fb.tagName && fa.structuralPath === fb.structuralPath && fa.id === fb.id;
}

function recordStep(tabId: number, step: MacroStep) {
  const session = recordings.get(tabId);
  if (!session) return;

  const last = session.steps[session.steps.length - 1];
  if (last && sameField(last, step)) {
    last.value = step.value;
    last.timestamp = step.timestamp;
  } else {
    session.steps.push(step);
  }
  void persist();
  toPanel({ type: "STEP_RECORDED", step });
}

/* -------------------------------- replay --------------------------------- */

const MAX_GAP_MS = 8000; // don't reproduce long idle pauses verbatim

function gapBefore(macro: Macro, index: number): number {
  if (index === 0) return 0;
  const gap = macro.steps[index].timestamp - macro.steps[index - 1].timestamp;
  return Math.max(0, Math.min(gap, MAX_GAP_MS));
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * A click that follows a link returns successfully well before the page starts
 * unloading, so after every step we give the tab a moment to commit to a
 * navigation and then wait it out. Without this the loop races ahead and runs
 * the next step against a document that is already being torn down.
 */
async function waitForTabIdle(tabId: number, settleMs = 250): Promise<void> {
  await delay(settleMs);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.status !== "loading") return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, 15000); // don't hang on a stalled page
    function onUpdated(updatedId: number, info: chrome.tabs.OnUpdatedInfo) {
      if (updatedId === tabId && info.status === "complete") finish();
    }
    function finish() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  await delay(400); // let the new document's scripts initialize
}

/**
 * Runs steps one at a time. If a step navigates, the tab's content script dies
 * mid-step; `onContentReady` calls back in once the new page is up and the loop
 * continues from the persisted index.
 */
async function runReplay(tabId: number) {
  const session = replays.get(tabId);
  if (!session) return;
  if (activeLoops.has(tabId)) return; // a loop is already driving this tab
  activeLoops.add(tabId);
  try {
    await replayLoop(tabId, session);
  } finally {
    activeLoops.delete(tabId);
  }
}

async function replayLoop(tabId: number, session: ReplaySession) {
  const { macro } = session;
  const total = macro.steps.length;

  while (session.nextIndex < total) {
    if (session.aborted) break;

    const index = session.nextIndex;
    const step = macro.steps[index];
    const description = describeStep(step);

    await delay(gapBefore(macro, index)); // reproduce the original 1x pacing
    if (session.aborted) break;

    session.nextIndex = index + 1;
    await persist();

    toPanel({ type: "REPLAY_PROGRESS", index, total, status: "running", description });

    try {
      const result = (await toContent(tabId, { type: "EXECUTE_STEP", step, index, total })) as
        | { ok: boolean; detail?: string }
        | undefined;
      if (result?.ok) {
        toPanel({ type: "REPLAY_PROGRESS", index, total, status: "ok", description });
      } else {
        toPanel({
          type: "REPLAY_PROGRESS",
          index,
          total,
          status: "failed",
          description: `${description} — ${result?.detail ?? "could not find element"}`,
        });
      }
    } catch {
      // The page tore down mid-step: this step triggered a navigation.
      // onContentReady resumes the loop when the next page reports in.
      return;
    }

    // If that step started a navigation, hold here until the new page is ready.
    await waitForTabIdle(tabId);
    if (session.aborted) break;
  }

  const aborted = session.aborted;
  replays.delete(tabId);
  await persist();
  toPanel({ type: "REPLAY_DONE", aborted });
}

/** A content script finished loading — resume anything that was in flight. */
async function onContentReady(tabId: number) {
  if (recordings.has(tabId)) {
    void toContent(tabId, { type: "SET_RECORDING", recording: true }).catch(() => {});
  }
  const replay = replays.get(tabId);
  if (replay && !replay.aborted && replay.nextIndex < replay.macro.steps.length) {
    await delay(400); // let the fresh page settle before acting on it
    void runReplay(tabId);
  }
}

/* ------------------------------- messaging ------------------------------- */

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse) => {
  void (async () => {
    await ensureRestored();
    const senderTabId = sender.tab?.id;

    switch (message.type) {
      case "CONTENT_READY": {
        if (senderTabId != null) {
          sendResponse({
            recording: recordings.has(senderTabId),
            replaying: replays.has(senderTabId),
          } satisfies TabStatus);
          void onContentReady(senderTabId);
        } else {
          sendResponse({ recording: false, replaying: false } satisfies TabStatus);
        }
        return;
      }

      case "GET_TAB_STATUS": {
        sendResponse({
          recording: senderTabId != null && recordings.has(senderTabId),
          replaying: senderTabId != null && replays.has(senderTabId),
        } satisfies TabStatus);
        return;
      }

      case "RECORD_STEP": {
        if (senderTabId != null) recordStep(senderTabId, message.step);
        sendResponse({ ok: true });
        return;
      }

      case "START_RECORDING": {
        const tab = await chrome.tabs.get(message.tabId).catch(() => null);
        recordings.set(message.tabId, { startUrl: tab?.url ?? "", steps: [] });
        await persist();
        await toContent(message.tabId, { type: "SET_RECORDING", recording: true }).catch(() => {});
        sendResponse({ ok: true });
        return;
      }

      case "STOP_RECORDING": {
        const session = recordings.get(message.tabId);
        recordings.delete(message.tabId);
        await persist();
        await toContent(message.tabId, { type: "SET_RECORDING", recording: false }).catch(() => {});
        sendResponse({
          steps: session?.steps ?? [],
          startUrl: session?.startUrl ?? "",
        } satisfies StopRecordingResult);
        return;
      }

      case "START_REPLAY": {
        replays.set(message.tabId, { macro: message.macro, nextIndex: 0, aborted: false });
        await persist();
        sendResponse({ ok: true });
        void runReplay(message.tabId);
        return;
      }

      case "ABORT_REPLAY": {
        const replay = replays.get(message.tabId);
        if (replay) replay.aborted = true;
        replays.delete(message.tabId);
        await persist();
        sendResponse({ ok: true });
        toPanel({ type: "REPLAY_DONE", aborted: true });
        return;
      }

      case "GET_PANEL_STATE": {
        sendResponse({
          recording: recordings.has(message.tabId),
          replaying: replays.has(message.tabId),
          recordedSteps: recordings.get(message.tabId)?.steps ?? [],
        } satisfies PanelState);
        return;
      }

      // Relayed straight through to the content script — the worker doesn't
      // need to own state for these, just the tab id to route to.
      case "GET_SCREEN_CONTEXT": {
        const context = await toContent(message.tabId, { type: "GET_SCREEN_CONTEXT" }).catch(() => null);
        sendResponse(context);
        return;
      }

      case "FIND_ELEMENT_BY_DESCRIPTION": {
        const result = await toContent(message.tabId, {
          type: "FIND_ELEMENT_BY_DESCRIPTION",
          description: message.description,
        }).catch(() => ({ found: false }));
        sendResponse(result);
        return;
      }
    }
  })();

  return true; // keep the message channel open for the async work above
});

/* Clean up state for tabs that go away. */
chrome.tabs.onRemoved.addListener((tabId) => {
  recordings.delete(tabId);
  replays.delete(tabId);
  void persist();
});
