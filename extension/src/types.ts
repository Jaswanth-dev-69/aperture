export interface ElementFingerprint {
  id?: string;
  ariaLabel?: string;
  role?: string;
  text?: string; // trimmed innerText, truncated
  tagName: string;
  structuralPath: string; // tag+nth-of-type path up a few ancestors
  boundingBox: { x: number; y: number; width: number; height: number }; // viewport-relative at record time
}

export type StepType = "click" | "input" | "key" | "scroll" | "navigate";

export interface MacroStep {
  type: StepType;
  timestamp: number; // epoch ms, used to reproduce real 1x timing on replay
  url: string; // page the step was recorded on
  fingerprint?: ElementFingerprint; // absent for scroll/navigate
  value?: string; // "input": the field's value; "key": the key name
  scroll?: { x: number; y: number };
}

export interface Macro {
  id: string;
  name: string;
  createdAt: number;
  startUrl: string;
  steps: MacroStep[];
}
