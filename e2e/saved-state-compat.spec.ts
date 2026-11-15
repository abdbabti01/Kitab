import { expect, test, type Page } from "@playwright/test";

// A learner's saved state from before the IPv4 switchover, opened in the new application: the replaced lesson still
// opens with its record and points to its replacements, the new lessons acknowledge the earlier completion, and no
// store is rewritten by browsing.
const position = (stepId: string, params: Record<string, string | number> = {}) => ({ params, track: "journey", stepId, journeyStepId: stepId });
const fixture = {
  "kitab.learning.v1": {
    version: 1,
    lessons: {
      "ip-addressing": { lessonVersion: "1.1.0", visits: 4, lastVisitedAt: "2026-11-01T10:00:00.000Z", seen: ["choose-hop"], total: 13, chaptersSeen: ["address", "routes"], completedAt: "2026-11-01T10:00:00.000Z", experimentsCompleted: [], position: position("choose-hop", { prefix: 25, target: "printer" }), updated: false },
      "local-delivery-routing": { lessonVersion: "1.0.0", visits: 2, lastVisitedAt: "2026-11-14T16:00:00.000Z", seen: ["decide", "default-route"], total: 16, chaptersSeen: ["same-subnet", "arp-or-gateway", "two-addresses", "router-between-subnets"], completedAt: "2026-11-14T16:00:00.000Z", experimentsCompleted: [], position: position("default-route"), updated: false },
    },
  },
  "kitab.progress.v1": {
    version: 1,
    missions: { "ipv4-local-or-remote": { missionVersion: "1.0.0", visits: 2, lastVisitedAt: "2026-11-13T10:00:00.000Z", masteredAt: "2026-11-13T10:05:00.000Z", attempts: [], current: null } },
  },
  "kitab.network-missions.v1": { version: 1, missions: { neighbours: { missionVersion: "1.0.0", attempts: [], completedAt: "2026-11-02T10:00:00.000Z", masteredAt: "2026-11-02T10:10:00.000Z" } } },
  "kitab.network.challenges.v1": ["cable", "nat"],
};
async function seed(page: Page) {
  await page.goto("/");
  await page.evaluate((entries) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, JSON.stringify(value));
  }, fixture);
}
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);

test("Home shows the new path with the recorded progress, and the old lesson only where it was saved", async ({ page }) => {
  await seed(page);
  await page.reload();
  const stage = page.locator(".path-stages details", { has: page.locator("summary", { hasText: "IPv4 addresses and subnets" }) });
  await stage.locator("summary").click();
  await expect(stage.locator(".path-activity", { hasText: "Same subnet or not?" }).locator(".status-chip")).toHaveText("Mastered");
  await expect(stage.locator(".path-activity", { hasText: "Neighbours that look remote" }).locator(".status-chip")).toHaveText("Mastered");
  const routing = page.locator(".path-stages details", { has: page.locator("summary", { hasText: "Gateways, routing and NAT" }) });
  await expect(routing.locator("summary")).toContainText("2 of 4 completed");
  await expect(page.locator(".path-activity", { hasText: "IP Addresses & Subnets" })).toHaveCount(0);
  await expect(page.locator(".journey-card", { hasText: "IP Addresses & Subnets" })).toHaveCount(0);
});

test("the replaced lesson still opens at the learner's saved place, says what replaced it, and keeps its record", async ({ page }) => {
  await seed(page);
  await page.goto("/learn/ip-addressing");
  const note = page.locator(".lesson-replaced");
  await expect(note).toContainText("This lesson has been replaced by Understanding IPv4 addresses and subnets and Local delivery, gateways and routing");
  await expect(note.getByRole("link", { name: "Local delivery, gateways and routing" })).toHaveAttribute("href", "/learn/local-delivery-routing");
  await expect(page.locator("#step-title")).toContainText(/./);
  await expect(page.locator(".step-what")).toContainText("the PC chooses");
  const record = (await stored(page, "kitab.learning.v1")).lessons["ip-addressing"];
  expect(record.completedAt).toBe("2026-11-01T10:00:00.000Z");
  expect(record.lessonVersion).toBe("1.1.0");
});

test("the new lessons acknowledge the earlier completion, and Lesson 2's completion of its first release stays", async ({ page }) => {
  await seed(page);
  await page.goto("/learn/ipv4-subnets");
  await expect(page.locator(".lesson-replaced")).toContainText("You completed the earlier lesson “IP Addresses & Subnets” on");
  await expect(page.locator(".lesson-replaced")).toContainText("your record of it is kept");
  await page.goto("/learn/local-delivery-routing");
  // Lesson 2 opens at its saved place (not the first step), where the note isn't repeated.
  await expect(page.locator("#step-title")).toHaveText("When no connected route matches");
  await expect(page.locator(".lesson-replaced")).toHaveCount(0);
  const lessons = (await stored(page, "kitab.learning.v1")).lessons;
  expect(lessons["local-delivery-routing"].completedAt).toBe("2026-11-14T16:00:00.000Z");
  expect(lessons["ip-addressing"]).toEqual(fixture["kitab.learning.v1"].lessons["ip-addressing"]);
  // Mission and lab stores are never touched by lessons.
  for (const key of ["kitab.progress.v1", "kitab.network-missions.v1", "kitab.network.challenges.v1"] as const) expect(await stored(page, key)).toEqual(fixture[key]);
});

test("the lab's lesson links lead to Lesson 1, and the missions index lists the new missions with recorded states", async ({ page }) => {
  await seed(page);
  await page.goto("/practice/missions");
  await expect(page.getByRole("link", { name: /Same subnet or not\?/ }).locator(".status-chip")).toHaveText("Mastered");
  await expect(page.getByRole("link", { name: /Gateway or direct\?/ }).locator(".status-chip")).toHaveText("Not started");
  await expect(page.getByRole("link", { name: /Bring the reply home/ }).locator(".status-chip")).toHaveText("Completed");
  await page.goto("/practice/network");
  await expect(page.locator('a[href="/learn/ip-addressing"]')).toHaveCount(0);
  await expect(page.locator('a[href="/learn/ipv4-subnets"]').first()).toBeAttached();
});
