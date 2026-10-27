import { expect, test } from "@playwright/test";

// Runs against the real Worker handler with the scripted fake AI (vite.e2e.config.ts): not a real model.
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/hello-tcp");
  await expect(page.locator("#step-title")).toBeVisible();
});

test("a validated follow-up answer is shown with an AI label and does not move the lesson", async ({ page }) => {
  await page.getByLabel(/Ask a follow-up question/).fill("What does each level do?");
  await page.getByRole("button", { name: "Ask Kitab" }).click();
  await expect(page.locator(".tutor-answer")).toContainText("Each level reads only its own header");
  await expect(page.locator(".tutor-answer")).toContainText("AI answer, checked against this step's computed facts");
  await expect(page.locator(".step-position")).toHaveText("1 / 39");
});

test("a late reply for an earlier step is discarded and never resets progress", async ({ page }) => {
  await page.getByLabel(/Ask a follow-up question/).fill("A slow question about this step");
  await page.getByRole("button", { name: "Ask Kitab" }).click();
  await expect(page.getByText("Kitab is checking this step…")).toBeVisible();
  await page.locator(".lesson-controls .next-button").click();
  await page.locator(".lesson-controls .next-button").click();
  await expect(page.locator(".step-position")).toHaveText("3 / 39");
  // The fake answers after 2 s; give it time to arrive, then confirm it was dropped.
  await page.waitForTimeout(2600);
  await expect(page.locator(".tutor-answer")).toHaveCount(0);
  await expect(page.locator(".step-position")).toHaveText("3 / 39");
});

test("changing the message cancels a pending reply", async ({ page }) => {
  await page.getByLabel(/Ask a follow-up question/).fill("Another slow question");
  await page.getByRole("button", { name: "Ask Kitab" }).click();
  await page.locator(".example-controls summary").click();
  await page.getByLabel("Your message").fill("Hi");
  await page.getByRole("button", { name: "Use it" }).click();
  await page.waitForTimeout(2600);
  await expect(page.locator(".tutor-answer")).toHaveCount(0);
  await expect(page.locator(".mj-chars button")).toHaveCount(2);
});
