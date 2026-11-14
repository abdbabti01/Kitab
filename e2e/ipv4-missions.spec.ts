import { expect, test, type Page } from "@playwright/test";

// Lesson 1 practice missions: every choice is a value from the shared IPv4 helper, wrong choices get their mistake
// explained, and mastery needs two versions predicted and explained correctly.
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
/** A choice whose label ends with this address (labels start with a letter: A, B, C …). */
const address = (ip: string) => new RegExp(`${ip.replaceAll(".", "\\.")}$`);

test("network address: a wrong choice is explained, and two correct versions master the mission", async ({ page }) => {
  await fresh(page, "/missions/ipv4-network-address");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Find the network address");
  await expect(page.locator("main")).not.toContainText("{param.");
  await expect(page.getByText("An interface uses 10.20.30.77/28. What is the network address of its subnet?")).toBeVisible();
  await expect(page.getByLabel("Key ideas")).toContainText("Network address");
  await expect(page.locator("label.choice")).toHaveCount(4);

  // The /24 habit: cutting at a whole octet.
  await choose(page, address("10.20.30.0"));
  await page.getByRole("button", { name: "Test prediction" }).click();
  await runToEnd(page);
  await expect(page.getByRole("status").filter({ hasText: "The engine computed" })).toContainText("10.20.30.64");
  await page.getByRole("button", { name: "Show me the evidence" }).click();
  await expect(page.locator(".guide-message")).toContainText("That treats the network part as whole octets. /28 ends inside an octet");
  await choose(page, /AND it with the mask 255\.255\.255\.240/);
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("heading", { name: "Not mastered yet" })).toBeVisible();

  for (const [prompt, answer, last] of [["172.20.200.9/20", "172.20.192.0", false], ["192.168.5.130/26", "192.168.5.128", true]] as const) {
    await page.getByRole("button", { name: last ? "Try another scenario" : "Retry with a new scenario" }).click();
    await expect(page.getByText(`An interface uses ${prompt}.`)).toBeVisible();
    await choose(page, address(answer));
    await page.getByRole("button", { name: "Test prediction" }).click();
    await runToEnd(page);
    await choose(page, /AND it with the mask/);
    await page.getByRole("button", { name: "Check explanation" }).click();
    if (!last) await expect(page.getByRole("heading", { name: "This version mastered" })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Mission mastered" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("local or remote: look-alike addresses, the device's own prefix, and no credit for just watching", async ({ page }) => {
  await fresh(page, "/missions/ipv4-local-or-remote");
  await expect(page.locator("main")).not.toContainText("{param.");
  await expect(page.getByText("A device uses 10.20.30.77/28 and sends a packet to 10.20.30.90. What does it do?")).toBeVisible();
  await choose(page, /Same subnet: it delivers directly/);
  await page.getByRole("button", { name: "Test prediction" }).click();
  await runToEnd(page);
  await page.getByRole("button", { name: "Show me the evidence" }).click();
  await expect(page.locator(".guide-message")).toContainText("Similar-looking addresses can be on different subnets. With /28, 10.20.30.77 masks to 10.20.30.64 but 10.20.30.90 masks to 10.20.30.80");
  await choose(page, /Whether a ping sent to the destination/);
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("heading", { name: "Not mastered yet" })).toBeVisible();

  // Watching without predicting shows the answer but never earns credit.
  await fresh(page, "/missions/ipv4-local-or-remote");
  await page.getByRole("button", { name: "Just watch (no credit)" }).click();
  await expect(page.locator(".v4-scene").last()).toContainText("Different subnet.");
  const record = await page.evaluate(() => JSON.parse(localStorage.getItem("kitab.progress.v1") ?? "{}").missions?.["ipv4-local-or-remote"]);
  expect(record.masteredAt).toBeNull();
  expect(record.attempts).toEqual([]);
  expect(record.current.attempt.skippedPrediction).toBe(true);
  expect(record.current.attempt.mastered).toBe(false);
});

test("Lesson 1's completion card links to both practice missions", async ({ page }) => {
  await fresh(page, "/learn/ipv4-subnets");
  await page.locator(".chapter-pill", { hasText: "Local or remote?" }).click();
  while (!(await page.locator(".lesson-controls .next-button").isDisabled())) await page.locator(".lesson-controls .next-button").click();
  const practice = page.locator(".practice-list");
  await expect(practice.getByRole("link", { name: /Find the network address/ })).toHaveAttribute("href", "/missions/ipv4-network-address");
  await expect(practice.getByRole("link", { name: /Same subnet or not\?/ })).toHaveAttribute("href", "/missions/ipv4-local-or-remote");
});
