import { expect, test, type Page } from "@playwright/test";

// The whole networking path, followed as a learner would: only the path's own links, never the browser's Back
// button. It starts with progress from before practice missions existed and checks that the learner's own
// playground design survives every step, including the playground starters the path opens.
const next = (page: Page) => page.getByRole("navigation", { name: "Next step" }).getByRole("link", { name: /^Next: / });
async function follow(page: Page, title: string, url: RegExp) {
  await expect(next(page)).toContainText(title);
  await next(page).click();
  await expect(page).toHaveURL(url);
}
const workspace = (page: Page) => page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1") ?? "");

test("networking path: home → explorer → starters → missions → both IPv4 lessons → Packet Journey → TCP missions, without Back", async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("kitab.network.challenges.v1", JSON.stringify(["cable", "nat"])));
  await page.reload();

  // The free playground: the learner's own design is saved.
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Playground" }).click();
  await expect(page).toHaveURL(/\/practice\/network$/);
  await page.getByLabel("Network name").fill("My home lab");
  await page.getByLabel("Network name").press("Tab");
  await expect.poll(() => workspace(page)).toContain("My home lab");
  // Earlier challenge completions count as completed missions, not mastered ones.
  await expect(page.getByRole("link", { name: /Practice missions/ })).toContainText("2/12 done");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Learn" }).click();

  // Stage 1: the path starts with the Explorer.
  await page.locator(".path-stages summary", { hasText: "Your home connection" }).click();
  await page.locator(".path-activity", { hasText: "How your home connects" }).click();
  await expect(page).toHaveURL(/\/practice\/connections$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One message.");

  // Stage 2: starters open as copies; the saved design is untouched.
  await follow(page, "Your first LAN", /\/practice\/network\?starter=lan$/);
  await expect(page.getByLabel("Network name")).toHaveValue("Your first LAN");
  await expect(page.locator(".network-notice")).toContainText("opened from the Networking track");
  await follow(page, "A wireless home", /\/practice\/network\?starter=wifi$/);
  await expect(page.getByLabel("Network name")).toHaveValue("A wireless home");
  expect(await workspace(page)).toContain("My home lab");
  await follow(page, "No connection", /\/practice\/missions\/no-connection$/);
  await expect(page.locator(".path-needs")).toContainText("Before you start: Your first LAN, A wireless home");

  // Stage 3: Lesson 1, the subnet explorer, then its prediction missions and the subnet lab missions.
  await follow(page, "Understanding IPv4 addresses and subnets", /\/learn\/ipv4-subnets$/);
  await page.locator(".chapter-pill").last().click();
  while (!(await page.locator(".lesson-controls .next-button").isDisabled())) await page.locator(".lesson-controls .next-button").click();
  await expect(page.locator(".completion")).toContainText("Practise this unit: Find the network address, Same subnet or not?, Neighbours that look remote, Join and get an address");
  await expect(page.locator(".completion").getByRole("link", { name: /Next lesson: Local delivery, gateways and routing/ })).toHaveAttribute("href", "/learn/local-delivery-routing");
  await follow(page, "Explore subnets", /\/practice\/subnets$/);
  await follow(page, "Find the network address", /\/missions\/ipv4-network-address$/);
  await follow(page, "Same subnet or not?", /\/missions\/ipv4-local-or-remote$/);
  await follow(page, "Neighbours that look remote", /\/practice\/missions\/neighbours$/);
  await follow(page, "Join and get an address", /\/practice\/missions\/join-and-address$/);
  await expect(page.locator(".path-needs")).toContainText("Before you start: A wireless home, Understanding IPv4 addresses and subnets");

  // Stage 4: Lesson 2, its starter, then the gateway mission and the routing and NAT lab missions.
  await follow(page, "Local delivery, gateways and routing", /\/learn\/local-delivery-routing$/);
  await page.locator(".chapter-pill", { hasText: "Try it in the lab" }).click();
  await expect(page.locator(".completion")).toContainText("Practise this unit: Gateway or direct?, Leave your LAN, Bring the reply home");
  await expect(page.locator(".completion").getByRole("link", { name: /Next lesson: Packet Journey/ })).toBeVisible();
  await follow(page, "Two connected LANs", /\/practice\/network\?starter=routed$/);
  await follow(page, "Gateway or direct?", /\/missions\/gateway-or-direct$/);
  await expect(page.locator(".learn-first")).toContainText("Follow the walkthrough first: Local delivery, gateways and routing");
  await follow(page, "Leave your LAN", /\/practice\/missions\/leave-the-lan$/);
  // Working in a mission never touches the saved design.
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("Delivery stopped");
  expect(await workspace(page)).toContain("My home lab");
  await follow(page, "Bring the reply home", /\/practice\/missions\/bring-reply-home$/);
  await expect(page.locator(".mission-meta .state-pill")).toHaveText("Completed");

  // Stage 5: the DNS concept, the Internet starter, Packet Journey (a static page with its own links), then the TCP missions.
  await follow(page, "DNS resolution", /\/concepts\/dns$/);
  await follow(page, "A request across the Internet", /\/practice\/network\?starter=internet$/);
  await follow(page, "Packet Journey", /\/learn\/hello-tcp$/);
  await expect(page).toHaveTitle("Packet Journey · C# Walkthrough");
  await page.getByRole("navigation", { name: "Where you are" }).getByRole("link", { name: "The ACK that wouldn't move" }).first().click();
  await expect(page).toHaveURL(/\/missions\/tcp-lost-segment$/);
  await page.locator("label.choice", { hasText: "ACK 4501" }).click();
  await page.getByRole("button", { name: "Test prediction" }).click();
  // Starting the run moves focus to its heading; take the slider only after that, so End isn't lost.
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeFocused();
  const slider = page.getByRole("slider", { name: "Step" });
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("End");
  await page.locator("label.choice", { hasText: /stays at 2461/ }).click();
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("heading", { name: "Not mastered yet" })).toBeVisible();
  await follow(page, "How full can the pipe get?", /\/missions\/tcp-send-window$/);
  await follow(page, "A segment goes missing", /\/practice\/missions\/missing-segment$/);
  await follow(page, "TCP lab: count the transmissions", /\/missions\/tcp-lab$/);
  await expect(page.getByRole("navigation", { name: "Next step" })).toContainText("You've reached the end of the track");

  // Progress reads the same on Home, the missions index and the playground, and survives a reload.
  await page.getByRole("navigation", { name: "Next step" }).getByRole("link", { name: "Back to the roadmap" }).click();
  await expect(page).toHaveURL(/\/learn#unit-mastery$/);
  const mastery = page.locator(".path-stages details", { has: page.locator("summary", { hasText: "Show mastery" }) });
  await expect(mastery).toHaveAttribute("open", "");
  await expect(mastery).toBeInViewport();
  await page.reload();
  await expect(page.locator(".path-activity", { hasText: "The ACK that wouldn't move" }).locator(".status-chip")).toHaveText("Completed");
  // Only opened on the way through, never attempted: a visit, not progress.
  await expect(page.locator(".path-activity", { hasText: "How full can the pipe get?" }).locator(".status-chip")).toHaveText("Opened");
  await expect(page.locator(".path-activity", { hasText: "No connection" }).locator(".status-chip")).toHaveText("Completed");
  await expect(page.locator(".path-stages summary", { hasText: "mastered" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Practice" }).click();
  await expect(page.getByRole("link", { name: /The ACK that wouldn't move/ }).locator(".status-chip")).toHaveText("Completed");
  await expect(page.getByRole("link", { name: /Bring the reply home/ }).locator(".status-chip")).toHaveText("Completed");
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Playground" }).click();
  await expect(page.getByLabel("Network name")).toHaveValue("My home lab");

  expect(errors).toEqual([]);
});
