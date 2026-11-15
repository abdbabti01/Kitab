// Responsiveness of the Architecture Playground on a production build: by default a worst-case run (15,000 requests),
// then playback. Usage: node scripts/sd-perf.mjs [baseUrl] [requests per second]
import { chromium } from "@playwright/test";
const base = process.argv[2] ?? "http://localhost:5180";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(`${base}/practice/architecture?template=load-balanced`);
await page.addInitScript(() => {});
await page.evaluate(() => {
  window.__long = [];
  new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
});
// 1,500 requests per second for 10 s: the simulator's upper bound of 15,000 arrivals.
await page.locator("[data-node=client-1]").focus();
await page.keyboard.press("Enter");
await page.getByLabel("Requests per second").fill(process.argv[3] ?? "1500");
await page.locator("[data-node=api-1]").focus();
await page.waitForTimeout(500);
await page.evaluate(() => (window.__long = []));
const t0 = Date.now();
await page.getByRole("button", { name: "Run simulation" }).click();
await page.getByText(/event 0 of/).waitFor();
const ready = Date.now() - t0;
const events = await page.locator(".clock").textContent();
const runTasks = await page.evaluate(() => window.__long.splice(0));
await page.getByRole("button", { name: "Play" }).click();
await page.waitForTimeout(3000);
const frames = await page.evaluate(() => new Promise((resolve) => { let n = 0; const start = performance.now(); const tick = () => (++n, performance.now() - start < 2000 ? requestAnimationFrame(tick) : resolve(n / 2)); requestAnimationFrame(tick); }));
const playTasks = await page.evaluate(() => window.__long.splice(0));
await page.getByRole("button", { name: "Pause" }).click();
const t1 = Date.now();
await page.getByLabel("Simulated time").fill("1000");
await page.getByText(/^1\.000 s/).waitFor();
const seekBack = Date.now() - t1;
console.log(JSON.stringify({ events, clickToReadyMs: ready, longTasksDuringRunMs: runTasks, playbackFps: frames, longTasksDuringPlayback: { count: playTasks.length, max: Math.max(0, ...playTasks) }, seekBackMs: seekBack }, null, 1));
await browser.close();
