import { expect, test, type Page } from "@playwright/test";
import { findLesson } from "../src/learning/lessons/catalog.ts";

const ip = findLesson("ip-addressing")!;
const stage = (page: Page, title: string) => page.locator(".path-stages details", { has: page.locator("summary", { hasText: title }) });

async function seed(page: Page, items: Record<string, unknown>) {
  await page.goto("/");
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, items);
  await page.reload();
}

test("a new learner starts at the beginning; nothing untracked shows progress", async ({ page }) => {
  await seed(page, {});
  const hero = page.locator(".journey-hero").getByRole("link", { name: /Start the networking path/ });
  await expect(hero).toHaveAttribute("href", "/practice/connections");
  await expect(page.locator(".path-stages details[open]")).toHaveCount(1);
  await expect(stage(page, "Your home connection")).toHaveAttribute("open", "");
  await expect(stage(page, "Your home connection").locator("summary")).toContainText("progress not recorded");
  // Untracked activities never carry a status chip; tracked ones start at "Not started".
  await expect(page.locator(".path-activity", { hasText: "How your home connects" }).locator(".status-chip")).toHaveCount(0);
  await expect(page.locator(".path-activity", { hasText: "Your first LAN" }).locator(".status-chip")).toHaveCount(0);
  await expect(page.locator(".path-activity", { hasText: "No connection" }).locator(".status-chip")).toHaveText("Not started");
  await expect(stage(page, "Inside your LAN").locator("summary")).toContainText("0 of 1 completed");
  // Networking cards are not repeated elsewhere on Home.
  await expect(page.locator(".mission-card", { hasText: "The ACK that wouldn't move" })).toHaveCount(0);
  await expect(page.locator(".journey-card", { hasText: "IP Addresses & Subnets" })).toHaveCount(0);
  await hero.click();
  await expect(page).toHaveURL(/\/practice\/connections$/);
});

test("existing progress is shown as recorded, and the path suggests rather than skips untracked steps", async ({ page }) => {
  const lesson = { lessonVersion: ip.version, visits: 1, lastVisitedAt: "t", seen: [], total: 0, chaptersSeen: [], completedAt: "t", experimentsCompleted: [], position: null, updated: false };
  await seed(page, { "kitab.learning.v1": { version: 1, lessons: { [ip.id]: lesson } } });
  // The lesson is done, but the Explorer before it records nothing: it is suggested, not assumed done.
  await expect(page.locator(".journey-hero").getByRole("link", { name: "Suggested next: How your home connects" })).toBeVisible();
  await expect(page.locator(".path-note")).toContainText("this is a suggestion");
  await expect(page.locator(".path-activity", { hasText: "How your home connects" })).toHaveAttribute("aria-current", "step");
  await expect(page.locator(".path-activity", { hasText: "IP Addresses & Subnets" }).locator(".status-chip")).toHaveText("Completed");

  // Earlier challenge completions (legacy store) count as completed, never mastered.
  await seed(page, { "kitab.learning.v1": { version: 1, lessons: { [ip.id]: lesson } }, "kitab.network.challenges.v1": ["cable", "subnet"] });
  await expect(stage(page, "Inside your LAN").locator("summary")).toContainText("1 of 1 completed");
  await expect(stage(page, "Addresses, subnets and routes").locator("summary")).toContainText("2 of 5 completed");
  await expect(page.locator(".path-stages summary", { hasText: "mastered" })).toHaveCount(0);
  // Recorded progress reaches past the starters before Neighbours, so the next unfinished mission is next.
  await expect(page.locator(".journey-hero").getByRole("link", { name: "Next: Join and get an address" })).toBeVisible();
  await expect(page.locator(".path-note")).toHaveCount(0);
  // The starters it passed still show no progress: they are not marked done.
  await expect(page.locator(".path-activity", { hasText: "Two connected LANs" }).locator(".status-chip")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("kitab.network.challenges.v1"))).toBe(JSON.stringify(["cable", "subnet"]));
});

test("stages open and close with the keyboard", async ({ page }) => {
  await seed(page, {});
  const summary = stage(page, "Across the Internet").locator("summary");
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(stage(page, "Across the Internet")).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(page.locator(".path-activity", { hasText: "A request across the Internet" })).toBeFocused();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(stage(page, "Across the Internet")).not.toHaveAttribute("open", "");
});

test("the roadmap fits the screen, and the playground stays one click away with the saved design intact", async ({ page }) => {
  await seed(page, { "kitab.network.workspace.v1": { version: 1, name: "My home lab", devices: [], links: [] } });
  for (const title of ["Inside your LAN", "Addresses, subnets and routes", "Across the Internet"]) await stage(page, title).locator("summary").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Build freely in the playground" }).click();
  await expect(page).toHaveURL(/\/practice\/network$/);
  await expect(page.getByLabel("Network name")).toHaveValue("My home lab");
});

test("a path starter opens as an unsaved copy, an unknown starter opens the learner's own network, and nothing is locked", async ({ page }) => {
  await seed(page, { "kitab.network.workspace.v1": { version: 1, name: "My home lab", devices: [], links: [] } });
  await page.goto("/practice/network?starter=wifi");
  await expect(page.getByLabel("Network name")).toHaveValue("A wireless home");
  await page.getByLabel("Network name").fill("Edited starter");
  await page.getByLabel("Network name").press("Tab");
  await page.reload();
  // A reload reopens the starter; edits to it were never saved over the learner's design.
  await expect(page.getByLabel("Network name")).toHaveValue("A wireless home");
  expect(await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"))).toContain("My home lab");
  await page.goto("/practice/network?starter=not-a-starter");
  await expect(page.getByLabel("Network name")).toHaveValue("My home lab");
  await expect(page.getByRole("navigation", { name: "Networking path" })).toHaveCount(0);

  // Advanced activities open directly, with their prerequisites as suggestions only.
  await page.goto("/practice/missions/missing-segment");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A segment goes missing");
  await expect(page.locator(".path-needs")).toContainText("Before you start: The ACK that wouldn't move");
  await page.goto("/missions/tcp-lab");
  await expect(page.locator(".path-needs")).toContainText("Before you start: The ACK that wouldn't move, How full can the pipe get?");
});
