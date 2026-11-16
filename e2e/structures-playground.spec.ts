import { expect, test, type Page } from "@playwright/test";
import { buildDataStructureSimulation } from "../src/visual-engine/data-structures/model.ts";
import { buildRecursionTimeline } from "../src/visual-engine/engines/execution/recursion-engine.ts";

const title = (page: Page) => page.locator("#step-title");
const next = (page: Page) => page.getByRole("button", { name: "Next step" });
const previous = (page: Page) => page.getByRole("button", { name: "Previous step" });
/** Seek to the last step, wherever it is. */
async function toEnd(page: Page) {
  const slider = page.getByRole("slider", { name: "Step" });
  await slider.fill((await slider.getAttribute("max"))!);
}
const storage = (page: Page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));

test("a data-structures lesson opens its experiment already set up, and the Playground leads back", async ({ page }) => {
  await page.goto("/concepts/linked-lists");
  const link = page.locator(".path-playground", { hasText: "Try it in the Playground" }).getByRole("link");
  await link.click();
  await expect(page).toHaveURL(/\/practice\/structures\?structure=linked-list&op=insert&value=5&index=0&from=%2Fconcepts%2Flinked-lists$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Data Structures & Recursion Playground");
  await expect(page.getByRole("button", { name: "Linked list", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Back to your lesson" }).click();
  await expect(page).toHaveURL(/\/concepts\/linked-lists$/);
});

test("Next, Previous and Restart show exactly the engine's step, and the scene follows", async ({ page }) => {
  const frames = buildDataStructureSimulation({ kind: "linked-list", operation: "insert", value: 5, index: 0 }).frames;
  await page.goto("/practice/structures?structure=linked-list&op=insert&value=5&index=0");
  for (let i = 0; i < frames.length; i++) {
    await expect(title(page)).toHaveText(frames[i].title);
    if (i < frames.length - 1) await next(page).click();
  }
  await expect(next(page)).toBeDisabled();
  // HEAD now points at the new node; one step back it still points at the old first node.
  await expect(page.locator(".ds-scene")).toContainText("HEAD → 0x1FF0");
  await previous(page).click();
  await expect(title(page)).toHaveText(frames.at(-2)!.title);
  await expect(page.locator(".ds-scene")).toContainText("HEAD → 0x1010");
  await expect(page.locator(".ds-detached")).toContainText("Not reachable from HEAD");
  await page.getByRole("button", { name: "Restart run" }).click();
  await expect(title(page)).toHaveText(frames[0].title);
  await expect(page.locator(".ds-detached")).toHaveCount(0);
});

test("Play runs to the end on its own and stops there", async ({ page }) => {
  const frames = buildDataStructureSimulation({ kind: "array", operation: "insert", value: 7, index: 2 }).frames;
  await page.goto("/practice/structures?structure=array&op=insert&value=7&index=2");
  await page.getByLabel("Speed").selectOption("2");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.locator(".playback")).toHaveClass(/state-complete/, { timeout: 15_000 });
  await expect(title(page)).toHaveText(frames.at(-1)!.title);
  await expect(page.locator(".sp-result")).toContainText("Inserted 7 at index 2");
});

test("recursion: frames push to the limit and overflow without a base case; the timeline lists every event", async ({ page }) => {
  const timeline = buildRecursionTimeline({ fn: "factorial", n: 3, baseCase: false, stackLimit: 6 });
  await page.goto("/practice/structures?structure=recursion&fn=factorial&n=3&base=0&limit=6");
  await expect(page.locator(".rec-timeline li")).toHaveCount(timeline.events.length);
  const overflowAt = timeline.events.findIndex((e) => e.kind === "overflow");
  await page.getByRole("slider", { name: "Step" }).fill(String(overflowAt));
  await expect(title(page)).toHaveText("Stack overflow");
  await expect(page.locator(".rec-meter")).toHaveAttribute("aria-label", "6 of 6 frames used");
  await expect(page.locator(".rec-frames li")).toHaveCount(7);
  // Turning the base case on changes the run: it now returns 6.
  await page.getByLabel(/Base case/).check();
  await expect(page).toHaveURL(/base=1/);
  await toEnd(page);
  await expect(page.locator(".sp-result")).toContainText("6");
});

test("starting values can be edited, and a result becomes the next operation's start", async ({ page }) => {
  await page.goto("/practice/structures?structure=array&op=insert&value=4&index=0");
  await page.getByLabel("Starting values").fill("");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/values=&|values=$/);
  await expect(page.locator(".ds-array li")).toHaveCount(0);
  await toEnd(page);
  await page.getByRole("button", { name: "Start the next operation from this result" }).click();
  await expect(page.getByLabel("Starting values")).toHaveValue("4");
  await page.getByLabel("Starting values").fill("1, x");
  await expect(page.getByLabel("Starting values")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
});

test("an index outside the array is refused and nothing is written", async ({ page }) => {
  await page.goto("/practice/structures?structure=array&op=delete&index=9");
  await toEnd(page);
  await expect(title(page)).toHaveText("Index out of range");
  await expect(page.locator(".scene-chips")).toContainText("Writes0");
});

test("visiting and using the Playground records no progress", async ({ page }) => {
  await page.goto("/learn/data-structures");
  const before = await storage(page);
  await page.goto("/practice/structures?structure=hash-table&op=insert&value=22");
  await toEnd(page);
  await page.getByRole("button", { name: "Stack", exact: true }).click();
  await page.goto("/learn/data-structures");
  expect(await storage(page)).toBe(before);
  await expect(page.locator(".track-meter")).toContainText("0 of 9");
});
