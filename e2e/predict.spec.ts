import { test, expect, type Page } from "@playwright/test";

// Predict as you go, on the internet starter's web request: the first questions are the PC's next hop
// (192.168.1.1, the home router) and who answers its ARP broadcast (the home router).
const question = (page: Page) => page.getByRole("region", { name: "Prediction", exact: true });
const result = (page: Page) => page.getByRole("region", { name: "Prediction result" });
const exchange = (page: Page) => page.getByRole("region", { name: "Protocol exchange" });
async function start(page: Page) {
  await page.goto("/practice/network");
  await page.getByLabel("Predict as you go").check();
  await page.getByLabel("Destination").fill("http://kitab.test/");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Play journey" }).click();
  await expect(question(page)).toBeVisible();
}
async function pick(page: Page, text: string | RegExp, hasTouch?: boolean) {
  if (hasTouch) await question(page).locator("label.predict-option", { hasText: text }).tap();
  else await question(page).getByRole("radio", { name: text }).check();
  await question(page).getByRole("button", { name: "Check my prediction" }).click();
}

test("the question comes before its answer, and nothing later can be seen, scrubbed to or opened", async ({ page }) => {
  await start(page);
  await expect(question(page).getByRole("heading")).toHaveText("Your PC has a packet for 198.51.100.53. Which address will it send it to first?");
  await expect(question(page).getByRole("radio")).toHaveCount(2);
  // The Journey waits before the route is chosen: two events, no outcome, nothing further to scrub or play to.
  await expect(page.getByLabel("Journey timeline")).toHaveAttribute("max", "1");
  await expect(page.locator(".run-status")).toHaveText("The rest of this run appears once you answer the prediction or choose Show me.");
  await expect(page.getByRole("button", { name: "Last event", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Next stage" })).toBeDisabled();
  await expect(page.locator(".journey-position small")).toContainText("event 2 of 2");
  for (const view of ["Every event", "Exchange", "Summary"]) await page.getByRole("radio", { name: view }).click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await expect(page.locator(".steps-list h2")).toHaveText("2 stages");
  await page.getByRole("radio", { name: "Every event" }).click();
  await expect(page.locator(".event-list button")).toHaveText([/Prepare HTTP request/, /DNS query/]);
  await page.getByRole("radio", { name: "Exchange" }).click();
  await expect(exchange(page)).toContainText("No message has been sent yet.");
  await expect(page.locator(".network-inspector")).not.toContainText("Choose a route");
  await expect(question(page)).toBeVisible();
  // A wrong prediction: the real next hop, why, and the step that shows it.
  await pick(page, "198.51.100.53 (DNS server)");
  await expect(result(page).getByRole("heading")).toHaveText("Not quite. You predicted: 198.51.100.53 (DNS server).");
  await expect(result(page)).toContainText("What happened: 192.168.1.1 (Home router).");
  await expect(result(page)).toContainText('the route "Default gateway" sends it to 192.168.1.1 (Home router) first');
  await expect(page.locator(".journey-position b")).toContainText("Look up the name");
  await page.getByRole("radio", { name: "Every event" }).click();
  await expect(page.locator(".journey-position b")).toHaveText("Choose a route");
  // The next question: the DNS query waits for ARP, and the ARP request is created; neither is sent yet, no reply is shown.
  await result(page).getByRole("button", { name: "Continue" }).click();
  await expect(question(page).getByRole("heading")).toHaveText('Your PC broadcasts "Who has 192.168.1.1?" to every device on its LAN. Which device answers?');
  await page.getByRole("radio", { name: "Exchange" }).click();
  await expect(exchange(page).locator(".exchange-row")).toHaveText([/^DNS query.*not sent yet/, /^ARP request.*not sent yet/]);
  await expect(exchange(page)).not.toContainText("ARP reply");
  await pick(page, "Home router");
  await expect(result(page).getByRole("heading")).toHaveText("Your prediction was right.");
  // Once answered, the reply appears in the exchange, highlighted with the Journey.
  await expect(exchange(page).locator(".exchange-row[aria-current]")).toContainText("ARP reply");
});

test("Show me, trying again, and turning predictions off", async ({ page }) => {
  await start(page);
  await question(page).getByRole("button", { name: "Show me" }).click();
  await expect(result(page).getByRole("heading")).toHaveText("Here is what happened.");
  await expect(result(page)).toContainText("What happened: 192.168.1.1 (Home router).");
  // Trying again goes back to the question; a different prediction is judged afresh.
  await result(page).getByRole("button", { name: "Try this one again" }).click();
  await expect(question(page).getByRole("heading")).toContainText("Which address will it send it to first?");
  await expect(page.getByLabel("Journey timeline")).toHaveAttribute("max", "1");
  await pick(page, "192.168.1.1 (Home router)");
  await expect(result(page).getByRole("heading")).toHaveText("Your prediction was right.");
  // Nobody is trapped: turning predictions off shows the whole run and its outcome.
  await page.getByLabel("Predict as you go").uncheck();
  await expect(result(page)).toHaveCount(0);
  await expect(page.locator(".run-status")).toContainText("HTTP 200 OK");
  await page.getByRole("button", { name: "Last event", exact: true }).click();
  await expect(page.locator(".journey-position small")).toContainText(/event 489 of 489/);
});

test("by keyboard and touch, with reduced motion; practice changes no saved network and no mission progress", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  await page.waitForFunction(() => localStorage.getItem("kitab.network.workspace.v1"));
  const before = await page.evaluate(() => ({ workspace: localStorage.getItem("kitab.network.workspace.v1"), saves: localStorage.getItem("kitab.network.saves.v1") }));
  await page.getByLabel("Predict as you go").check();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Play journey" }).click();
  // The question takes the focus; Tab reaches the choices, arrow keys move between them, Enter checks.
  await expect(question(page).getByRole("heading")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(question(page).getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(question(page).getByRole("radio").nth(1)).toBeChecked();
  const chosen = await question(page).locator("label.is-chosen").textContent();
  await page.keyboard.press("Enter");
  await expect(result(page).getByRole("heading")).toBeFocused();
  await expect(result(page).getByRole("heading")).toHaveText(chosen === "192.168.1.1 (Home router)" ? "Your prediction was right." : /^Not quite/);
  // The revealed step is not animated with reduced motion.
  expect(await page.locator(".network-canvas animateMotion").count()).toBe(0);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
  await page.keyboard.press("Tab");
  await expect(result(page).getByRole("button", { name: "Continue" })).toBeFocused();
  await page.keyboard.press("Enter");
  // The next question; on touch screens the choices are finger-sized and a tap selects one.
  await expect(question(page).getByRole("heading")).toBeFocused();
  for (const h of await question(page).locator(".predict-option").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
  await pick(page, "Home router", info.project.use.hasTouch);
  await expect(result(page).getByRole("heading")).toHaveText("Your prediction was right.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await result(page).screenshot({ path: info.outputPath("result.png") });
  // Practice only: the saved network is untouched and no mission progress exists.
  const after = await page.evaluate(() => ({ workspace: localStorage.getItem("kitab.network.workspace.v1"), saves: localStorage.getItem("kitab.network.saves.v1") }));
  expect(after).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("kitab.network-missions.v1"))).toBeNull();
});

test("a lost segment: predict what TCP does, then see the retransmission", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Predict as you go").check();
  await page.getByLabel("Drop one data segment").check();
  await page.getByLabel("Playback speed").selectOption("8");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  // Show me through the questions before the loss (Continue plays on to the next one).
  await page.getByRole("button", { name: "Play journey" }).click();
  for (let k = 0; k < 6; k++) {
    await question(page).getByRole("button", { name: "Show me" }).click();
    await result(page).getByRole("button", { name: "Continue" }).click();
  }
  await expect(question(page).getByRole("heading")).toHaveText("This segment, 55 bytes starting at sequence 1001, was lost on the link. What happens next?", { timeout: 30_000 });
  await expect(page.locator(".journey-position b")).not.toContainText("Retransmit");
  await pick(page, "Your PC sends the same 55 bytes again, starting at sequence 1001");
  await expect(result(page).getByRole("heading")).toHaveText("Your prediction was right.");
  await page.getByRole("radio", { name: "Every event" }).click();
  await expect(page.locator(".journey-position b")).toHaveText("Retransmit TCP segment");
});
