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
// Each subject's page carries its own progress and the place to resume it.
const resume = (page: Page) => page.locator(".track-resume");

/** Home's content, without the demonstration (it plays on its own). */
const homeText = (page: Page) => page.locator("#main > :not(.playground-feature)").allInnerTexts();

test("Home leads with the subjects and the Playground, the same for a first visit and a returning learner", async ({ page }) => {
  await seed(page, {});
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("See how computers really work, one step at a time.");
  const cards = page.locator(".subject-card");
  await expect(cards.locator("h3")).toHaveText(["Networking", "Data structures & recursion", "Network Playground"]);
  // The subjects are on the first screen: all three side by side on a wide screen, the first one on a phone.
  const shown = page.viewportSize()!.width >= 1024 ? await cards.all() : [cards.first()];
  for (const card of shown) await expect(card).toBeInViewport();
  await expect(page.getByText("Continue where you left off")).toHaveCount(0);
  const first = await homeText(page);

  // A learner with progress sees exactly the same Home: progress lives on the subject's page.
  await page.goto("/learn/ipv4-subnets");
  await page.locator(".lesson-controls .next-button").click();
  await page.goto("/");
  await expect(page.locator(".subject-card")).toHaveCount(3);
  expect(await homeText(page)).toEqual(first);
  await expect(page.locator(".site-header").getByText(/Continue/)).toHaveCount(0);
});

test("each subject on Home opens its own track, and the Playground opens the lab", async ({ page }) => {
  for (const [name, url, heading] of [
    ["Explore Networking", /\/learn$/, "Networking"],
    ["Explore Data structures", /\/learn\/data-structures$/, "Data structures & recursion"],
    ["Open the Playground", /\/practice\/network$/, "Network Playground"],
  ] as const) {
    await page.goto("/");
    await page.locator(".subject-card").getByRole("link", { name }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
  }
  // The featured section opens a starter scenario directly.
  await page.goto("/");
  await page.locator(".feature-starters").getByRole("link", { name: /Your first LAN/ }).click();
  await expect(page).toHaveURL(/\/practice\/network\?starter=lan$/);
  await expect(page.locator(".scenario-current")).toContainText("Your first LAN");
});

test("a learner returning mid-lesson continues from the Networking track at the exact step they left", async ({ page }) => {
  await seed(page, {});
  await page.goto("/learn/ipv4-subnets");
  for (let i = 0; i < 4; i++) await page.locator(".lesson-controls .next-button").click();
  const step = (await page.locator(".step-title").textContent())!;
  // Then a TCP mission is only opened, never attempted.
  await page.goto("/missions/tcp-send-window");
  await expect(page.locator("#main h1")).toBeVisible();

  await page.goto("/");
  await page.locator(".subject-card").getByRole("link", { name: "Explore Networking" }).click();
  await expect(resume(page).locator(".eyebrow")).toHaveText("Continue where you left off");
  await expect(resume(page).getByRole("heading", { level: 2 })).toHaveText("Understanding IPv4 addresses and subnets");
  await expect(resume(page)).toContainText("Unit 3: IPv4 addresses and subnets · Lesson");
  await expect(resume(page)).toContainText("5 of 13 steps seen");
  await expect(resume(page).locator(".button.primary")).toHaveCount(1);
  await resume(page).getByRole("link", { name: /Continue/ }).click();
  await expect(page).toHaveURL(/\/learn\/ipv4-subnets$/);
  await expect(page.locator(".step-title")).toHaveText(step);
});

test("progress is per subject: data-structures progress resumes in its own track, not in Networking", async ({ page }) => {
  await seed(page, {});
  const lesson = findLesson("array-insert")!;
  await page.goto("/learn/array-insert");
  for (let i = 0; i < 2; i++) await page.locator(".lesson-controls .next-button").click();
  const step = (await page.locator(".step-title").textContent())!;

  await page.goto("/learn");
  await expect(resume(page).locator(".eyebrow")).toHaveText("Start here");
  await expect(resume(page).getByRole("heading", { level: 2 })).toHaveText("How your home connects");

  await page.goto("/learn/data-structures");
  await expect(resume(page).locator(".eyebrow")).toHaveText("Continue where you left off");
  await expect(resume(page).getByRole("heading", { level: 2 })).toHaveText(lesson.title);
  await expect(resume(page)).toContainText("Unit 1: Arrays and memory · Lesson");
  await resume(page).getByRole("link", { name: new RegExp(`Continue: ${lesson.title}`) }).click();
  await expect(page).toHaveURL(/\/learn\/array-insert$/);
  await expect(page.locator(".step-title")).toHaveText(step);
});

test("a learner with an unfinished mission continues it from the Networking track", async ({ page }) => {
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
  await page.goto("/learn");
  await expect(resume(page).getByRole("heading", { level: 2 })).toHaveText("Neighbours that look remote");
  await expect(resume(page)).toContainText("Unit 3: IPv4 addresses and subnets · Troubleshoot");
  await expect(resume(page).getByRole("link", { name: /Continue/ })).toHaveAttribute("href", "/practice/missions/neighbours");
  await expect(page.locator(".track-meter")).toContainText("1 of 14 lessons and missions completed");
});

test("a learner who mastered every networking mission is told so in the track, with the Playground next", async ({ page }) => {
  const lesson = (id: string) => ({ lessonVersion: findLesson(id)!.version, visits: 1, lastVisitedAt: "2026-11-01T00:00:00.000Z", seen: [], total: 0, chaptersSeen: [], completedAt: "2026-11-01T00:00:00.000Z", experimentsCompleted: [], position: null, updated: false });
  const mastered = (id: string) => ({ missionVersion: findMission(id)!.version, visits: 1, lastVisitedAt: "2026-11-02T00:00:00.000Z", masteredAt: "2026-11-02T00:00:00.000Z", current: null, attempts: [{ attemptId: "a", number: 1, variantId: "v", scenarioKey: "k", status: "mastered", predictionCorrect: true, explanationCorrect: true, reasoning: "", at: "2026-11-02T00:00:00.000Z" }] });
  await seed(page, {
    "kitab.learning.v1": { version: 1, lessons: { "ipv4-subnets": lesson("ipv4-subnets"), "local-delivery-routing": lesson("local-delivery-routing") } },
    "kitab.progress.v1": { version: 1, missions: Object.fromEntries(["ipv4-network-address", "ipv4-local-or-remote", "gateway-or-direct", "tcp-lost-segment", "tcp-send-window", "tcp-lab"].map((id) => [id, mastered(id)])) },
    "kitab.network-missions.v1": { version: 1, missions: Object.fromEntries(networkMissions.map((m) => [m.id, { missionVersion: m.version, attempts: [], completedAt: "2026-11-03T00:00:00.000Z", masteredAt: "2026-11-03T00:00:00.000Z" }])) },
  });
  await page.goto("/learn");
  await expect(resume(page).locator(".eyebrow")).toHaveText("You've mastered Networking");
  await expect(resume(page).getByRole("link", { name: "Open the Playground" })).toHaveAttribute("href", "/practice/network");
  await expect(page.locator(".track-meter")).toContainText("14 of 14");
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
  await expect(page.locator(".subject-card")).toHaveCount(3);
  await page.goto("/learn");
  await expect(page.locator(".track-meter")).toContainText("3 of 14 lessons and missions completed · 1 mastered");
  await page.goto("/practice/network");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Network Playground");
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
