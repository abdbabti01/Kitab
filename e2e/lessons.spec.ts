import { expect, test, type Page } from "@playwright/test";
import "../src/learning/engines/index.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { resolveTrack } from "../src/learning/lessons/runtime.ts";
import { askInput, goToChapter, lessonProgress } from "./lesson.ts";

const lesson = findLesson("array-insert")!;
const track = resolveTrack(lesson, {});
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error.message));
  page.on("console", (message) => {
    // The plain dev server has no Worker, so /api calls fail by design.
    if (message.type() === "error" && !/Failed to load resource|\/api\//.test(message.text())) list.push(message.text());
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), "console/page errors").toEqual([]);
});

const title = (page: Page) => page.locator("#step-title");
const next = (page: Page) => page.locator(".lesson-controls .next-button");

async function open(page: Page) {
  await page.goto("/learn/array-insert");
  await expect(title(page)).toBeVisible();
}

test("the array walkthrough controls fit this screen and reach the final step", async ({ page }) => {
  await open(page);
  const box = await next(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await goToChapter(page, "What it cost");
  await expect(title(page)).toHaveText(track.steps.at(-1)!.title);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("one sequence: Previous and Next walk every step in order, and the level only marks where each step happens", async ({ page }) => {
  await open(page);
  // The level is an indicator: the lesson's levels, the current step's marked, and nothing to press.
  const scale = page.locator(".step-who .level-scale");
  await expect(scale.locator("li")).toHaveText(lesson.levels.map((level) => level.name));
  await expect(scale.locator("button, a")).toHaveCount(0);
  for (const [index, step] of track.steps.entries()) {
    await expect(title(page)).toHaveText(step.title);
    await expect(lessonProgress(page)).toHaveText(`Step ${index + 1} of ${track.steps.length}`);
    await expect(scale.locator('li[aria-current="true"]')).toHaveText(lesson.levels.find((level) => level.id === step.level)!.name);
    if (index < track.steps.length - 1) await next(page).click();
  }
  await expect(next(page)).toBeDisabled();
  for (let index = track.steps.length - 1; index > 0; index -= 1) await page.getByRole("button", { name: "Previous" }).click();
  await expect(title(page)).toHaveText(track.steps[0].title);
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  // Every level's introduction is still in the lesson, as reference.
  await page.locator(".lesson-levels summary").click();
  await expect(page.locator(".lesson-levels")).toContainText("fixed-size slot");
  // Exactly one step control and one progress indicator on the page.
  await expect(page.locator(".lesson-controls")).toHaveCount(1);
  await expect(page.locator(".lesson-progress")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Next/ })).toHaveCount(1);
});

test("Back, Replay and rapid keyboard input stay consistent; refresh restores the place", async ({ page }, info) => {
  test.skip(info.project.name === "phone-390", "Arrow-key shortcuts are a desktop/keyboard feature.");
  await open(page);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  for (let index = 0; index < 7; index += 1) await page.keyboard.press("ArrowRight");
  await expect(lessonProgress(page)).toHaveText(`Step 8 of ${track.steps.length}`);
  await page.keyboard.press("ArrowLeft");
  await expect(lessonProgress(page)).toHaveText(`Step 7 of ${track.steps.length}`);
  const here = await title(page).textContent();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator(".replay-tag")).toContainText("Before:");
  await expect(page.locator(".replay-tag")).toHaveCount(0);
  await expect(title(page)).toHaveText(here!);
  await page.reload();
  await expect(title(page)).toHaveText(here!);
  await expect(lessonProgress(page)).toHaveText(`Step 7 of ${track.steps.length}`);
});

test("finishing the array walkthrough records progress and links to practice", async ({ page }) => {
  await open(page);
  for (const chapter of ["Stored side by side", "Insert 9 at index 1", "What it cost"]) {
    await goToChapter(page, chapter);
  }
  await expect(page.locator(".completion")).toContainText("Lesson completed");
  await expect(page.locator(".completion")).toContainText("Mastery not shown yet");
  for (const { missionId } of lesson.practice) {
    await expect(page.locator(`.completion .practice-list a[href="/missions/${missionId}"]`)).toBeVisible();
  }
  await page.goto("/learn/data-structures");
  await expect(page.locator(".path-activity", { hasText: "Make room in an array" }).first().locator(".status-chip")).toHaveText("Completed");
  await expect(page.locator(".path-activity", { hasText: "Make room in an array" }).nth(1).locator(".status-chip")).toHaveText("Not started");
});

test("the array walkthrough uses the same runtime and recomputes the shifts for a new position", async ({ page }) => {
  await open(page);
  await expect(page.locator(".level-scale li")).toHaveText(["Program", "Array", "Memory"]);
  await page.locator(".example-controls summary").click();
  await page.getByText("Index 3", { exact: true }).click();
  await goToChapter(page, "What it cost");
  await expect(page.locator(".step-what")).toContainText("2 values moved one slot right, then one write placed 9");
  await expect(page.locator(".step-what")).toContainText("8, 3, 12, 9, 1, 6");
});

test("changing the example during a replay shows the new example's step, not a frame of the old trace", async ({ page }) => {
  // Reduced motion keeps the replay on screen long enough to change the example mid-replay.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.locator(".example-controls summary").click();
  while (!/now holds 9/.test(await page.locator(".step-what").innerText())) await next(page).click();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator(".replay-tag")).toBeVisible();
  await page.getByText("Index 3", { exact: true }).click();
  await expect(page.locator(".replay-tag")).toHaveCount(0);
  await expect(title(page)).toHaveText("The request: insert 9 at index 3");
  await expect(page.locator(".stage-scene")).toBeVisible();
});

test("the example controls never widen the page: hidden radio buttons stay 1 px", async ({ page }) => {
  await open(page);
  await page.locator(".example-controls summary").click();
  const sizes = await page.locator('.example-controls input[type="radio"]').evaluateAll((inputs) => inputs.map((input) => input.getBoundingClientRect().width));
  expect(sizes.length).toBeGreaterThan(0);
  for (const width of sizes) expect(width).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
});

test("without AI the follow-up question returns Kitab's reviewed explanation, clearly labelled", async ({ page }) => {
  await open(page);
  await (await askInput(page)).fill("Why do we use arrays?");
  await page.getByRole("button", { name: "Ask Kitab" }).click();
  await expect(page.locator(".tutor-answer")).toContainText("couldn't be reached, so this is the reviewed explanation");
  await expect(page.locator(".tutor-answer")).toContainText("This array holds 5 whole numbers");
});

test("reduced motion: steps change without animation and Replay still shows the before state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  for (let index = 0; index < 6; index += 1) await next(page).click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator(".replay-tag")).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test("keyboard users see focus on the controls and can operate them", async ({ page }, info) => {
  test.skip(info.project.name === "phone-390", "Keyboard check runs on keyboard-sized layouts.");
  await open(page);
  await next(page).focus();
  await page.keyboard.press("Enter");
  await expect(lessonProgress(page)).toHaveText(`Step 2 of ${track.steps.length}`);
  const outline = await next(page).evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});
