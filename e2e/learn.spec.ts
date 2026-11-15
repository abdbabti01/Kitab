import { expect, test, type Page } from "@playwright/test";
import { findLesson } from "../src/learning/lessons/catalog.ts";

const subnets = findLesson("ipv4-subnets")!;
const unit = (page: Page, title: string) => page.locator(".path-stages details", { has: page.locator("summary", { hasText: title }) });

async function seed(page: Page, items: Record<string, unknown>) {
  await page.goto("/nothing-here");
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, items);
}

test("a first-time learner sees the networking roadmap with Unit 1 open and one clear start", async ({ page }) => {
  await seed(page, {});
  await page.goto("/learn");
  await expect(page).toHaveTitle("Networking · Learn · Kitab");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Networking");
  await expect(page.getByRole("navigation", { name: "Tracks and Library" }).getByRole("link", { name: "Networking" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".path-stages details[open]")).toHaveCount(1);
  await expect(unit(page, "Your home connection")).toHaveAttribute("open", "");
  await expect(unit(page, "Your home connection")).toContainText("You'll understand:");
  await expect(page.locator(".track-roadmap .path-head .button.primary")).toHaveText(/Start: How your home connects/);
  await expect(page.locator(".track-meter")).toContainText("0 of 14 lessons and missions completed");
  // Explorations say they are not scored and carry no status until opened.
  const explorer = page.locator(".path-activity", { hasText: "How your home connects" });
  await expect(explorer).toContainText("not scored");
  await expect(explorer.locator(".status-chip")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a learner part-way through IPv4 Lesson 1 sees that unit open, the lesson marked in progress and next", async ({ page }) => {
  await seed(page, {
    "kitab.learning.v1": { version: 1, lessons: { [subnets.id]: { lessonVersion: subnets.version, visits: 2, lastVisitedAt: "2026-11-12T09:00:00.000Z", seen: ["a", "b", "c", "d", "e"], total: 13, chaptersSeen: [], completedAt: null, experimentsCompleted: [], position: null, updated: false } } },
  });
  await page.goto("/learn");
  await expect(unit(page, "IPv4 addresses and subnets")).toHaveAttribute("open", "");
  await expect(unit(page, "Your home connection")).not.toHaveAttribute("open", "");
  const lesson = page.locator(".path-activity", { hasText: subnets.title });
  await expect(lesson).toHaveAttribute("aria-current", "step");
  await expect(lesson.locator(".status-chip")).toHaveText("In progress");
  await expect(page.locator(".track-roadmap .path-head .button.primary")).toHaveText(new RegExp(`Continue: ${subnets.title}`));
});

test("a unit link opens that unit; the data-structures track and the Library are tabs of Learn", async ({ page }) => {
  await seed(page, {});
  await page.goto("/learn#unit-routing");
  await expect(unit(page, "Gateways, routing and NAT")).toHaveAttribute("open", "");
  await expect(unit(page, "Gateways, routing and NAT")).toBeInViewport();
  await expect(unit(page, "Gateways, routing and NAT").locator(".unit-playground")).toContainText("Two connected LANs");

  await page.getByRole("link", { name: "Data structures & recursion" }).click();
  await expect(page).toHaveURL(/\/learn\/data-structures$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Data structures & recursion");
  await expect(page.locator(".path-stages > li")).toHaveCount(6);
  await expect(unit(page, "Arrays and memory")).toHaveAttribute("open", "");
  await expect(page.locator(".track-roadmap .path-head .button.primary")).toHaveText(/Start: Make room in an array/);
  // No Playground suggestion in a track the network simulator does not cover.
  await expect(page.locator(".unit-playground")).toHaveCount(0);

  await page.getByRole("link", { name: "Library" }).click();
  await expect(page).toHaveURL(/\/learn\/library$/);
  await expect(page.getByRole("link", { name: /Message queues/ })).toBeVisible();
});

test("units open with the keyboard, and Tab reaches their steps in order", async ({ page }) => {
  await seed(page, {});
  await page.goto("/learn");
  const summary = unit(page, "Across the Internet").locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(unit(page, "Across the Internet")).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(page.locator(".path-activity", { hasText: "DNS resolution" })).toBeFocused();
});
