import type { Macro, MacroStep } from "./types";

/**
 * All coordination goes through the service worker. It is the only component
 * that survives page navigation, and it learns the sender's tab id for free
 * from `sender.tab`, so no component ever has to look up its own identity.
 */

/** content script or side panel -> service worker */
export type ToBackground =
  | { type: "RECORD_STEP"; step: MacroStep }
  | { type: "GET_TAB_STATUS" } // content script asking: am I recording/replaying?
  | { type: "CONTENT_READY"; url: string } // content script finished loading
  | { type: "STEP_RESULT"; ok: boolean; detail?: string }
  | { type: "START_RECORDING"; tabId: number }
  | { type: "STOP_RECORDING"; tabId: number }
  | { type: "START_REPLAY"; tabId: number; macro: Macro }
  | { type: "ABORT_REPLAY"; tabId: number }
  | { type: "GET_PANEL_STATE"; tabId: number };

export interface TabStatus {
  recording: boolean;
  replaying: boolean;
}

export interface PanelState {
  recording: boolean;
  replaying: boolean;
  recordedSteps: MacroStep[];
}

export interface StopRecordingResult {
  steps: MacroStep[];
  startUrl: string;
}

/** service worker -> content script */
export type ToContent =
  | { type: "SET_RECORDING"; recording: boolean }
  | { type: "EXECUTE_STEP"; step: MacroStep; index: number; total: number };

/** service worker -> side panel (broadcast) */
export type ToPanel =
  | { type: "STEP_RECORDED"; step: MacroStep }
  | {
      type: "REPLAY_PROGRESS";
      index: number;
      total: number;
      status: "running" | "ok" | "failed";
      description: string;
    }
  | { type: "REPLAY_DONE"; aborted: boolean };
