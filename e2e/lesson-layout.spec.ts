import { expect, test, type Page } from "@playwright/test";
import { lessons } from "../src/learning/lessons/catalog.ts";

// Shared lesson layout, for every lesson on every supported width: the step bar never covers content or focus,
// the diagram comes first with its controls attached, and stacked layouts keep the explanation under the diagram.
const stackedWidth = 860;
const next = (page: Page) => page.locator(".lesson-controls .next-button");

async function open(page: Page, id: string) {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/learn/${id}`);
  await expect(page.locator(".stage-scene")).toBeVisible();
}

/**
 * What the step bar covers. Wide layouts: with the step in view, nothing it sits beside. Stacked layouts fix the bar to the
 * bottom, so content below the fold passes under it while scrolling (how tall a diagram renders depends on the platform's
 * fonts); instead, each part of the step is scrolled to its end, as a learner reading down would, and must finish fully
 * above the bar. endCovered() and focusHidden() cover the rest of the page.
 */
function covered(page: Page, stacked: boolean) {
  return page.evaluate((stacked) => {
    const bar = document.querySelector(".lesson-controls")!,
      header = document.querySelector(".site-header")!;
    const parts = [...document.querySelectorAll(".stage-scene, .step-card, .chapter-goal, .key-concept")].filter((el) => !bar.contains(el));
    if (stacked)
      return parts
        .filter((el) => {
          el.scrollIntoView({ block: "end" });
          return el.getBoundingClientRect().bottom > bar.getBoundingClientRect().top + 1;
        })
        .map((el) => el.className);
    window.scrollTo(0, document.querySelector(".stage-head")!.getBoundingClientRect().top + scrollY - header.getBoundingClientRect().height - 8);
    const b = bar.getBoundingClientRect();
    const hits = (r: DOMRect) => r.width > 1 && r.height > 1 && r.bottom > b.top + 1 && r.top < b.bottom - 1 && r.right > b.left && r.left < b.right && r.top < innerHeight;
    return parts.filter((el) => hits(el.getBoundingClientRect())).map((el) => el.className);
  }, stacked);
}
function endCovered(page: Page) {
  return page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const bar = document.querySelector(".lesson-controls")!,
      b = bar.getBoundingClientRect();
    return [...document.querySelectorAll(".lesson-page :is(p, h2, h3, li, summary, a, button, input, select)")]
      .filter((el) => !bar.contains(el) && !(el.closest("details:not([open])") && el.tagName !== "SUMMARY"))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.bottom > b.top + 1 && r.top < b.bottom - 1 && r.right > b.left && r.left < b.right; })
      .map((el) => el.textContent?.trim().slice(0, 40));
  });
}
/** Focuses every control outside the bar, as keyboard navigation would, and lists any left under the bar or header. */
function focusHidden(page: Page) {
  return page.evaluate(async () => {
    const bar = document.querySelector(".lesson-controls")!,
      header = document.querySelector(".site-header")!;
    const items = [...document.querySelectorAll<HTMLElement>(".lesson-page :is(a[href], button:not([disabled]), input, select, summary)")]
      .filter((el) => !bar.contains(el) && el.getBoundingClientRect().width > 1 && !(el.closest("details:not([open])") && el.tagName !== "SUMMARY"));
    const hidden: string[] = [];
    for (const el of items) {
      window.scrollTo(0, 0);
      el.focus();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      if (document.activeElement !== el) continue;
      const r = el.getBoundingClientRect(), b = bar.getBoundingClientRect(), h = header.getBoundingClientRect();
      if ((r.bottom > b.top + 1 && r.top < b.bottom && r.right > b.left && r.left < b.right) || (r.top < h.bottom - 1 && r.bottom > h.top))
        hidden.push((el.textContent || el.getAttribute("aria-label") || el.tagName).trim().slice(0, 40));
    }
    return hidden;
  });
}

for (const lesson of lessons) {
  test(`${lesson.id}: on every step the bar covers nothing, the diagram comes first and the page never scrolls sideways`, async ({ page }) => {
    await open(page, lesson.id);
    const width = page.viewportSize()!.width,
      stacked = width <= stackedWidth;
    for (let step = 0; step < 60; step++) {
      const where = `${lesson.id} step ${step + 1} at ${width}px`;
      expect(await covered(page, stacked), where).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), where).toBeLessThanOrEqual(0);
      // The diagram comes before the term card, and "Change the example" is part of the diagram's card.
      const order = await page.evaluate(() => {
        const top = (sel: string) => document.querySelector(sel)?.getBoundingClientRect().top ?? null;
        return { scene: top(".stage-scene")!, term: top(".key-concept"), text: top(".step-card")!, controlsInScene: Boolean(document.querySelector(".stage-scene .example-controls")) || !document.querySelector(".example-controls") };
      });
      if (order.term !== null) expect(order.term, where).toBeGreaterThan(order.scene);
      expect(order.controlsInScene, where).toBe(true);
      if (stacked) {
        // Under the diagram, before the term card: one copy of the explanation, never two.
        expect(order.text, where).toBeGreaterThan(order.scene);
        if (order.term !== null) expect(order.text, where).toBeLessThan(order.term);
        await expect(page.locator(".step-card")).toHaveCount(1);
        await expect(page.locator(".stage .step-card")).toHaveCount(1);
      } else {
        await expect(page.locator(".explain .step-card")).toHaveCount(1);
      }
      if (await next(page).isDisabled()) break;
      const label = await page.locator(".step-meta").textContent();
      await next(page).click();
      await expect(page.locator(".step-meta")).not.toHaveText(label!);
    }
    expect(await endCovered(page)).toEqual([]);
  });

  test(`${lesson.id}: focus never lands under the step bar or the header, and stays visible`, async ({ page }) => {
    await open(page, lesson.id);
    const stacked = page.viewportSize()!.width <= stackedWidth;
    const bar = page.locator(".lesson-controls");
    expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe(stacked ? "fixed" : "sticky");
    // Wide layouts: the bar is in the explanation column, beside the diagram, and Next is on screen from the start
    // and still on screen after focus moves to the bottom of that column (the follow-up question field).
    const nextOnScreen = () => next(page).evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    if (!stacked) {
      await expect(page.locator(".explain .lesson-controls")).toHaveCount(1);
      expect(await nextOnScreen()).toBe(true);
      await page.locator("#ask-input").focus();
      expect(await nextOnScreen()).toBe(true);
    }
    if (stacked) {
      // The page reserves the fixed bar's measured height.
      const { reserved, height } = await page.evaluate(() => ({
        reserved: parseFloat(getComputedStyle(document.querySelector(".lesson-grid")!).paddingBottom),
        height: document.querySelector(".lesson-controls")!.getBoundingClientRect().height,
      }));
      expect(reserved).toBeGreaterThanOrEqual(height);
    }
    expect(await focusHidden(page)).toEqual([]);
    // Open the example controls, then check again at the last step, where the completion card adds links.
    if (await page.locator(".example-controls summary").count()) await page.locator(".example-controls summary").click();
    expect(await focusHidden(page)).toEqual([]);
    while (!(await next(page).isDisabled())) await next(page).click();
    expect(await focusHidden(page)).toEqual([]);

    // Keyboard: Tab reaches the step bar, its focus ring is visible, and Enter moves the lesson.
    await page.locator(".lesson-controls .button").first().focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const focused = page.locator(".lesson-controls :focus-visible");
    await expect(focused).toHaveCount(1);
    expect(await focused.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  });
}
