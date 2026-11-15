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

test("the Library lists every reading by where it is used, and one search finds lessons, readings and missions", async ({ page }) => {
  await seed(page, {});
  await page.goto("/learn/library");
  await expect(page).toHaveTitle("Library · Learn · Kitab");
  const inTracks = page.locator("section", { has: page.getByRole("heading", { name: "Readings in the tracks" }) });
  await expect(inTracks.locator(".concept-list a")).toHaveCount(7);
  await expect(inTracks.getByRole("link", { name: /DNS resolution/ })).toContainText("Networking · Unit 5");
  await expect(inTracks.getByRole("link", { name: /Hash tables/ })).toContainText("Data structures & recursion · Unit 3");
  const more = page.locator("section", { has: page.getByRole("heading", { name: "More readings" }) });
  await expect(more.locator(".concept-list a")).toHaveCount(6);

  await page.getByRole("searchbox").fill("subnet");
  await expect(page.getByRole("heading", { name: "Results for “subnet”" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Understanding IPv4 addresses and subnets/ })).toContainText("Lesson · Networking · Unit 3");
  await expect(page.getByRole("link", { name: /Same subnet or not\?/ })).toContainText("Predict");
  await expect(page.getByRole("link", { name: /^Explore subnets/ })).toContainText("Explore");
  await page.getByRole("searchbox").fill("message queue");
  await expect(page.getByRole("link", { name: /Message queues/ })).toBeVisible();
});

test("a reading outside the tracks ends in the Library; one in a track continues the track", async ({ page }) => {
  await seed(page, {});
  await page.goto("/concepts/message-queues");
  await expect(page.getByRole("navigation", { name: "Where you are" })).toContainText("Learn›Library›Message queues");
  const end = page.getByRole("navigation", { name: "Next step" });
  await expect(end.getByRole("link", { name: /Back to the Library/ })).toHaveAttribute("href", "/learn/library");
  await expect(end).toContainText("More readings:");
  await page.goto("/concepts/hash-tables");
  await expect(page.getByRole("navigation", { name: "Where you are" })).toContainText("Unit 3: Hash tables");
  await expect(page.getByRole("navigation", { name: "Next step" }).getByRole("link", { name: /Next: Collisions in a hash table/ })).toBeVisible();
});
