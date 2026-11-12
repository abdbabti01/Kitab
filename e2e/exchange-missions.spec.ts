import { test, expect, type Page } from "@playwright/test";
import { openExchange, toLast } from "./track.ts";

// Exploring a mission's run in the Exchange view is ordinary exploration: it is neither evidence nor a hint.
const steps = (page: Page) => page.locator(".mission-steps");
const exchange = (page: Page) => page.getByRole("region", { name: "Protocol exchange" });
const openMissionTab = (page: Page) => page.getByRole("button", { name: "Mission", exact: true }).click();
/** The saved record of this mission: whether the current attempt has evidence, and mastery. */
const saved = (page: Page) =>
  page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem("kitab.network-missions.v1") ?? "{}");
    const r = store.missions?.["no-connection"];
    return { evidence: r?.attempts?.at(-1)?.evidence ?? null, masteredAt: r?.masteredAt ?? null };
  });
async function diagnose(page: Page) {
  await page.getByLabel("Faulty device").selectOption("server");
  await page.getByLabel("Faulty setting").selectOption("link");
  await page.getByRole("button", { name: "Submit diagnosis" }).click();
}
async function start(page: Page) {
  await page.goto("/practice/missions/no-connection");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Open full exchange" }).click();
}

test("opening messages in Exchange never submits evidence, and choosing one explicitly is judged on its event", async ({ page }) => {
  await start(page);
  await toLast(page);
  // Opening the stop and a message moves the Journey, but nothing is chosen as evidence.
  await exchange(page).locator(".exchange-stop").click();
  await exchange(page).locator(".exchange-row").first().click();
  await openMissionTab(page);
  await expect(steps(page)).not.toContainText("Your evidence");
  await diagnose(page);
  await expect(steps(page)).toContainText('choose it with "Use this step as evidence"');
  expect(await saved(page)).toEqual({ evidence: false, masteredAt: null });
  // A message that does not show the problem, chosen explicitly, is not evidence.
  await page.getByRole("button", { name: "Use this step as evidence" }).click();
  await diagnose(page);
  await expect(steps(page)).toContainText("The step you chose does not show this problem.");
  expect((await saved(page)).evidence).toBe(false);
  // The stop, found by exploring in Exchange and then chosen explicitly, is the learner's own evidence.
  await exchange(page).locator(".exchange-stop").click();
  await openMissionTab(page);
  await page.getByRole("button", { name: "Use this step as evidence" }).click();
  await diagnose(page);
  await expect(steps(page)).toContainText("The step you chose is good evidence.");
  expect(await saved(page)).toEqual({ evidence: true, masteredAt: null });
});

test("assistance stays recorded across Summary, Every event and the full exchange, which does not wash it out", async ({ page }) => {
  await start(page);
  // Assistance shows the stop.
  await page.locator(".run-status").getByRole("button", { name: "Show where and why" }).click();
  // Switching views and opening and closing the exchange, and reloading, keeps that record.
  const toggle = page.locator(".track-foot").getByRole("button");
  for (const view of ["Summary", "Every event"]) {
    await page.getByRole("radio", { name: view }).click();
    await toggle.click();
  }
  await page.reload();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.getByRole("button", { name: "Close full exchange" })).toBeVisible();
  await toLast(page);
  // Reaching the same step through Exchange and choosing it is still assisted: no mastery credit.
  await exchange(page).locator(".exchange-stop").click();
  await openMissionTab(page);
  await page.getByRole("button", { name: "Use this step as evidence" }).click();
  await diagnose(page);
  await expect(steps(page)).toContainText('"Show where and why" showed it to you first');
  expect(await saved(page)).toEqual({ evidence: false, masteredAt: null });
});
