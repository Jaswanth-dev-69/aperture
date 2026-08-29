import { fingerprint, resolve } from "./selector-engine";
import type { TabStatus, ToBackground, ToContent } from "../messages";
import type { MacroStep } from "../types";

/**
 * The page side is deliberately stateless: it reports events to the service
 * worker and executes steps the worker hands it. Listeners are attached
 * immediately at load — gated only by a boolean — so nothing is missed while
 * the worker is being asked whether this tab is recording.
 */

let recording = false;

function send(message: ToBackground): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

function baseStep(type: MacroStep["type"]): MacroStep {
  return { type, timestamp: Date.now(), url: location.href };
}

/* ------------------------------- capture --------------------------------- */

function onClick(e: MouseEvent) {
  if (!recording) return;
  const target = e.target as Element | null;
  if (!target) return;
  void send({
    type: "RECORD_STEP",
    step: { ...baseStep("click"), fingerprint: fingerprint(target) },
  });
}

function onInput(e: Event) {
  if (!recording) return;
  const target = e.target as HTMLInputElement | HTMLTextAreaElement | null;
  if (!target) return;
  const tag = target.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return;
  void send({
    type: "RECORD_STEP",
    step: { ...baseStep("input"), fingerprint: fingerprint(target), value: target.value },
  });
}

function onKeyDown(e: KeyboardEvent) {
  if (!recording) return;
  // Only keys that carry behavior on their own; ordinary typing is captured
  // by the input handler as a single collapsed step.
  if (e.key !== "Enter" && e.key !== "Escape" && e.key !== "Tab") return;
  const target = e.target as Element | null;
  void send({
    type: "RECORD_STEP",
    step: {
      ...baseStep("key"),
      fingerprint: target ? fingerprint(target) : undefined,
      value: e.key,
    },
  });
}

let scrollTimer: number | undefined;
function onScroll() {
  if (!recording) return;
  window.clearTimeout(scrollTimer);
  scrollTimer = window.setTimeout(() => {
    void send({
      type: "RECORD_STEP",
      step: { ...baseStep("scroll"), scroll: { x: window.scrollX, y: window.scrollY } },
    });
  }, 250);
}

document.addEventListener("click", onClick, true);
document.addEventListener("input", onInput, true);
document.addEventListener("change", onInput, true);
document.addEventListener("keydown", onKeyDown, true);
window.addEventListener("scroll", onScroll, { passive: true });

/* ------------------------------- execution -------------------------------- */

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  "value",
)?.set;

function highlight(el: HTMLElement): () => void {
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "3px solid #4FD1C0";
  el.style.outlineOffset = "2px";
  return () => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
  };
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function executeStep(step: MacroStep): Promise<{ ok: boolean; detail?: string }> {
  if (step.type === "scroll") {
    window.scrollTo({ left: step.scroll?.x ?? 0, top: step.scroll?.y ?? 0, behavior: "smooth" });
    return { ok: true };
  }

  if (!step.fingerprint) return { ok: false, detail: "step has no target" };
  const el = resolve(step.fingerprint) as HTMLElement | null;
  if (!el) return { ok: false, detail: "element not found on this page" };

  el.scrollIntoView({ block: "center", behavior: "smooth" });
  const restore = highlight(el);
  await delay(180); // make the highlight visible before acting

  try {
    if (step.type === "click") {
      el.click();
    } else if (step.type === "input") {
      const input = el as HTMLInputElement;
      input.focus();
      if (nativeInputValueSetter) nativeInputValueSetter.call(input, step.value ?? "");
      else input.value = step.value ?? "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (step.type === "key") {
      const key = step.value ?? "Enter";
      el.focus();
      for (const type of ["keydown", "keypress", "keyup"] as const) {
        el.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true }));
      }
      // Enter in a field usually means "submit this form".
      if (key === "Enter") {
        const form = (el as HTMLInputElement).form;
        if (form) form.requestSubmit?.();
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    setTimeout(restore, 350);
  }
}

/* ------------------------------- lifecycle -------------------------------- */

chrome.runtime.onMessage.addListener((message: ToContent, _sender, sendResponse) => {
  if (message.type === "SET_RECORDING") {
    recording = message.recording;
    sendResponse({ ok: true });
    return;
  }
  if (message.type === "EXECUTE_STEP") {
    void executeStep(message.step).then(sendResponse);
    return true; // async response
  }
});

// Announce this page and pick up any recording/replay already in flight.
void (async () => {
  const status = (await send({ type: "CONTENT_READY", url: location.href })) as TabStatus | undefined;
  if (status?.recording) recording = true;
})();
