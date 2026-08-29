import type { MacroStep } from "./types";

export function describeStep(step: MacroStep): string {
  const fp = step.fingerprint;
  const label = fp?.ariaLabel || fp?.text || fp?.id || fp?.tagName || "page";

  switch (step.type) {
    case "click":
      return `Click "${label}"`;
    case "input":
      return `Type "${step.value ?? ""}" into "${label}"`;
    case "key":
      return `Press ${step.value} on "${label}"`;
    case "scroll":
      return `Scroll to ${Math.round(step.scroll?.y ?? 0)}px`;
    case "navigate":
      return `Go to ${step.url}`;
  }
}
