import { expect, test, type Page, type Route } from "@playwright/test";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { findMission } from "../src/learning/missions/catalog.ts";

// Lesson 2's engine and scene (with the lab simulator) load only on its own page; every other lesson renders at once.
// Its engine and scene modules (dev paths and built chunks); not the lesson's text, which ships in the catalog.
const lesson2 = /engines\/local-delivery\.ts|scenes\/(LocalDelivery|local-delivery)|assets\/(local-delivery|LocalDelivery)[^/]*\.(js|css)/;
const subnets = findLesson("ipv4-subnets")!;

async function watch(page: Page) {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (lesson2.test(request.url())) requested.push(request.url());
  });
  // Records whether the on-demand loading state ever appears, however briefly.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (document.querySelector(".lesson-loading")) (window as unknown as { sawLoading: boolean }).sawLoading = true;
    }).observe(document, { childList: true, subtree: true });
  });
  return requested;
}

test("existing lessons and missions render with no new loading state and never fetch Lesson 2's code", async ({ page }) => {
  const requested = await watch(page);
  await page.goto("/learn/ipv4-subnets");
  await expect(page.locator("#step-title")).toBeVisible();
  await page.goto("/learn/array-insert");
  await expect(page.locator("#step-title")).toBeVisible();
  await page.goto(`/missions/${findMission("tcp-lost-segment")!.id}`);
  await expect(page.locator("main")).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => (window as unknown as { sawLoading?: boolean }).sawLoading ?? false)).toBe(false);
  expect(requested).toEqual([]);
});

test("Lesson 2 loads its engine on demand, then renders its first step", async ({ page }) => {
  const requested = await watch(page);
  await page.goto("/learn/local-delivery-routing");
  await expect(page.locator("#step-title")).toBeVisible();
  await expect(page.locator(".ld-scene")).toBeVisible();
  await expect(page.locator(".lesson-loading")).toHaveCount(0);
  expect(requested.length).toBeGreaterThan(0);
});

test("a failed download shows an accessible error, and Try again recovers", async ({ page }) => {
  await page.route(lesson2, (route) => route.abort());
  await page.goto("/learn/local-delivery-routing");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Local delivery, gateways and routing couldn't load");
  await expect(alert).toContainText("Your saved progress is unchanged.");
  await page.unroute(lesson2);
  const retry = page.getByRole("button", { name: "Try again" });
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".ld-scene")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("leaving Lesson 2 while it loads keeps the next page: the late result is ignored", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const held: Route[] = [];
  let release = false;
  await page.route(lesson2, (route) => (release ? route.continue() : void held.push(route)));
  await page.goto("/learn/local-delivery-routing");
  await expect(page.locator(".lesson-loading")).toBeVisible();
  await expect.poll(() => held.length).toBeGreaterThan(0);
  await page.evaluate(() => {
    history.pushState(null, "", "/learn/ipv4-subnets");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveTitle(`${subnets.title} · Kitab`);
  release = true;
  for (const route of held) await route.continue();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  await expect(page).toHaveTitle(`${subnets.title} · Kitab`);
  await expect(page.locator(".ld-scene, .lesson-loading, .lesson-load-failed")).toHaveCount(0);
  await expect(page.locator("#step-title")).toBeVisible();
  expect(errors).toEqual([]);
});
