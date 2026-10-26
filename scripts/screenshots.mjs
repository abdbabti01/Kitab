// Captures docs/screenshots against the E2E server (real Worker handler, fake bindings):
//   npx vite --config vite.e2e.config.ts --port 5175 &  node scripts/screenshots.mjs
import { chromium } from "@playwright/test";
const base = process.env.KITAB_URL ?? "http://localhost:5175";
const out = "docs/screenshots";
const browser = await chromium.launch();
const choose = (page, text) => page.locator("label.choice", { hasText: text }).click();
const end = async (page) => { await page.getByRole("slider", { name: "Step" }).focus(); await page.keyboard.press("End"); };
async function shot(name, viewport, steps, fullPage = false) {
  const page = await browser.newPage({ viewport });
  await steps(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage });
  await page.close();
}
await shot("01-home-1440", { width: 1440, height: 900 }, (p) => p.goto(`${base}/`));
await shot("02-mission-inspect-1440", { width: 1440, height: 1000 }, (p) => p.goto(`${base}/missions/tcp-lost-segment`));
await shot("03-mission-evidence-1440", { width: 1440, height: 1000 }, async (p) => {
  await p.goto(`${base}/missions/tcp-lost-segment`); await choose(p, "ACK 4501");
  await p.getByRole("button", { name: "Test prediction" }).click(); await end(p);
  await p.getByRole("button", { name: "Show me the evidence" }).click();
});
await shot("04-mission-mastered-1024", { width: 1024, height: 900 }, async (p) => {
  await p.goto(`${base}/missions/recursion-depth`); await choose(p, "4 frames");
  await p.getByRole("button", { name: "Test prediction" }).click(); await end(p);
  await choose(p, "factorial(1)"); await p.getByRole("button", { name: "Check explanation" }).click();
  await p.evaluate(() => window.scrollTo(0, 0));
});
await shot("05-recursion-overflow-1440", { width: 1440, height: 900 }, async (p) => {
  await p.goto(`${base}/missions/recursion-base-case`); await choose(p, "overflows");
  await p.getByRole("button", { name: "Test prediction" }).click(); await end(p);
  await p.getByRole("button", { name: "Show me the evidence" }).click();
});
await shot("06-bfs-run-768", { width: 768, height: 1024 }, async (p) => {
  await p.goto(`${base}/missions/graph-bfs-reach`); await choose(p, "4th vertex");
  await p.getByRole("button", { name: "Test prediction" }).click(); await p.getByRole("button", { name: "Pause" }).click();
  for (let i = 0; i < 4; i++) await p.getByRole("button", { name: "Next step" }).click();
  await p.locator(".scene").scrollIntoViewIfNeeded();
});
await shot("07-mission-phone-390", { width: 390, height: 844 }, (p) => p.goto(`${base}/missions/array-insert-shift`), true);
await shot("08-tutor-ai-1440", { width: 1440, height: 1000 }, async (p) => {
  await p.goto(`${base}/missions/tcp-lost-segment`); await p.getByRole("button", { name: "Explain this step" }).click();
  await p.locator(".guide").scrollIntoViewIfNeeded();
});
await shot("09-ds-lab-1440", { width: 1440, height: 1000 }, (p) => p.goto(`${base}/missions/ds-lab`));
await shot("10-draft-1440", { width: 1440, height: 1000 }, async (p) => {
  await p.goto(`${base}/`); await p.getByRole("searchbox").fill("bloom filter");
  await p.getByRole("button", { name: /Create a draft/ }).click(); await p.waitForURL(/drafts/);
});
await shot("11-concept-illustrative-1440", { width: 1440, height: 1000 }, (p) => p.goto(`${base}/concepts/message-queues`));
await browser.close();
console.log("screenshots written to", out);
