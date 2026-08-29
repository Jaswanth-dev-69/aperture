import type { ElementFingerprint } from "../types";

/**
 * Selector engine: turns a DOM element into a resilient, replayable fingerprint,
 * and resolves a fingerprint back to a live element on a (possibly changed) page.
 *
 * Resolution order, each a fallback for the one before it:
 *   id (compatibility-checked) -> aria-label/role -> exact text (+ structural tiebreak)
 *   -> structural ancestor-path -> bounding-box proximity (tiebreak only)
 */

export function fingerprint(el: Element): ElementFingerprint {
  const rect = el.getBoundingClientRect();
  return {
    id: el.id || undefined,
    ariaLabel: el.getAttribute("aria-label") || undefined,
    role: el.getAttribute("role") || undefined,
    text: normalizeText(el.textContent),
    tagName: el.tagName,
    structuralPath: buildStructuralPath(el),
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}

export function resolve(fp: ElementFingerprint): Element | null {
  return (
    resolveById(fp) ?? resolveByAriaRole(fp) ?? resolveByText(fp) ?? resolveByStructure(fp) ?? null
  );
}

function resolveById(fp: ElementFingerprint): Element | null {
  if (!fp.id) return null;
  const el = document.getElementById(fp.id);
  return el && isCompatible(el, fp) ? el : null;
}

function resolveByAriaRole(fp: ElementFingerprint): Element | null {
  if (!fp.ariaLabel && !fp.role) return null;
  const parts: string[] = [];
  if (fp.ariaLabel) parts.push(`[aria-label="${cssEscape(fp.ariaLabel)}"]`);
  if (fp.role) parts.push(`[role="${cssEscape(fp.role)}"]`);
  let candidates: Element[];
  try {
    candidates = Array.from(document.querySelectorAll(parts.join(""))).filter(
      (el) => el.tagName === fp.tagName,
    );
  } catch {
    return null;
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return closestByPosition(candidates, fp);
}

function resolveByText(fp: ElementFingerprint): Element | null {
  if (!fp.text) return null;
  const candidates = Array.from(document.getElementsByTagName(fp.tagName)).filter(
    (el) => normalizeText(el.textContent) === fp.text,
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const structMatch = candidates.find((el) => buildStructuralPath(el) === fp.structuralPath);
  return structMatch ?? closestByPosition(candidates, fp);
}

function resolveByStructure(fp: ElementFingerprint): Element | null {
  if (!fp.structuralPath) return null;
  const candidates = Array.from(document.getElementsByTagName(fp.tagName)).filter(
    (el) => buildStructuralPath(el) === fp.structuralPath,
  );
  if (candidates.length === 0) return null;
  return closestByPosition(candidates, fp);
}

function closestByPosition(candidates: Element[], fp: ElementFingerprint): Element {
  const targetCx = fp.boundingBox.x + fp.boundingBox.width / 2;
  const targetCy = fp.boundingBox.y + fp.boundingBox.height / 2;
  let best = candidates[0];
  let bestDist = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const dist = Math.hypot(r.x + r.width / 2 - targetCx, r.y + r.height / 2 - targetCy);
    if (dist < bestDist) {
      bestDist = dist;
      best = el;
    }
  }
  return best;
}

function normalizeText(raw: string | null, maxLen = 80): string | undefined {
  if (!raw) return undefined;
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed ? collapsed.slice(0, maxLen) : undefined;
}

/** Short tag+nth-of-type path from a few ancestors down to el (not a full CSS selector). */
function buildStructuralPath(el: Element, maxDepth = 4): string {
  const parts: string[] = [];
  let node: Element | null = el;
  let depth = 0;
  while (node && depth < maxDepth) {
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTagSiblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      const idx = sameTagSiblings.indexOf(node);
      parts.unshift(`${node.tagName}:nth-of-type(${idx + 1})`);
    } else {
      parts.unshift(node.tagName);
    }
    node = parent;
    depth++;
  }
  return parts.join(">");
}

/** After an id match: same tag, and text not wildly different (or absent on both sides). */
function isCompatible(el: Element, fp: ElementFingerprint): boolean {
  if (el.tagName !== fp.tagName) return false;
  if (!fp.text) return true;
  const currentText = normalizeText(el.textContent);
  if (!currentText) return false;
  return currentText.includes(fp.text) || fp.text.includes(currentText);
}

function cssEscape(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}
