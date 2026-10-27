import { expect, test, type Page } from "@playwright/test";

// Review finding 3. Runs against vite.e2e.config.ts: descriptions containing "slow" answer after 2 s,
// and TCP-lab tutor replies after 1.5 s.

async function describe(page: Page, text: string) {
  await page.getByLabel(/Or describe it/).fill(text);
  await page.getByRole("button", { name: "Apply description" }).click();
}
const network = (page: Page) => page.getByRole("combobox", { name: /^Network/ });
const payload = (page: Page) => page.locator("label.field", { hasText: "Payload" }).locator("input[type=range]");

test("a slow scenario reply after the prediction does not reset the attempt", async ({ page }) => {
  await page.goto("/missions/tcp-lab");
  await describe(page, "slow: lose a segment with a tiny MSS");
  await page.locator("label.field", { hasText: "Your number" }).locator("input").fill("4");
  await page.getByRole("button", { name: "Test prediction" }).click();
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeVisible();
  await page.waitForTimeout(2600); // the slow reply has now arrived
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeVisible();
  await expect(page.locator(".phase").getByText("You predicted 4 transmissions")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeVisible();
  await expect(page.locator(".phase").getByText("You predicted 4 transmissions")).toBeVisible();
});

test("an out-of-order slow reply cannot overwrite a newer applied scenario", async ({ page }) => {
  await page.goto("/missions/tcp-lab");
  await describe(page, "slow: lose a segment");
  // While the first is pending the button is busy, but Enter still submits: two requests overlap.
  await page.getByLabel(/Or describe it/).fill("reorder the segments");
  await page.getByLabel(/Or describe it/).press("Enter");
  await expect(network(page)).toHaveValue("reorder");
  await page.waitForTimeout(2600);
  await expect(network(page)).toHaveValue("reorder");
  await expect(page.locator(".tcp-segment")).toHaveCount(4);
});

test("changing a setting while a description is pending cancels it", async ({ page }) => {
  await page.goto("/missions/tcp-lab");
  await describe(page, "slow: lose a segment");
  await payload(page).fill("2500");
  await expect(page.getByRole("status").filter({ hasText: "Cancelled: the settings changed" })).toBeVisible();
  await page.waitForTimeout(2600);
  await expect(network(page)).toHaveValue("normal");
  await expect(page.locator("label.field", { hasText: "Payload" }).locator("output")).toHaveText("2500 B");
});

test("leaving the mission while a description is pending is harmless", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/missions/tcp-lab");
  await describe(page, "slow: lose a segment");
  await page.getByRole("link", { name: "Kitab" }).first().click();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(2600);
  await page.goto("/missions/tcp-lab");
  await expect(page.getByRole("heading", { name: "Inspect, then predict" })).toBeVisible();
  await expect(network(page)).toHaveValue("normal");
  await expect(page.locator(".tcp-segment")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("a tutor reply for the previous settings is dropped, not shown", async ({ page }) => {
  await page.goto("/missions/tcp-lab");
  await page.getByRole("button", { name: "Explain this step" }).click();
  await expect(page.locator(".guide-message")).toHaveText("Let me check the trace…");
  await payload(page).fill("2500");
  await expect(page.locator(".guide-message")).toContainText("dropped that answer");
  await page.waitForTimeout(2000); // the old reply would have landed by now
  await expect(page.locator(".guide-message")).toContainText("dropped that answer");
  await expect(page.locator(".guide-source")).toHaveCount(0);
});
