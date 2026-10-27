import { expect, test, type Page } from "@playwright/test";

// Interaction behaviours added after the learner walkthrough (all four widths).

const inViewport = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < window.innerHeight;
  });

test("the running scene and its playback controls are on screen after predicting", async ({ page }) => {
  await page.goto("/missions/tcp-lost-segment");
  await page.locator("label.choice", { hasText: "ACK 4501" }).click();
  await page.getByRole("button", { name: "Test prediction" }).click();
  await expect(page.getByTestId("prediction-strip")).toHaveText(/You predicted ACK 4501/);
  await expect.poll(() => inViewport(page, ".scene-head")).toBe(true);
  // The playback bar is sticky beside the scene, so Pause is reachable without scrolling.
  const pause = page.getByRole("button", { name: "Pause" });
  await expect.poll(() => pause.evaluate((element) => { const r = element.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight; })).toBe(true);
  await expect(page.locator(".step-count small")).toHaveText(/Playing 1×/);
  await pause.click();
  await expect(page.locator(".step-count small")).toHaveText("Paused");
});

test("'Show me the evidence' brings the evidence into view without moving focus", async ({ page }) => {
  await page.goto("/missions/tcp-lost-segment");
  await page.locator("label.choice", { hasText: "ACK 4501" }).click();
  await page.getByRole("button", { name: "Test prediction" }).click();
  await page.getByRole("slider", { name: "Step" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("prediction-strip")).toHaveText(/You predicted ACK 4501.*Engine computed ACK 2461/);
  const show = page.getByRole("button", { name: "Show me the evidence" });
  await show.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-entity="segment-2"]')).toHaveClass(/is-attention/);
  await expect.poll(() => inViewport(page, '[data-entity="segment-2"]')).toBe(true);
  await expect(show).toBeFocused();
  await expect(page.locator(".step-count small")).toHaveText("Paused");
});

test("rapid stepping, seeking during play and replay stay consistent", async ({ page }) => {
  await page.goto("/missions/recursion-depth");
  await page.getByRole("button", { name: "Just watch (no credit)" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("slider", { name: "Step" }).fill("0");
  const next = page.getByRole("button", { name: "Next step" });
  for (let i = 0; i < 6; i += 1) await next.click({ delay: 0 });
  await expect(page.locator(".scene-step")).toHaveText("Step 7 of 11");
  await expect(page.locator(".step-count b")).toHaveText("7/11");
  // Seeking while playing pauses at the chosen step.
  await page.getByRole("button", { name: "Play" }).click();
  await page.getByRole("slider", { name: "Step" }).fill("2");
  await expect(page.locator(".scene-step")).toHaveText("Step 3 of 11");
  await expect(page.locator(".step-count small")).toHaveText("Paused");
  await page.getByRole("slider", { name: "Step" }).fill("10");
  await expect(page.locator(".step-count small")).toHaveText("Run complete");
  await expect(page.getByRole("button", { name: "Replay" })).toBeVisible();
});

test("autoplay does not announce every step; manual steps are announced", async ({ page }) => {
  await page.goto("/missions/array-insert-shift");
  await page.getByRole("button", { name: "Just watch (no credit)" }).click();
  const live = page.locator(".scene p.sr-only[aria-live]");
  await expect(live).toHaveText("");
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(live).toHaveText(/^Step \d+: /);
});
