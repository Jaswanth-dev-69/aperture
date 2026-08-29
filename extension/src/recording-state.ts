import type { MacroStep } from "./types";

/**
 * Shared read/write helpers for in-progress recording state, backed by
 * chrome.storage.session so it survives a page navigation mid-recording —
 * a single content-script instance's in-memory state does not.
 */

function storageKey(tabId: number): string {
  return `recording_${tabId}`;
}

export function recordingStorageKey(tabId: number): string {
  return storageKey(tabId);
}

export async function getRecordingSteps(tabId: number): Promise<MacroStep[] | null> {
  const k = storageKey(tabId);
  const result = await chrome.storage.session.get(k);
  const steps = result[k];
  return Array.isArray(steps) ? (steps as MacroStep[]) : null;
}

export async function beginRecording(tabId: number): Promise<void> {
  await chrome.storage.session.set({ [storageKey(tabId)]: [] });
}

export async function appendRecordingStep(tabId: number, step: MacroStep): Promise<void> {
  const steps = (await getRecordingSteps(tabId)) ?? [];
  steps.push(step);
  await chrome.storage.session.set({ [storageKey(tabId)]: steps });
}

export async function endRecording(tabId: number): Promise<MacroStep[]> {
  const steps = (await getRecordingSteps(tabId)) ?? [];
  await chrome.storage.session.remove(storageKey(tabId));
  return steps;
}
