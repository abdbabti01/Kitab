import { expect, test } from "@playwright/test";

// The whole networking path a learner takes, in one session: content, explorer, playground, networking
// missions, TCP missions and progress. It starts with progress from before practice missions existed and
// checks that the learner's own playground design survives every step.
test("networking journey: home → lesson → explorer → playground → missions → TCP mission → progress", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("kitab.network.challenges.v1", JSON.stringify(["cable", "nat"])));
  await page.reload();

  // Networking content.
  await page.getByRole("link", { name: /IP Addresses & Subnets/ }).first().click();
  await expect(page).toHaveURL(/\/learn\/ip-addressing$/);
  await expect(page.locator("#step-title")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);

  // Explorer.
  await page.getByRole("link", { name: /Explore connections/ }).click();
  await expect(page).toHaveURL(/\/practice\/connections$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One message.");
  await page.goBack();

  // Playground: the learner's own design is saved and survives a reload.
  await page.getByRole("link", { name: /Open network playground/ }).click();
  await expect(page).toHaveURL(/\/practice\/network$/);
  await page.getByLabel("Network name").fill("My home lab");
  await page.getByLabel("Network name").press("Tab");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1") ?? "")).toContain("My home lab");
  await page.reload();
  await expect(page.getByLabel("Network name")).toHaveValue("My home lab");
  // Earlier challenge completions count as completed missions, not mastered ones.
  await expect(page.getByRole("link", { name: /Practice missions/ })).toContainText("2/6 done");

  // Networking missions.
  await page.getByRole("link", { name: /Practice missions/ }).click();
  await expect(page).toHaveURL(/\/practice\/missions$/);
  await expect(page.getByRole("link", { name: /No connection/ }).locator(".state-pill")).toHaveText("Completed");
  await expect(page.getByRole("link", { name: /Bring the reply home/ }).locator(".state-pill")).toHaveText("Completed");
  await expect(page.locator(".state-pill", { hasText: "Mastered" })).toHaveCount(0);
  await page.getByRole("link", { name: /Leave your LAN/ }).click();
  await expect(page).toHaveURL(/\/practice\/missions\/leave-the-lan$/);
  // Working in a mission never touches the saved design.
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("Delivery stopped");
  expect(await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"))).toContain("My home lab");
  await page.goBack();

  // TCP missions are listed with the same states and open the TCP mission page.
  const tcp = page.getByRole("link", { name: /The ACK that wouldn't move/ });
  await expect(tcp.locator(".state-pill")).toHaveText("Not started");
  await tcp.click();
  await expect(page).toHaveURL(/\/missions\/tcp-lost-segment$/);
  await page.locator("label.choice", { hasText: "ACK 4501" }).click();
  await page.getByRole("button", { name: "Test prediction" }).click();
  const slider = page.getByRole("slider", { name: "Step" });
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("End");
  await page.locator("label.choice", { hasText: /stays at 2461/ }).click();
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("heading", { name: "Not mastered yet" })).toBeVisible();

  // Progress reads the same everywhere and survives a reload.
  await page.goto("/practice/missions");
  await expect(page.getByRole("link", { name: /The ACK that wouldn't move/ }).locator(".state-pill")).toHaveText("Completed");
  await page.goto("/");
  await page.reload();
  await expect(page.locator(".mission-card", { hasText: "The ACK that wouldn't move" }).locator(".status-chip")).toHaveText("Completed");
  await expect(page.locator(".mission-card", { hasText: "How full can the pipe get?" }).locator(".status-chip")).toHaveText("Not started");
  await page.goto("/practice/network");
  await expect(page.getByLabel("Network name")).toHaveValue("My home lab");

  expect(errors).toEqual([]);
});
