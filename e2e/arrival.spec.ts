import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";

// Arrival: the homepage shows a recording of a real run, and the lab explains itself once.
const recording = JSON.parse(fs.readFileSync(new URL("../src/app/hero-trace.json", import.meta.url), "utf8"));
const demo = (page: Page) => page.locator(".hero-demo");
const caption = (page: Page) => demo(page).locator(".hero-demo-caption");
const name = (id: string) => recording.devices.find((d: { id: string }) => d.id === id).name;

test("the homepage demonstration steps through the recorded crossings, in order, and ends on the run's summary", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // Nothing takes the focus, and the demonstration holds still until asked.
  await expect(page.locator("body")).toBeFocused();
  for (const [k, c] of recording.crossings.entries()) {
    await expect(caption(page)).toContainText(c.stage);
    await expect(caption(page)).toContainText(`${name(c.from)} sends to ${name(c.to)}:`);
    await expect(caption(page)).toContainText(c.what);
    await expect(caption(page)).toContainText(`Step ${k + 1} of ${recording.crossings.length} · event ${c.index + 1} of ${recording.events}`);
    // The packet sits on the link between the two devices of this crossing.
    await expect(demo(page).locator(".hero-device.is-sender")).toContainText(name(c.from));
    await expect(demo(page).locator(".hero-device.is-receiver")).toContainText(name(c.to));
    await demo(page).getByRole("button", { name: "Next step" }).click();
  }
  await expect(caption(page)).toContainText(recording.summary);
  await expect(demo(page).locator(".hero-packet")).toHaveCount(0);
  await expect(demo(page).getByRole("button", { name: "Replay the recording" })).toBeVisible();
  // Every step is also there as text.
  await demo(page).getByText(`All ${recording.crossings.length} steps as text`).click();
  await expect(demo(page).locator(".hero-demo-steps li")).toHaveCount(recording.crossings.length);
});

test("with reduced motion nothing moves; with motion it plays once and stops when the page is hidden", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const where = () => demo(page).locator(".hero-packet").getAttribute("style");
  const first = await where();
  await page.waitForTimeout(2500);
  expect(await where()).toBe(first);
  await expect(caption(page)).toContainText("Step 1 of");
  // With motion: it plays by itself, and Pause holds it.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  await expect(caption(page)).toContainText("Step 2 of", { timeout: 8000 });
  await demo(page).getByRole("button", { name: "Pause" }).click();
  const paused = await caption(page).textContent();
  await page.waitForTimeout(3000);
  expect(await caption(page).textContent()).toBe(paused);
  // A hidden page does not keep playing.
  await demo(page).getByRole("button", { name: "Play" }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(demo(page).getByRole("button", { name: "Play" })).toBeVisible();
});

test("the homepage opens the lab and keeps the learning path", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".journey-hero h1")).toBeInViewport();
  await expect(page.locator(".journey-hero")).toContainText("Watch");
  await expect(page.locator(".journey-hero")).toContainText("Predict");
  await expect(page.locator(".journey-hero")).toContainText("Experiment");
  await expect(page.locator("#path")).toBeAttached();
  await page.getByRole("link", { name: "Open the network lab" }).click();
  await expect(page).toHaveURL(/\/practice\/network$/);
  await expect(page.getByRole("heading", { name: "Network playground." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("the lab introduces itself once, to new and returning learners alike, and never takes the focus", async ({ page }) => {
  await page.goto("/practice/network");
  const intro = page.getByRole("region", { name: "Welcome to the network lab" });
  await expect(intro).toContainText("Send");
  await expect(intro).toContainText("Predict as you go");
  await expect(intro).toContainText("Break and compare");
  await expect(intro.getByRole("button", { name: "Got it" })).not.toBeFocused();
  // A learner who has used the lab before sees what is new.
  await page.reload();
  await expect(page.getByRole("region", { name: "What is new in the network lab" })).toContainText("The network lab has changed.");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(page.locator(".lab-intro")).toHaveCount(0);
  await page.reload();
  await page.locator(".journey-start").waitFor();
  await expect(page.locator(".lab-intro")).toHaveCount(0);
  // The heading still says what to do.
  await expect(page.locator(".playground-heading")).toContainText("Send a request and watch every frame cross your network.");
});
