import type { BackgroundMessage, BackgroundResponse } from "../messages";

// chrome.storage.session defaults to background/side-panel-only access;
// content scripts need this explicitly to read/write recording state.
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[Aperture] service worker installed");
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" }).catch(() => {});
});

// Open the side panel when the user clicks the toolbar icon.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});

// Content scripts don't have access to chrome.tabs; they ask us for their own tab id.
chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse: (r: BackgroundResponse) => void) => {
  if (message.type === "WHOAMI") {
    sendResponse({ tabId: sender.tab?.id ?? null });
  }
});
