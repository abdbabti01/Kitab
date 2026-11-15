import { expect, test, type Page } from "@playwright/test";
import { findMission } from "../src/learning/missions/catalog.ts";
import { missions as networkMissions } from "../src/practice/network/missions.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";

async function seed(page: Page, items: Record<string, unknown>) {
  await page.goto("/nothing-here");
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, items);
}
const continueCard = (page: Page) => page.locator(".continue-card");

test("a learner returning mid-lesson continues at the exact step they left", async ({ page }) => {
  await seed(page, {});
  await page.goto("/learn/ipv4-subnets");
  for (let i = 0; i < 4; i++) await page.locator(".lesson-controls .next-button").click();
  const step = (await page.locator(".step-title").textContent())!;
  // Then a TCP mission is only opened, never attempted.
  await page.goto("/missions/tcp-send-window");
  await expect(page.locator("#main h1")).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Continue where you left off");
  await expect(continueCard(page).getByRole("heading", { level: 2 })).toHaveText("Understanding IPv4 addresses and subnets");
  await expect(continueCard(page)).toContainText("Networking · Unit 3: IPv4 addresses and subnets · Lesson");
  await expect(continueCard(page)).toContainText("5 of 13 steps seen");
  await expect(page.locator("#main .button.primary")).toHaveCount(1);
  await continueCard(page).getByRole("link", { name: /Continue/ }).click();
  await expect(page).toHaveURL(/\/learn\/ipv4-subnets$/);
  await expect(page.locator(".step-title")).toHaveText(step);
});

test("a learner with an unfinished mission continues it, and the dashboard shows the unit and what is ready to master", async ({ page }) => {
  const done = networkMissions.find((m) => m.id === "no-connection")!;
  await seed(page, {
    "kitab.network-missions.v1": {
      version: 1,
      missions: {
        [done.id]: { missionVersion: done.version, attempts: [], completedAt: "2026-11-10T10:00:00.000Z", masteredAt: null },
        neighbours: { missionVersion: "1.0.0", attempts: [{ variant: "pc-mask", startedAt: "2026-11-12T10:00:00.000Z", completedAt: null, diagnosis: null, evidence: false, explanation: null, prediction: null, hints: 0 }], completedAt: null, masteredAt: null },
      },
    },
  });
  await page.goto("/");
  await expect(continueCard(page).getByRole("heading", { level: 2 })).toHaveText("Neighbours that look remote");
  await expect(continueCard(page)).toContainText("Troubleshoot");
  await expect(continueCard(page).getByRole("link", { name: /Continue/ })).toHaveAttribute("href", "/practice/missions/neighbours");
  await expect(page.locator(".unit-tile.is-current")).toContainText("IPv4 addresses and subnets");
  await expect(page.locator(".dash-card", { hasText: "Ready to master" }).getByRole("link", { name: /No connection/ })).toBeVisible();
  await expect(page.locator(".dash-total")).toContainText("1 of 14 lessons and missions completed");
});

test("a learner who mastered every networking mission is told so, with somewhere to go next", async ({ page }) => {
  const lesson = (id: string) => ({ lessonVersion: findLesson(id)!.version, visits: 1, lastVisitedAt: "2026-11-01T00:00:00.000Z", seen: [], total: 0, chaptersSeen: [], completedAt: "2026-11-01T00:00:00.000Z", experimentsCompleted: [], position: null, updated: false });
  const mastered = (id: string) => ({ missionVersion: findMission(id)!.version, visits: 1, lastVisitedAt: "2026-11-02T00:00:00.000Z", masteredAt: "2026-11-02T00:00:00.000Z", current: null, attempts: [{ attemptId: "a", number: 1, variantId: "v", scenarioKey: "k", status: "mastered", predictionCorrect: true, explanationCorrect: true, reasoning: "", at: "2026-11-02T00:00:00.000Z" }] });
  await seed(page, {
    "kitab.learning.v1": { version: 1, lessons: { "ipv4-subnets": lesson("ipv4-subnets"), "local-delivery-routing": lesson("local-delivery-routing") } },
    "kitab.progress.v1": { version: 1, missions: Object.fromEntries(["ipv4-network-address", "ipv4-local-or-remote", "gateway-or-direct", "tcp-lost-segment", "tcp-send-window", "tcp-lab"].map((id) => [id, mastered(id)])) },
    "kitab.network-missions.v1": { version: 1, missions: Object.fromEntries(networkMissions.map((m) => [m.id, { missionVersion: m.version, attempts: [], completedAt: "2026-11-03T00:00:00.000Z", masteredAt: "2026-11-03T00:00:00.000Z" }])) },
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You've mastered Networking");
  await expect(page.locator(".dash-total")).toContainText("100%");
  await expect(page.locator(".continue-card").getByRole("link")).toHaveAttribute("href", "/practice/network");
  await expect(page.locator(".more-tracks").getByRole("link", { name: /Data structures & recursion/ })).toBeVisible();
});

test("progress saved before the redesign shows as before, and nothing in it is rewritten", async ({ page }) => {
  const before = {
    "kitab.learning.v1": { version: 1, lessons: { "ip-addressing": { lessonVersion: "1.1.0", visits: 4, lastVisitedAt: "2026-11-01T10:00:00.000Z", seen: ["choose-hop"], total: 13, chaptersSeen: ["address", "routes"], completedAt: "2026-11-01T10:00:00.000Z", experimentsCompleted: [], position: null, updated: false } } },
    "kitab.progress.v1": { version: 1, missions: { "tcp-lost-segment": { missionVersion: "1.1.0", visits: 3, lastVisitedAt: "2026-10-01T10:00:00.000Z", masteredAt: "2026-10-01T10:05:00.000Z", attempts: [], current: null } } },
    "kitab.network.challenges.v1": ["cable", "nat"],
  };
  await seed(page, before);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator(".welcome")).toBeVisible();
  await expect(page.locator(".dash-total")).toContainText("3 of 14 lessons and missions completed · 1 mastered");
  // The header shows the same progress.
  if ((page.viewportSize()?.width ?? 0) > 760) await expect(page.locator(".header-continue")).toContainText("Networking · 21%");
  for (const [key, value] of Object.entries(before)) expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(JSON.stringify(value));
  expect(errors).toEqual([]);
});

test("a lesson's page heading is the lesson, and stays the same as its steps change", async ({ page }) => {
  await page.goto("/learn/ipv4-subnets");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Understanding IPv4 addresses and subnets");
  const first = await page.locator(".step-title").textContent();
  await page.locator(".lesson-controls .next-button").click();
  await expect(page.locator(".step-title")).not.toHaveText(first!);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Understanding IPv4 addresses and subnets");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
});
