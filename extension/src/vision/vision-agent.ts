import { env, pipeline, type ObjectDetectionPipeline } from "@huggingface/transformers";
import type { SensitiveRegion } from "../messages";

// onnxruntime-web's WASM *binary* resolves via import.meta.url automatically
// under Vite, but its JS loader script defaults to fetching from a CDN, which
// MV3's CSP (script-src 'self') blocks outright. Point both at a local copy
// bundled in public/ort/ instead.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("ort/");
}

/**
 * Client side of the SIH26171 spec-compliance demo. Separate from Aperture's
 * main deterministic record/replay product — see ./README.md for what this
 * is, why it exists, and its honest limitations as a proof of concept.
 */

export interface RedactionResult {
  originalDataUrl: string;
  redactedDataUrl: string;
  faceRegionsFound: number;
  sensitiveRegionsFound: number;
  width: number;
  height: number;
}

export interface AgentDecision {
  action: string;
  target: string;
  raw: string;
}

const AGENT_SERVER_URL = "http://localhost:8787";

let detectorPromise: Promise<ObjectDetectionPipeline> | null = null;

/**
 * onnxruntime-web's WebGPU execution provider can fail deep inside the first
 * *inference* call rather than at pipeline construction — by then it's too
 * late for a construction-time try/catch to fall back cleanly. Checking for
 * a real adapter via the standard API first avoids ever taking that path.
 */
async function webgpuAvailable(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    if (!gpu) return false;
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/** Lazy-loaded so the model is only fetched once the demo is actually used. */
function loadDetector(): Promise<ObjectDetectionPipeline> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const device = (await webgpuAvailable()) ? "webgpu" : undefined;
      return pipeline("object-detection", "Xenova/yolos-tiny", device ? { device } : undefined);
    })() as Promise<ObjectDetectionPipeline>;
  }
  return detectorPromise;
}

export function captureVisibleTab(): Promise<string> {
  return chrome.tabs.captureVisibleTab({ format: "png" });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode captured screenshot"));
    img.src = dataUrl;
  });
}

/**
 * Runs local object detection (a real ViT — YOLOS — via WebGPU/WASM) to find
 * people, approximates each detected person's face as the top slice of their
 * bounding box, and blacks out both that region and every DOM-flagged
 * sensitive field. The redacted image is the only one ever sent anywhere.
 */
export async function analyzeAndRedact(
  screenshotDataUrl: string,
  sensitiveRegions: SensitiveRegion[],
  viewportWidth: number,
  viewportHeight: number,
): Promise<RedactionResult> {
  const img = await loadImage(screenshotDataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  // The captured screenshot's pixel size can differ from the page's CSS
  // viewport (device pixel ratio) — scale DOM-reported boxes into image space.
  const scaleX = width / viewportWidth;
  const scaleY = height / viewportHeight;

  const detector = await loadDetector();
  const detections = await detector(screenshotDataUrl, { threshold: 0.5 });
  const faceRegions = detections
    .filter((d) => d.label === "person")
    .map((d) => {
      const { xmin, ymin, xmax, ymax } = d.box;
      const w = xmax - xmin;
      const h = ymax - ymin;
      // Approximate the face as the top ~35% of the detected person box — a
      // dedicated face model would give a tighter box; this is a clearly
      // labeled trade-off for a proof of concept, not the production design.
      return { x: xmin, y: ymin, width: w, height: h * 0.35 };
    });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  function redactBox(x: number, y: number, w: number, h: number, label: string) {
    ctx!.fillStyle = "#000000";
    ctx!.fillRect(x, y, w, h);
    if (w > 44 && h > 14) {
      ctx!.fillStyle = "#ffffff";
      ctx!.font = "11px monospace";
      ctx!.fillText(label, x + 4, y + h / 2 + 4);
    }
  }

  for (const r of faceRegions) redactBox(r.x, r.y, r.width, r.height, "FACE");
  for (const r of sensitiveRegions) {
    redactBox(r.x * scaleX, r.y * scaleY, r.width * scaleX, r.height * scaleY, r.kind.toUpperCase());
  }

  return {
    originalDataUrl: screenshotDataUrl,
    redactedDataUrl: canvas.toDataURL("image/jpeg", 0.85),
    faceRegionsFound: faceRegions.length,
    sensitiveRegionsFound: sensitiveRegions.length,
    width,
    height,
  };
}

/** Sends only the already-redacted image, the task, and label-only structure
 * — never the original screenshot, never a field value — to the local agent
 * server (see ../../server), which runs a local VLM and returns a plain-
 * language instruction for the client to re-resolve and execute itself. */
export async function askAgent(
  redactedDataUrl: string,
  task: string,
  structuralSummary: string[],
): Promise<AgentDecision> {
  let res: Response;
  try {
    res = await fetch(`${AGENT_SERVER_URL}/agent/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ redactedImageBase64: redactedDataUrl, task, structuralSummary }),
    });
  } catch {
    throw new Error(`Could not reach the agent server at ${AGENT_SERVER_URL} — is it running? (see server/README.md)`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `Agent server returned HTTP ${res.status}`);
  }
  return res.json();
}
