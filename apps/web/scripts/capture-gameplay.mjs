import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const output = path.resolve(process.argv[2] ?? "artifacts/gameplay-review.png");
await mkdir(path.dirname(output), { recursive: true });

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(60000);
  await page.addInitScript(() => {
    window.requestAnimationFrame = (callback) =>
      window.setTimeout(() => callback(performance.now()), 100);
    window.cancelAnimationFrame = (handle) => window.clearTimeout(handle);
  });
  const origin = process.env.REVIEW_ORIGIN ?? "http://localhost:5173";
  await page.goto(origin + "?visual-review=1", {
    waitUntil: "networkidle",
  });
  await page.waitForFunction(() => !document.querySelector(".model-loading"));
  await page.getByRole("button", { name: "JUGAR DEMO LOCAL" }).click({
    force: true,
    noWaitAfter: true,
  });
  await page.waitForSelector(".phase-race");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(4500);
  await page.keyboard.up("ArrowUp");
  await page.waitForTimeout(750);
  const telemetry = {
    speed: await page.locator(".speed strong").innerText(),
    phase: await page.locator(".phase-race").count(),
  };
  await page.screenshot({ path: output });
  console.log(JSON.stringify({ output, ...telemetry }));
} finally {
  await browser.close();
}
