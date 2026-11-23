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
  // The lesson's own Explore link opens its demonstration's setup; the end of the page doesn't repeat it.
  await expect(page.locator(".path-playground")).toHaveCount(0);
  const link = page.locator(".demo-explore").getByRole("link", { name: "Explore this in the Playground" });
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

// Window widths, and browser zoom as Chrome applies it: a CSS viewport of window ÷ zoom at a matching pixel ratio.
const sizes = [
  { name: "desktop 1440", width: 1440, scale: 1 },
  { name: "laptop 1280", width: 1280, scale: 1 },
  { name: "laptop 1024", width: 1024, scale: 1 },
  { name: "tablet 768", width: 768, scale: 1 },
  { name: "phone 390", width: 390, scale: 3 },
  { name: "phone 320", width: 320, scale: 2 },
  { name: "1440 at 125%", width: 1152, scale: 1.25 },
  { name: "1440 at 150%", width: 960, scale: 1.5 },
  { name: "1280 at 200%", width: 640, scale: 2 },
];

test("the complexity table stays inside the explanation panel and scrolls on its own to its last column", async ({ browser, baseURL }, info) => {
  test.skip(info.project.name !== "desktop-1440", "sets its own viewport and zoom for every size");
  for (const size of sizes) {
    const context = await browser.newContext({ baseURL, viewport: { width: size.width, height: 900 }, deviceScaleFactor: size.scale });
    const page = await context.newPage();
    await page.goto("/practice/structures");
    await page.getByText("Complexity of each structure").click();
    const region = page.getByRole("region", { name: "Complexity of each structure" });
    await expect(region).toBeVisible();
    // A table with a caption and header cells, in a keyboard-reachable scroller.
    await expect(region.locator("table caption")).toHaveText("Typical cost of each operation");
    await expect(region.locator('th[scope="col"]')).toHaveCount(5);
    await expect(region).toHaveAttribute("tabindex", "0");

    const box = (selector: string) => page.locator(selector).first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    const at = `${size.name}`;
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `page scrolls sideways at ${at}`).toBeLessThanOrEqual(0);
    const panel = await box(".sp-explain");
    // The scroller and its neighbours stay within the panel.
    for (const selector of [".table-scroll", ".sp-explain details:first-of-type summary", ".sp-explain details:last-of-type summary", ".complexity-note", ".sp-limits"]) {
      const b = await box(selector);
      expect(b.left, `${selector} starts before the panel at ${at}`).toBeGreaterThanOrEqual(panel.left - 0.5);
      expect(b.right, `${selector} ends past the panel at ${at}`).toBeLessThanOrEqual(panel.right + 0.5);
    }

    // The last column is reachable from the keyboard alone, then fully readable inside the scroller.
    const overflowing = await region.evaluate((el) => el.scrollWidth > el.clientWidth);
    if (overflowing) {
      await region.focus();
      await expect.poll(async () => {
        await page.keyboard.press("ArrowRight");
        return region.evaluate((el) => Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth);
      }, { message: `keyboard reaches the end of the table at ${at}` }).toBe(true);
    }
    const scroller = await box(".table-scroll");
    for (const cell of ["table.complexity thead th:last-child", "table.complexity tbody tr:last-child td:last-child"]) {
      const b = await box(cell);
      expect(b.left, `last column hidden at ${at}`).toBeGreaterThanOrEqual(scroller.left - 0.5);
      expect(b.right, `last column cut off at ${at}`).toBeLessThanOrEqual(scroller.right + 0.5);
    }
    await expect(page.locator("table.complexity thead th:last-child")).toHaveText("Remove");
    await expect(page.locator("table.complexity tbody tr:last-child td:last-child")).toHaveText("Depends");
    await context.close();
  }
});
