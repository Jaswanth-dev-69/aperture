import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "Aperture",
  description: "Privacy-first browser automation. Records and replays macros entirely on-device — nothing you do ever leaves your machine.",
  version: pkg.version,
  icons: {
    16: "public/icons/icon16.png",
    48: "public/icons/icon48.png",
    128: "public/icons/icon128.png",
  },
  action: {
    default_title: "Open Aperture",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/content-script.ts"],
      run_at: "document_start", // attach listeners before the page can fire events
      all_frames: false,
    },
  ],
  permissions: ["activeTab", "scripting", "sidePanel", "storage", "tabs"],
  // Needed for chrome.tabs.captureVisibleTab() (the vision-agent demo) to
  // work reliably regardless of activeTab's gesture-scoped grant timing —
  // content_scripts already inject at this same <all_urls> breadth.
  host_permissions: ["<all_urls>"],
  // MV3's default CSP omits 'wasm-unsafe-eval', so any WebAssembly module —
  // here, onnxruntime-web's local inference engine for the vision-agent demo
  // — fails to compile without this explicit override.
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
  },
});
