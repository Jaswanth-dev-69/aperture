import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, "../dist");
const SITE = "http://localhost:8420";

async function launchWithExtension(userDataDir: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(userDataDir, {
    headless: false, // MV3 extensions are not reliably loadable in headless mode
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });
}

async function getExtensionId(context: BrowserContext): Promise<string> {
  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const match = sw.url().match(/^chrome-extension:\/\/([a-z]+)\//);
  if (!match) throw new Error(`Could not parse extension id from service worker URL: ${sw.url()}`);
  return match[1];
}

test("records a full shop -> checkout flow and replays it identically", async ({}, testInfo) => {
  const userDataDir = testInfo.outputPath("user-data");
  const context = await launchWithExtension(userDataDir);

  try {
    const extensionId = await getExtensionId(context);

    // The side panel is just an extension page — opening it in a normal tab
    // exercises the exact same React app and chrome.* calls a real docked
    // side panel would, without needing to drive browser chrome directly.
    const sitePage = await context.newPage();
    await sitePage.goto(`${SITE}/index.html`);

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);

    // chrome.tabs.query({active:true}) reflects real tab focus, not which page
    // issued the query — so the site tab must be focused before we act.
    await sitePage.bringToFront();

    await panel.getByRole("button", { name: /record new macro/i }).click();
    await expect(panel.getByText(/waiting for your first action/i)).toBeVisible();

    // Browse: shop -> product -> cart -> checkout.
    await sitePage.getByRole("link", { name: "View" }).first().click();
    await sitePage.locator("#qty").selectOption("2");
    await sitePage.getByRole("link", { name: "Add to cart" }).click();
    await sitePage.getByRole("link", { name: "Proceed to checkout" }).click();

    // Fill and submit the checkout form.
    await sitePage.locator("#name").fill("Ada Lovelace");
    await sitePage.locator("#email").fill("ada@example.com");
    await sitePage.locator("#address").fill("12 Analytical Engine Ave");
    await sitePage.locator("#country").selectOption("UK");
    await sitePage.locator("#newsletter").check();
    await sitePage.getByRole("button", { name: "Place order" }).click();
    await sitePage.waitForURL(/confirmation\.html/);

    // Stop recording and save the macro (accept the naming prompt).
    panel.once("dialog", (dialog) => dialog.accept("E2E Macro"));
    await panel.getByRole("button", { name: /stop recording/i }).click();
    await expect(panel.getByText("E2E Macro")).toBeVisible({ timeout: 10_000 });
    await expect(panel.getByText(/^(?!0 steps).+ steps?$/i)).toBeVisible();

    // Replay from the shop's home page and verify it reaches the same result.
    await sitePage.goto(`${SITE}/index.html`);
    await sitePage.bringToFront();
    await panel.getByRole("button", { name: /run/i }).click();

    await sitePage.waitForURL(/confirmation\.html/, { timeout: 30_000 });
    await expect(panel.getByText(/— finished —/i)).toBeVisible({ timeout: 10_000 });

    // Every step's replayed value should match what was recorded — catches
    // silent per-step failures that still happen to reach the right URL.
    await expect(panel.locator(".log li", { hasText: "✕" })).toHaveCount(0);
    await expect(sitePage.getByText("Mechanical Keyboard")).toBeVisible();
    await expect(sitePage.getByText("$178.00")).toBeVisible(); // 2x $89.00 — proves qty=2 replayed
    await expect(sitePage.getByText("Ada Lovelace")).toBeVisible();
    await expect(sitePage.getByText("ada@example.com")).toBeVisible();
    await expect(sitePage.getByText("12 Analytical Engine Ave")).toBeVisible();
    await expect(sitePage.getByText("UK")).toBeVisible();
    await expect(sitePage.getByText("Subscribed")).toBeVisible();
  } finally {
    await context.close();
  }
});
