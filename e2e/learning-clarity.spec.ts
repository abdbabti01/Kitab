import { expect, test, type Page } from "@playwright/test";

// Learners can tell what a Playground is for, what each setting means in a real system, what a practice task
// asks and how it is judged, and look up a term without leaving the page. Every browser project, by keyboard.

const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

async function openByKeyboard(page: Page, summary: ReturnType<Page["locator"]>) {
  await summary.focus();
  await page.keyboard.press("Enter");
}

test("the Architecture Playground says it is free exploration, and a setting explains where it lives in real systems", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/practice/architecture?template=cached-api");
  const guide = page.getByRole("region", { name: "About this Playground" });
  await expect(guide).toContainText("No objective and no pass or fail");
  await openByKeyboard(page, guide.getByText("How this Playground works"));
  await expect(guide.getByText("Run simulation / Run again")).toBeVisible();

  await page.locator("[data-node=api-1]").focus();
  await page.keyboard.press("Enter");
  const inspector = page.locator(".arch-inspector");
  const note = inspector.locator("details.real-note").filter({ has: page.getByText("Requests at once", { exact: false }) }).first();
  await openByKeyboard(page, note.locator("summary"));
  await expect(note).toContainText("A setting engineers configure");
  await expect(note).toContainText("not a CPU core, thread or connection");
  await expect(note.locator("figcaption")).toContainText("Representative:");
  // A measured time is not presented as a setting.
  const work = inspector.locator("details.real-note").filter({ hasText: "Own work per request" });
  await openByKeyboard(page, work.locator("summary"));
  await expect(work).toContainText("A measured property, not usually a setting");
  expect(await noSideScroll(page)).toBe(true);
});

test("a term opens in place and links to the concept that teaches it", async ({ page }) => {
  await page.goto("/practice/architecture?template=cached-api");
  const chip = page.locator(".terms details.term").filter({ hasText: "Processing slot" });
  await openByKeyboard(page, chip.locator("summary"));
  await expect(chip).toContainText("8 × 1000 ÷ 25 = 320");
  await chip.getByRole("link", { name: "Throughput, latency and Little's law" }).click();
  await expect(page).toHaveURL(/\/learn\/system-design\/performance#littles-law$/);
  await expect(page.getByRole("heading", { name: "Throughput, latency and Little's law", level: 2 })).toBeVisible();
});

test("a design challenge states the problem, the goal, what can change, how to test and what counts as success", async ({ page }) => {
  await page.goto("/practice/architecture/challenges/simple-web-app");
  for (const name of ["Problem", "How to test"]) await expect(page.getByRole("heading", { name, level: 2 })).toBeVisible();
  for (const name of ["Goal", "What you can change", "Success criteria"]) await expect(page.getByRole("heading", { name, level: 3 })).toBeVisible();
  // The criteria are the challenge's own checks: four for this one.
  await expect(page.locator(".check-list li")).toHaveCount(4);
  await page.getByRole("button", { name: "Check my design" }).click();
  await expect(page.getByText("Results and explanation")).toBeVisible();
  await expect(page.getByText("Change one thing, run the scenario to see its effect")).toBeVisible();
  expect(await noSideScroll(page)).toBe(true);
});

test("a run's findings name the settings behind a bottleneck and say what a run does not prove", async ({ page }) => {
  await page.goto("/practice/architecture/challenges/scale-behind-lb");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await page.getByRole("button", { name: "Skip to the end" }).click();
  await expect(page.locator(".finding").filter({ hasText: "is a bottleneck" }).first()).toContainText("Requests at once 8, Own work per request 25 ms");
  const limits = page.locator("details.run-limits");
  await openByKeyboard(page, limits.locator("summary"));
  await expect(limits).toContainText("not how fast real services are");
});

test("the Network Playground explains itself and where a device's settings live", async ({ page }) => {
  await page.goto("/practice/network");
  await expect(page.getByRole("region", { name: "About this Playground" })).toContainText("No objective and no pass or fail");
  await page.getByLabel("Starter network").selectOption("routed");
  await page.getByRole("button", { name: "Select Your PC", exact: true }).focus();
  await page.keyboard.press("Enter");
  const note = page.locator("details.real-note").filter({ hasText: "Where these settings live in a real network" });
  await openByKeyboard(page, note.locator("summary"));
  await expect(note).toContainText("Normally filled in automatically by DHCP");
  await expect(note.locator("figcaption")).toContainText("Representative:");
  expect(await noSideScroll(page)).toBe(true);
});

test("a networking mission says how it is tested and what completes and masters it", async ({ page }) => {
  await page.goto("/practice/missions/neighbours");
  const brief = page.locator(".mission-brief");
  await expect(brief.getByRole("heading", { name: "How to test and what counts" })).toBeVisible();
  await expect(brief).toContainText("Completed: Fix the network so every check passes.");
  await expect(brief).toContainText("Name the faulty device and setting correctly on your first try.");
});

test("the Data Structures Playground separates free exploration from its guided experiments", async ({ page }) => {
  await page.goto("/practice/structures");
  await expect(page.getByRole("region", { name: "About this Playground" })).toContainText("No objective and no pass or fail");
  await expect(page.getByRole("heading", { name: "Guided experiments" })).toBeVisible();
  const chip = page.locator(".terms details.term").filter({ hasText: "Stack frame" });
  await openByKeyboard(page, chip.locator("summary"));
  await expect(chip).toContainText("factorial(3)");
  expect(await noSideScroll(page)).toBe(true);
});
