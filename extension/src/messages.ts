import type { Macro, MacroStep } from "./types";

/** Sent from the side panel to a page's content script via chrome.tabs.sendMessage. */
export type ContentMessage = { type: "REPLAY_MACRO"; macro: Macro };

/** Sent from a content script to the service worker to learn its own tab id. */
export type BackgroundMessage = { type: "WHOAMI" };
export interface BackgroundResponse {
  tabId: number | null;
}

/** Sent from a content script to the side panel via chrome.runtime.sendMessage. */
export type RuntimeEvent =
  | { type: "STEP_RECORDED"; step: MacroStep }
  | {
      type: "REPLAY_STEP";
      index: number;
      total: number;
      status: "running" | "ok" | "failed";
      description: string;
    }
  | { type: "REPLAY_DONE" };
