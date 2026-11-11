import { expect, test, type Page } from "@playwright/test";

// Accessibility regressions from the networking audit (all four widths).

/** Every aria-controls id that has no element on the page. */
const dangling = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll("[aria-controls]")].flatMap((el) => el.getAttribute("aria-controls")!.split(/\s+/).filter((id) => !document.getElementById(id))));

async function startRun(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/missions/tcp-lost-segment");
  await page.locator("label.choice", { hasText: "ACK 4501" }).click();
  await page.getByRole("button", { name: "Test prediction" }).click();
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeFocused();
}

test("the mission Inspector's tabs only reference the panel that is rendered", async ({ page }) => {
  await page.goto("/missions/tcp-lost-segment");
  const tabs = page.getByRole("tablist", { name: "Inspector views" }).getByRole("tab");
  await tabs.first().focus();
  for (const name of ["State", "Selected", "Changes", "Notes"]) {
    const tab = page.getByRole("tab", { name, exact: true });
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel");
    await expect(tab).toHaveAttribute("aria-controls", (await panel.getAttribute("id"))!);
    await expect(panel).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
    await expect(tabs.and(page.locator("[aria-controls]"))).toHaveCount(1);
    expect(await dangling(page)).toEqual([]);
    await page.keyboard.press("ArrowRight");
  }
  await expect(page.getByRole("tab", { name: "State", exact: true })).toBeFocused();
});

test("lesson level buttons reference the level panel only while it exists", async ({ page }) => {
  await page.goto("/learn/ip-addressing");
  const level = page.locator(".level-button").first();
  await expect(level).toHaveAttribute("aria-expanded", "false");
  expect(await dangling(page)).toEqual([]);
  await level.click();
  await expect(level).toHaveAttribute("aria-expanded", "true");
  await expect(level).toHaveAttribute("aria-controls", "level-panel");
  await expect(page.locator("#level-panel")).toBeVisible();
  expect(await dangling(page)).toEqual([]);
});

for (const key of ["End", "ArrowRight"] as const) {
  test(`ending the run with ${key} on the slider keeps focus there, without scrolling it away`, async ({ page }) => {
    await startRun(page);
    const slider = page.getByRole("slider", { name: "Step" });
    await slider.focus();
    const max = Number(await slider.getAttribute("max"));
    const explain = page.getByRole("heading", { name: "Explain what happened" });
    if (key === "End") await page.keyboard.press("End");
    else for (let i = 0; i <= max && !(await explain.isVisible()); i++) await page.keyboard.press("ArrowRight");
    await expect(explain).toBeVisible();
    await expect(slider).toBeFocused();
    await expect(slider).toHaveValue(String(max));
    // The explain form grows above the scene on narrow layouts; scroll anchoring keeps the slider where it was.
    // Moving focus to the heading used to scroll the phone layout to the top, with the scene off screen.
    await expect(slider).toBeInViewport({ ratio: 1 });
    // The result is still announced, once, by Kitab's live region.
    await expect(page.locator('[aria-live="polite"]', { hasText: "Kitab: The run didn't match your prediction" })).toHaveCount(1);
    // The very next key steps back through the evidence.
    await page.keyboard.press("ArrowLeft");
    await expect(slider).toHaveValue(String(max - 1));
    await expect(page.locator(".scene-step")).toHaveText(`Step ${max} of ${max + 1}`);
  });
}

test("ending the run with Next step (which then disables) still moves focus to the explain heading", async ({ page }) => {
  await startRun(page);
  await page.getByRole("button", { name: "Pause" }).click();
  const slider = page.getByRole("slider", { name: "Step" });
  await slider.fill(String(Number(await slider.getAttribute("max")) - 1));
  const next = page.getByRole("button", { name: "Next step" });
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(next).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Explain what happened" })).toBeFocused();
});

test("the playground inspector says which view is shown", async ({ page }) => {
  await page.goto("/practice/network");
  const view = (name: string) => page.locator(".inspector-tabs").getByRole("button", { name, exact: true });
  await expect(view("Packet")).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Device", "Tables", "Steps"]) await expect(view(name)).toHaveAttribute("aria-pressed", "false");
  await view("Steps").focus();
  await page.keyboard.press("Enter");
  await expect(view("Steps")).toHaveAttribute("aria-pressed", "true");
  await expect(view("Packet")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".inspector-body")).toContainText("No journey yet");
});
