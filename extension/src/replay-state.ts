import type { Macro } from "./types";

/**
 * Durable replay progress, backed by chrome.storage.session, so an in-flight
 * replay survives a step that navigates the page — mirrors recording-state.ts.
 */

export interface ReplayState {
  macro: Macro;
  nextIndex: number; // index of the next step to execute
}

function storageKey(tabId: number): string {
  return `replay_${tabId}`;
}

export async function getReplayState(tabId: number): Promise<ReplayState | null> {
  const k = storageKey(tabId);
  const result = await chrome.storage.session.get(k);
  return (result[k] as ReplayState | undefined) ?? null;
}

export async function setReplayState(tabId: number, state: ReplayState | null): Promise<void> {
  const k = storageKey(tabId);
  if (state === null) await chrome.storage.session.remove(k);
  else await chrome.storage.session.set({ [k]: state });
}
