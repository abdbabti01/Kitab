import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Measures requestAnimationFrame intervals while a TCP mission plays at 2×.
 * Headless Chromium on the CI/dev machine, optionally with 4× CPU throttling
 * via CDP. These are indicative numbers, not real-device validation.
 */
for (const throttle of [1, 4]) {
  test(`playback frame timing, CPU throttle ${throttle}×`, async ({ page }, info) => {
    test.skip(!process.env.KITAB_PERF, "Opt-in: KITAB_PERF=1 npx playwright test perf --workers=1 (timing is meaningless under parallel load or on shared CI runners).");
    test.skip(info.project.name !== "desktop-1440" && info.project.name !== "phone-390");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    await page.goto("/missions/tcp-lab");
    await page.getByRole("button", { name: "Just watch (no credit)" }).click();
    await page.getByRole("combobox", { name: "Speed" }).selectOption("2");
    const intervals = await page.evaluate(() => new Promise<number[]>((resolve) => {
      const values: number[] = [];
      let last = performance.now();
      const end = last + 6000;
      const step = (now: number) => {
        values.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(step);
        else resolve(values.slice(1));
      };
      requestAnimationFrame(step);
    }));
    const sorted = [...intervals].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const result = { project: info.project.name, throttle, frames: intervals.length, meanMs: +(intervals.reduce((a, b) => a + b, 0) / intervals.length).toFixed(2), p50Ms: +pct(0.5).toFixed(2), p95Ms: +pct(0.95).toFixed(2), maxMs: +sorted.at(-1)!.toFixed(2), over50ms: intervals.filter((value) => value > 50).length };
    mkdirSync("test-results/perf", { recursive: true });
    writeFileSync(`test-results/perf/${info.project.name}-x${throttle}.json`, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    // Loose guard against regressions; the documented numbers are what matters.
    expect(result.p95Ms).toBeLessThan(throttle === 1 ? 50 : 120);
  });
}
