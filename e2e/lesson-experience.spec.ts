import { expect, test, type Page } from "@playwright/test";
import "../src/learning/engines/index.ts";
import { findLesson, lessons } from "../src/learning/lessons/catalog.ts";
import { resolveTrack } from "../src/learning/lessons/runtime.ts";
import { locate } from "../src/learning/tracks.ts";
import { goToChapter, lessonProgress } from "./lesson.ts";

// One learning journey, one primary progression control, contextual tools only when needed: the same contract for
// every lesson, checked as a learner meets it.
const lesson = findLesson("array-insert")!;
const track = resolveTrack(lesson, {});
const title = (page: Page) => page.locator("#step-title");
const next = (page: Page) => page.locator(".lesson-controls .next-button");
const learning = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("kitab.learning.v1") ?? "null"));
const record = (page: Page) => learning(page).then((value) => value?.lessons?.["array-insert"]);

async function seed(page: Page, items: Record<string, unknown>) {
  await page.goto("/nothing-here");
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, items);
}

/** A record exactly as the lesson saved it before the redesign: the format is unchanged, so this is real old data. */
const saved = (stepId: string, chapters: string[], completedAt: string | null = null) => ({
  "kitab.learning.v1": {
    version: 1,
    lessons: {
      "array-insert": {
        lessonVersion: lesson.version,
        visits: 3,
        lastVisitedAt: "2026-10-02T09:00:00.000Z",
        seen: track.steps.filter((step) => chapters.includes(step.chapterId)).map((step) => step.id),
        total: track.steps.length,
        chaptersSeen: chapters,
        completedAt,
        experimentsCompleted: [],
        position: { params: {}, track: "journey", stepId, journeyStepId: stepId },
        updated: false,
      },
    },
  },
});

for (const item of lessons) {
  test(`${item.id}: one progression system — one Next, one progress indicator, no competing steppers`, async ({ page }) => {
    await seed(page, {});
    await page.goto(`/learn/${item.id}`);
    await expect(title(page)).toBeVisible();
    await expect(page.locator("#main h1")).toHaveText(item.title);
    const steps = resolveTrack(item, {}).steps.length;
    await expect(lessonProgress(page)).toHaveText(`Step 1 of ${steps}`);
    // Exactly one control moves through the lesson, and nothing else on the page says "Next".
    await expect(page.locator(".lesson-controls")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Next/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /^Next/ })).toHaveCount(0);
    await expect(page.locator(".lesson-progress")).toHaveCount(1);
    // The old competing navigation is gone: chapters are an outline, levels a marker.
    await expect(page.locator(".chapter-strip, .level-rail, .level-panel")).toHaveCount(0);
    await expect(page.locator(".level-scale button")).toHaveCount(0);
    // In a track, the course location is track › unit › this lesson: context, with no Next of its own.
    const where = page.getByRole("navigation", { name: "Where you are" });
    if (locate(item.id)) {
      await expect(where.locator('[aria-current="page"]')).toHaveText(locate(item.id)!.activity.title);
      await expect(where.getByRole("link", { name: /Next|Previous/ })).toHaveCount(0);
    } else {
      await expect(where).toHaveCount(0);
    }
  });
}

test("a learner resumes old saved progress mid-chapter, with seen chapters marked and nothing completed or rewritten", async ({ page }) => {
  const at = track.steps[6];
  await seed(page, saved(at.id, ["values", "memory", "insert"]));
  await page.goto("/learn/array-insert");
  await expect(title(page)).toHaveText(at.title);
  await expect(lessonProgress(page)).toHaveText(`Step 7 of ${track.steps.length}`);
  await expect(page.locator(".lesson-outline summary")).toContainText("Chapter 3 of 4: Insert 9 at index 1");
  const items = page.locator(".lesson-outline .outline-item");
  await expect(items.nth(0)).toHaveClass(/is-done/);
  await expect(items.nth(1)).toHaveClass(/is-done/);
  await expect(items.nth(2)).toHaveAttribute("aria-current", "step");
  await expect(items.nth(3)).toHaveClass(/is-todo/);
  const after = await record(page);
  expect(after.completedAt).toBeNull();
  expect(after.chaptersSeen).toEqual(["values", "memory", "insert"]);
  expect(after.seen).toEqual(expect.arrayContaining(saved(at.id, ["values", "memory", "insert"])["kitab.learning.v1"].lessons["array-insert"].seen));
  expect(after.visits).toBe(4);
});

test("a completed lesson keeps its completion date and its place", async ({ page }) => {
  const done = "2026-09-30T18:45:00.000Z";
  await seed(page, saved(track.steps[2].id, ["values", "memory", "insert", "result"], done));
  await page.goto("/learn/array-insert");
  await expect(title(page)).toHaveText(track.steps[2].title);
  await next(page).click();
  await expect((await record(page)).completedAt).toBe(done);
  await page.goto("/learn/data-structures");
  await expect(page.locator(".path-activity", { hasText: "Make room in an array" }).first().locator(".status-chip")).toHaveText("Completed");
});

test("opening the outline, the levels or the AI help changes neither the step nor progress, and never completes", async ({ page }) => {
  await seed(page, {});
  await page.goto("/learn/array-insert");
  await next(page).click();
  const here = await title(page).textContent();
  await page.locator(".lesson-outline summary").click();
  await page.locator(".lesson-outline summary").click();
  await page.locator(".lesson-levels summary").click();
  await page.locator(".ask-details summary").click();
  await page.locator(".example-controls summary").click();
  await expect(title(page)).toHaveText(here!);
  const after = await record(page);
  expect(after.completedAt).toBeNull();
  expect(after.seen).toEqual(track.steps.slice(0, 2).map((step) => step.id));
  // Jumping to the last chapter is not finishing: completion needs every chapter seen.
  await goToChapter(page, "What it cost");
  expect((await record(page)).completedAt).toBeNull();
  await expect(page.locator(".completion")).toContainText("Lesson not complete yet");
  // A lesson never writes mission practice or mastery.
  expect(await page.evaluate(() => localStorage.getItem("kitab.progress.v1"))).toBeNull();
});

test("Next walks to the end; the end offers the next activity and the Playground, which leads back to this place", async ({ page }) => {
  await seed(page, {});
  await page.goto("/learn/array-insert");
  for (let index = 1; index < track.steps.length; index += 1) await next(page).click();
  await expect(lessonProgress(page)).toHaveText(`Step ${track.steps.length} of ${track.steps.length}`);
  await expect(next(page)).toBeDisabled();
  const completion = page.locator(".completion");
  await expect(completion).toContainText("Lesson completed");
  await expect(completion).toContainText("Mastery not shown yet");
  // The experiment opens set up, and the Playground returns to the same step of the lesson.
  await completion.locator(".path-playground a").click();
  await expect(page).toHaveURL(/\/practice\/structures\?structure=array.*from=%2Flearn%2Farray-insert$/);
  await page.getByRole("link", { name: "Back to your lesson" }).click();
  await expect(page).toHaveURL(/\/learn\/array-insert$/);
  await expect(title(page)).toHaveText(track.steps.at(-1)!.title);
  // The one way forward from a finished lesson: the unit's next activity.
  const following = locate("array-insert")!.next!;
  await completion.getByRole("navigation", { name: "Next step" }).getByRole("link", { name: `Next: ${following.title}` }).click();
  await expect(page).toHaveURL(new RegExp(`${following.path}$`));
});

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`at ${width}px the lesson fits, the step control stays reachable and the outline opens`, async ({ page }) => {
    await page.setViewportSize({ width, height: width > 500 ? 900 : 760 });
    await seed(page, {});
    await page.goto("/learn/ipv4-subnets");
    await expect(title(page)).toBeVisible();
    for (let step = 0; step < 4; step += 1) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `page scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
      await expect(next(page)).toBeInViewport();
      await next(page).click();
    }
    await page.locator(".lesson-outline summary").click();
    const last = page.locator(".lesson-outline .outline-item").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}
