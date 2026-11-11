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
  // Starting the run moves focus to its heading; take the slider only after that, so End isn't lost.
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeFocused();
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

test("the TCP scene names layers without nonstandard numbers, uses port 80 for HTTP and says NAT is not shown", async ({ page }) => {
  await page.goto("/missions/tcp-lost-segment");
  await page.locator("label.choice", { hasText: "ACK 4501" }).click();
  await page.getByRole("button", { name: "Test prediction" }).click();
  const scene = page.locator(".tcp-scene");
  await expect(scene.locator(".tcp-endpoint.server")).toContainText("203.0.113.10:80");
  await expect(scene.locator(".tcp-endpoint.client .tcp-layer-name b")).toHaveText(["Application", "Transport", "Network", "Link"]);
  await expect(scene).not.toContainText(/\bL[1-4]\b/);
  await expect(scene.locator(".tcp-path")).toContainText("NAT at the client's home router is not shown");
});

test("TCP missions explain their key ideas before the prediction, and say where Kitab's model is simpler", async ({ page }) => {
  await page.goto("/missions/tcp-lost-segment");
  const ideas = page.getByLabel("Key ideas");
  await expect(ideas).toContainText("Key ideas before you predict:");
  for (const term of ["Maximum segment size (MSS)", "Sequence number", "Cumulative acknowledgment", "Duplicate ACK", "Retransmission", "Timeout recovery (Kitab's model)"]) await expect(ideas.getByText(term, { exact: true })).toBeVisible();
  await ideas.getByText("Timeout recovery (Kitab's model)", { exact: true }).click();
  await expect(ideas).toContainText("Kitab's model always waits for the timer");
  // The prediction is still the next thing to do.
  await expect(page.getByRole("button", { name: "Test prediction" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto("/missions/tcp-send-window");
  await expect(page.getByLabel("Key ideas").getByText("Congestion window", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Key ideas").getByText("Duplicate ACK", { exact: true })).toHaveCount(0);

  await page.goto("/practice/missions/missing-segment");
  const brief = page.locator(".mission-brief");
  await expect(brief.getByLabel("Key ideas")).toContainText("Cumulative acknowledgment");
  // Missions outside TCP show none.
  await page.goto("/practice/missions/neighbours");
  await expect(page.getByLabel("Key ideas")).toHaveCount(0);
});
