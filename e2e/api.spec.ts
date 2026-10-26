import { expect, test } from "@playwright/test";

// Runs against vite.e2e.config.ts: the real Worker handler with fake D1 + fake AI.

test("search → create an AI draft → draft page shows review status, version and accepts feedback", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("searchbox").fill("skip list");
  await page.getByRole("button", { name: /Create a draft about/ }).click();
  await expect(page).toHaveURL(/\/drafts\/skip%20list$/);
  await expect(page.getByText("Draft — not reviewed")).toBeVisible();
  await expect(page.getByText(/Not reviewed by a person/)).toBeVisible();
  await expect(page.getByText("Draft version 1")).toBeVisible();

  // A refresh reads the saved draft from the API and validates the same contract.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("skip list");

  await page.getByText("Feedback on this step").click();
  await page.locator(".rating label").nth(3).click();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("status").filter({ hasText: "linked to this exact step" })).toBeVisible();

  // Saved drafts appear in search.
  await page.goto("/");
  await page.getByRole("searchbox").fill("skip");
  await expect(page.locator(".concept-list a", { hasText: "skip list" })).toBeVisible();
});

test("Kitab tutor answers through the Worker and labels AI output", async ({ page }) => {
  await page.goto("/missions/tcp-lost-segment");
  await page.getByRole("button", { name: "Explain this step" }).click();
  await expect(page.locator(".guide-message")).toContainText("cumulative TCP acknowledgment");
  await expect(page.locator(".guide-source")).toHaveText(/AI explanation, checked against this trace/);
  await expect(page.locator(".kitab-avatar.mood-explaining").first()).toBeVisible();
});

test("mission feedback is accepted for the exact frame", async ({ page }) => {
  await page.goto("/missions/array-insert-shift");
  await page.getByText("Feedback on this step").click();
  await page.locator(".rating label").first().click();
  await page.getByLabel(/What was wrong/).fill("Unclear start");
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("status").filter({ hasText: "linked to this exact step" })).toBeVisible();
});
