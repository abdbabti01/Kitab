import { expect, type Page } from "@playwright/test";

/** A lesson's chapters, as the outline lists them (closed or open). */
export const chapterTitles = (page: Page) => page.locator(".lesson-outline .outline-title");

/** Opens the lesson outline and jumps to a chapter, the way a learner does. */
export async function goToChapter(page: Page, chapter: string | RegExp | "last") {
  const outline = page.locator(".lesson-outline");
  if (!(await outline.evaluate((el) => (el as HTMLDetailsElement).open))) await outline.locator("summary").click();
  const item = chapter === "last" ? outline.locator(".outline-item").last() : outline.locator(".outline-item", { hasText: chapter });
  await item.click();
  await expect(outline).not.toHaveAttribute("open", "");
}

/** The lesson's one progress indicator, "Step n of m". */
export const lessonProgress = (page: Page) => page.locator(".lesson-top .lesson-progress-label");

/** The optional AI question box, opened first: it is folded until a learner asks for it. */
export async function askInput(page: Page) {
  const ask = page.locator(".ask-details");
  if (!(await ask.evaluate((el) => (el as HTMLDetailsElement).open))) await ask.locator("summary").click();
  return page.getByLabel(/Ask a follow-up question/);
}
