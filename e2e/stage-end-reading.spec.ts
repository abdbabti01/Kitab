import { test, expect } from "@playwright/test";

// Playing in Summary, each stage's last event stays on screen long enough to read the stage's summary: about 10 words
// a second at 1×, between 0.7 and 2 seconds (motion.ts), divided by the speed. Timers never fire early, so a slow
// machine only adds time: the check is a lower bound and never flakes the other way.
const readingMs = (text: string) => Math.min(2000, Math.max(700, text.trim().split(/\s+/).length * 100));

test("each stage's summary is held for its reading time while the journey plays", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "First event", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Summary" })).toHaveAttribute("aria-checked", "true");
  // Record when each event is shown, and what the card says then.
  await page.evaluate(() => {
    const w = window as unknown as { shown: { t: number; at: string; text: string }[] };
    w.shown = [];
    const pos = document.querySelector(".journey-position small")!;
    const note = () =>
      w.shown.push({ t: performance.now(), at: pos.textContent ?? "", text: document.querySelector(".journey-summary")?.textContent ?? "" });
    new MutationObserver(note).observe(pos, { subtree: true, characterData: true, childList: true });
  });
  // At 2× every hold is half as long; the run gets through more stages in the test's time.
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("2");
  await page.getByRole("button", { name: "Play journey" }).click();
  // The first stages of the run: a handful of summaries, long and short.
  await expect(page.locator(".journey-position small")).toContainText("Stage 6 of", { timeout: 40_000 });
  await page.getByRole("button", { name: "Pause playback" }).click();
  const shown = await page.evaluate(() => (window as unknown as { shown: { t: number; at: string; text: string }[] }).shown);
  const stageOf = (s: string) => s.match(/Stage (\d+)/)?.[1];
  const ends = shown.slice(0, -1).flatMap((s, i) => {
    const next = shown[i + 1];
    // A stage's last event: the next one shown begins another stage.
    return s.at.startsWith("Playing") && stageOf(next.at) !== stageOf(s.at) ? [{ ...s, held: next.t - s.t }] : [];
  });
  expect(ends.length).toBeGreaterThanOrEqual(4);
  for (const e of ends) expect(e.held, `${e.at}: "${e.text}"`).toBeGreaterThanOrEqual(readingMs(e.text) / 2 - 50);
  // At least one summary is long enough to need more than the shortest hold.
  expect(ends.some((e) => readingMs(e.text) > 1000)).toBe(true);
});
