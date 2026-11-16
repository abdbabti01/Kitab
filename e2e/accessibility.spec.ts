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

test("a lesson's outline opens and jumps from the keyboard; its level is marked, never a control", async ({ page }) => {
  await page.goto("/learn/ip-addressing");
  const outline = page.locator(".lesson-outline");
  await expect(page.locator(".lesson-progress progress")).toHaveAccessibleName(/^Step 1 of \d+$/);
  // The level is plain text with the current one marked: nothing to press, no state to announce.
  await expect(page.locator(".level-scale button")).toHaveCount(0);
  await expect(page.locator('.level-scale li[aria-current="true"]')).toHaveCount(1);
  await outline.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(outline).toHaveAttribute("open", "");
  await expect(outline.getByRole("list", { name: "Chapters" }).locator('[aria-current="step"]')).toHaveCount(1);
  expect(await dangling(page)).toEqual([]);
  // Tab to the third chapter and choose it: the outline closes and the step changes.
  const third = outline.locator(".outline-item").nth(2);
  await third.focus();
  await page.keyboard.press("Enter");
  await expect(outline).not.toHaveAttribute("open", "");
  await expect(outline.locator("summary")).toContainText("Chapter 3 of");
  await expect(page.locator(".lesson-progress-label")).not.toHaveText(/^Step 1 of /);
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
  // Now (the current step) is the first view; Packet and Device are beside it (the steps are in the track).
  await expect(view("Now")).toHaveAttribute("aria-pressed", "true");
  for (const name of ["Packet", "Device"]) await expect(view(name)).toHaveAttribute("aria-pressed", "false");
  await expect(view("Steps")).toHaveCount(0);
  await view("Device").focus();
  await page.keyboard.press("Enter");
  await expect(view("Device")).toHaveAttribute("aria-pressed", "true");
  await expect(view("Now")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".inspector-body")).toContainText("Select a device");
});
