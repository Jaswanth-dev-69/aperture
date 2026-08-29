export interface ElementFingerprint {
  id?: string;
  ariaLabel?: string;
  role?: string;
  text?: string; // trimmed innerText, truncated
  tagName: string;
  structuralPath: string; // tag+nth-of-type path up a few ancestors
  boundingBox: { x: number; y: number; width: number; height: number }; // viewport-relative at record time
}

export type StepType = "click" | "input";

export interface MacroStep {
  type: StepType;
  fingerprint: ElementFingerprint;
  value?: string; // set for "input" steps
  timestamp: number;
}

export interface Macro {
  id: string;
  name: string;
  createdAt: number;
  steps: MacroStep[];
}
