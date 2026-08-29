import { fingerprint, resolve } from "./selector-engine";
import type {
  FindElementResult,
  ScreenContext,
  SensitiveRegion,
  TabStatus,
  ToBackground,
  ToContent,
} from "../messages";
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

/**
 * Frameworks like React override the "value" property on the element
 * *instance*, so a plain `el.value = x` can get silently ignored — the
 * standard workaround is to call the *prototype's* native setter instead.
 * <input>, <textarea> and <select> each define their own "value" descriptor
 * on their own prototype; calling one on the wrong element type throws
 * "Illegal invocation", so the setter must match the actual tag.
 */
function nativeValueSetter(el: Element): ((value: string) => void) | null {
  const proto =
    el.tagName === "TEXTAREA"
      ? window.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  return setter ? (value: string) => setter.call(el, value) : null;
}

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
      const input = el as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      input.focus();
      const setValue = nativeValueSetter(input);
      if (setValue) setValue(step.value ?? "");
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

/* ---------------------------- vision-agent demo ---------------------------- */
/**
 * Supports the SIH26171 spec-compliance demo (see vision/README.md): DOM
 * fields known to carry sensitive input are reported so the side panel can
 * black them out of a screenshot before it ever leaves the device, and a
 * server-returned natural-language target ("the Search button") is resolved
 * back to a real element the same way a human would read it.
 */

const SENSITIVE_RULES: Array<{ selector: string; kind: string }> = [
  { selector: 'input[type="password"]', kind: "password" },
  { selector: 'input[autocomplete="current-password"], input[autocomplete="new-password"]', kind: "password" },
  { selector: 'input[autocomplete*="cc-"]', kind: "payment" },
  { selector: 'input[type="email"], input[autocomplete="email"]', kind: "email" },
  { selector: 'input[type="tel"], input[autocomplete*="tel"]', kind: "phone" },
  { selector: 'input[name*="ssn" i], input[id*="ssn" i]', kind: "id-number" },
];

function detectSensitiveRegions(): SensitiveRegion[] {
  const seen = new Set<Element>();
  const regions: SensitiveRegion[] = [];
  for (const { selector, kind } of SENSITIVE_RULES) {
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      continue;
    }
    matches.forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      regions.push({ x: r.x, y: r.y, width: r.width, height: r.height, kind });
    });
  }
  return regions;
}

function elementLabel(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const text = (el.textContent || "").trim();
  if (text) return text.slice(0, 80);
  const placeholder = (el as HTMLInputElement).placeholder;
  if (placeholder) return placeholder;
  return el.tagName.toLowerCase();
}

/** Labels only, never `.value` — this is the channel the PS allows sending
 * to a server unredacted ("structure of the screen, application fields"). */
function buildStructuralSummary(limit = 40): string[] {
  const items: string[] = [];
  document
    .querySelectorAll('button, a, input, select, textarea, [role="button"], h1, h2, h3')
    .forEach((el) => {
      if (items.length >= limit) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "input" && (el as HTMLInputElement).type === "password") {
        items.push("input: (password field, value withheld)");
        return;
      }
      items.push(`${tag}: ${elementLabel(el)}`);
    });
  return items;
}

function getScreenContext(): ScreenContext {
  return {
    sensitiveRegions: detectSensitiveRegions(),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    structuralSummary: buildStructuralSummary(),
  };
}

/** Cheap token-overlap score — good enough to disambiguate a short VLM
 * description like "the blue Search button" against real page labels. */
function scoreMatch(label: string, description: string): number {
  const l = label.toLowerCase();
  const d = description.toLowerCase();
  if (!d) return 0; // "".includes("") below would otherwise match everything
  if (l === d) return 1000;
  if (l.includes(d) || d.includes(l)) return 100 + Math.min(l.length, d.length);
  const lTokens = new Set(l.split(/\W+/).filter(Boolean));
  let overlap = 0;
  for (const t of d.split(/\W+/).filter(Boolean)) if (lTokens.has(t)) overlap++;
  return overlap;
}

async function findAndClickByDescription(description: string): Promise<FindElementResult> {
  // Guard first: String.includes("") is always true, so an empty description
  // would otherwise "match" every element on the page at a positive score.
  if (!description.trim()) return { found: false };

  const candidates = document.querySelectorAll(
    'button, a, input, select, textarea, [role="button"], [onclick]',
  );
  let best: Element | null = null;
  let bestScore = 0;
  candidates.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const score = scoreMatch(elementLabel(el), description);
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  });
  if (!best || bestScore <= 0) return { found: false };

  const el = best as HTMLElement;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  const restore = highlight(el);
  await delay(400);
  el.click();
  setTimeout(restore, 600);
  return { found: true, label: elementLabel(el) };
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
  if (message.type === "GET_SCREEN_CONTEXT") {
    sendResponse(getScreenContext());
    return;
  }
  if (message.type === "FIND_ELEMENT_BY_DESCRIPTION") {
    void findAndClickByDescription(message.description).then(sendResponse);
    return true; // async response
  }
});

// Announce this page and pick up any recording/replay already in flight.
void (async () => {
  const status = (await send({ type: "CONTENT_READY", url: location.href })) as TabStatus | undefined;
  if (status?.recording) recording = true;
})();
