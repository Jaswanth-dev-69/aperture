chrome.runtime.onInstalled.addListener(() => {
  console.log("[Aperture] service worker installed");
});

// Open the side panel when the user clicks the toolbar icon.
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) chrome.sidePanel.open({ tabId: tab.id });
});
