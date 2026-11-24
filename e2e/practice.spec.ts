import { expect, test, type Page } from "@playwright/test";
import { findMission } from "../src/learning/missions/catalog.ts";

async function seed(page: Page, items: Record<string, unknown>) {
  await page.goto("/nothing-here");
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, items);
}
const filter = (page: Page, name: RegExp) => page.getByRole("group", { name: "Show missions by state" }).getByRole("button", { name });
const hash = findMission("ds-hash-insert")!;
const window_ = findMission("tcp-send-window")!;

test("every mission is on one page, grouped by track and unit, with the lesson to learn first", async ({ page }) => {
  await seed(page, {});
  await page.goto("/practice");
  await expect(page).toHaveTitle("Practice · Kitab");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Missions");
  // 26 missions and challenges, the 13 System Design labs and the 13 Identity challenges.
  await expect(page.locator(".practice-card")).toHaveCount(52);
  await expect(page.locator(".practice-track > h2")).toHaveText(["Networking", "Data structures & recursion", "System design & architecture", "Identity, authentication & security"]);
  const unit3 = page.locator(".practice-unit", { has: page.getByRole("heading", { name: "Unit 3 · IPv4 addresses and subnets" }) });
  await expect(unit3.getByRole("link", { name: "Understanding IPv4 addresses and subnets" })).toHaveAttribute("href", "/learn/ipv4-subnets");
  await expect(unit3.getByRole("link", { name: "Unit on the roadmap" })).toHaveAttribute("href", "/learn#unit-addresses");
  await expect(page.getByRole("link", { name: /Explore subnets/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("filters show missions by recorded state and by track, kept in the address", async ({ page }) => {
  await seed(page, {
    "kitab.progress.v1": {
      version: 1,
      missions: {
        // Mastered.
        [hash.id]: { missionVersion: hash.version, visits: 1, lastVisitedAt: "2026-11-02T00:00:00.000Z", masteredAt: "2026-11-02T00:00:00.000Z", current: null, attempts: [] },
        // Only opened: still to do, never "in progress".
        [window_.id]: { missionVersion: window_.version, visits: 1, lastVisitedAt: "2026-11-03T00:00:00.000Z", masteredAt: null, current: null, attempts: [] },
      },
    },
    "kitab.network-missions.v1": { version: 1, missions: { neighbours: { missionVersion: "1.0.0", attempts: [{ variant: "pc-mask", startedAt: "2026-11-04T00:00:00.000Z", completedAt: null, diagnosis: null, evidence: false, explanation: null, prediction: null, hints: 0 }], completedAt: null, masteredAt: null } } },
  });
  await page.goto("/practice");
  await expect(filter(page, /^Mastered/)).toContainText("1");
  await filter(page, /^Mastered/).click();
  await expect(filter(page, /^Mastered/)).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(/\/practice\?status=mastered$/);
  await expect(page.locator(".practice-card b")).toHaveText([hash.title]);
  await filter(page, /^In progress/).click();
  await expect(page.locator(".practice-card b")).toHaveText(["Neighbours that look remote"]);
  await filter(page, /^Not started/).click();
  await expect(page.locator(".practice-card", { hasText: window_.title }).locator(".status-chip")).toHaveText("Opened");
  await expect(page.locator(".practice-card")).toHaveCount(50);

  await page.getByRole("group", { name: "Show missions by track" }).getByRole("button", { name: "Data structures & recursion" }).click();
  await expect(page).toHaveURL(/status=to-do&track=data-structures$/);
  await expect(page.locator(".practice-card")).toHaveCount(7);
  await page.reload();
  await expect(page.locator(".practice-card")).toHaveCount(7);

  // An empty result says so and offers the way back.
  await filter(page, /^In progress/).click();
  await expect(page.locator(".empty")).toContainText("No mission is in progress yet in this track");
  await page.getByRole("button", { name: "Show all missions" }).click();
  await expect(page.locator(".practice-card")).toHaveCount(8);
});

test("filters work with the keyboard and announce how many missions are shown", async ({ page }) => {
  await seed(page, {});
  await page.goto("/practice");
  await filter(page, /^Mastered/).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[role=status]").filter({ hasText: "missions shown" })).toHaveText("0 of 52 missions shown");
});
