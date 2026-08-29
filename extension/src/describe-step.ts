import type { MacroStep } from "./types";

export function describeStep(step: MacroStep): string {
  const fp = step.fingerprint;
  const label = fp.ariaLabel || fp.text || fp.id || fp.tagName;
  return step.type === "click" ? `Click "${label}"` : `Type "${step.value}" into "${label}"`;
}
