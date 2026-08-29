import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  webServer: {
    command: "python3 -m http.server 8420 --directory ../practice-site",
    url: "http://localhost:8420/index.html",
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
});
