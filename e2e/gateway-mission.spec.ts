import { expect, test, type Page } from "@playwright/test";

// "Gateway or direct?": every MAC address comes from a simulator run; wrong choices get their mistake explained with
// this version's own values; mastery needs two different versions; just watching earns nothing.
async function choose(page: Page, text: string | RegExp) {
  await page.locator("label.choice", { hasText: text }).click();
}
async function runToEnd(page: Page) {
  const slider = page.getByRole("slider", { name: "Step" });
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeFocused();
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("End");
}
async function fresh(page: Page, path: string) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
}
// The on-demand engine's module (dev path or built chunk).
const engineModule = /engines\/gateway-practice\.ts|assets\/gateway-practice[^/]*\.js/;

test("a wrong MAC is explained with the run's own values, and two different versions master the mission", async ({ page }) => {
  await fresh(page, "/missions/gateway-or-direct");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gateway or direct?");
  await expect(page.locator("main")).not.toContainText("{param.");
  await expect(page.getByText("Your PC (192.168.1.10/24, default gateway 192.168.1.1) pings 192.168.1.30. Which destination MAC address goes on the frame it sends?")).toBeVisible();
  await expect(page.getByLabel("Key ideas")).toContainText("Next hop");
  await expect(page.locator("label.choice")).toHaveCount(4);
  // Before the prediction the picture shows the settings, not the decision.
  await expect(page.locator(".ld-task")).toContainText("192.168.1.10/24");
  await expect(page.locator(".ld-scene .ld-envelope")).toHaveCount(0);

  // Version 1 is on the PC's own subnet: "everything goes through the gateway" is the mistake.
  await choose(page, /the default gateway's MAC/);
  await page.getByRole("button", { name: "Test prediction" }).click();
  await runToEnd(page);
  await page.getByRole("button", { name: "Show me the evidence" }).click();
  await expect(page.locator(".guide-message")).toContainText("192.168.1.30 is on your PC's own /24 subnet, so your PC delivers directly");
  await choose(page, /It asked ARP for its next hop on this link/);
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("heading", { name: "Not mastered yet" })).toBeVisible();

  // Version 2 goes through the gateway; version 3 is a /23 that looks remote but is local.
  for (const [destination, answer, last] of [["192.168.2.20", /the default gateway's MAC/, false], ["192.168.0.30", /the destination's MAC/, true]] as const) {
    await page.getByRole("button", { name: last ? "Try another scenario" : "Retry with a new scenario" }).click();
    await expect(page.getByText(new RegExp(`pings ${destination.replaceAll(".", "\\.")}\\.`))).toBeVisible();
    await choose(page, answer);
    await page.getByRole("button", { name: "Test prediction" }).click();
    await runToEnd(page);
    await choose(page, /It asked ARP for its next hop on this link/);
    await page.getByRole("button", { name: "Check explanation" }).click();
    if (!last) await expect(page.getByRole("heading", { name: "This version mastered" })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Mission mastered" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the run shows the simulator's ARP and the frame the PC sent", async ({ page }) => {
  await fresh(page, "/missions/gateway-or-direct");
  await choose(page, /the destination's MAC/);
  await page.getByRole("button", { name: "Test prediction" }).click();
  const slider = page.getByRole("slider", { name: "Step" });
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("Home");
  // Step 6 of 8 is the frame leaving your PC: to the phone's MAC, which ARP returned.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  const scene = page.locator(".ld-scene").last();
  await expect(scene.locator(".ld-envelope")).toContainText("Destination MAC02:12:4d:29:c7:00");
  await expect(scene.locator(".ld-envelope")).toContainText("Destination IP192.168.1.30");
  // A practice network isn't one of the lab's starters, so it isn't offered as "this network".
  await expect(scene.getByRole("link", { name: "Open this network in the Playground →" })).toHaveCount(0);
});

test("just watching shows the run but never earns credit", async ({ page }) => {
  await fresh(page, "/missions/gateway-or-direct");
  await page.getByRole("button", { name: "Just watch (no credit)" }).click();
  await expect(page.locator(".ld-scene").last()).toBeVisible();
  const record = await page.evaluate(() => JSON.parse(localStorage.getItem("kitab.progress.v1") ?? "{}").missions?.["gateway-or-direct"]);
  expect(record.masteredAt).toBeNull();
  expect(record.current.attempt.skippedPrediction).toBe(true);
  expect(record.current.attempt.mastered).toBe(false);
});

test("the engine loads on demand; a failed download shows an accessible error and Try again recovers", async ({ page }) => {
  await page.route(engineModule, (route) => route.abort());
  await fresh(page, "/missions/gateway-or-direct");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Gateway or direct? couldn't load");
  await expect(alert).toContainText("Your saved progress is unchanged.");
  await page.unroute(engineModule);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gateway or direct?");
  await expect(page.locator("label.choice")).toHaveCount(4);
});

test("Lesson 2 ends in the lab: its networks, the practice mission and the lab missions", async ({ page }) => {
  await fresh(page, "/learn/local-delivery-routing");
  await page.locator(".chapter-pill", { hasText: "Try it in the lab" }).click();
  await expect(page.locator("#step-title")).toHaveText("Try it in the lab");
  const starters = page.locator(".ld-starters");
  await expect(starters.getByRole("link")).toHaveCount(3);
  await expect(starters.getByRole("link", { name: /Two connected LANs/ })).toHaveAttribute("href", "/practice/network?starter=routed");
  const practice = page.locator(".completion .practice-list");
  await expect(practice.getByRole("link", { name: /Gateway or direct\?/ })).toHaveAttribute("href", "/missions/gateway-or-direct");
  await expect(page.locator(".completion")).toContainText("Troubleshoot a network");
  await expect(practice.getByRole("link", { name: /Leave your LAN/ })).toHaveAttribute("href", "/practice/missions/leave-the-lan");
  await expect(practice.getByRole("link", { name: /Bring the reply home/ })).toHaveAttribute("href", "/practice/missions/bring-reply-home");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
