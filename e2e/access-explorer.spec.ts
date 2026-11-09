import { test, expect } from "@playwright/test";

test("provider and local choices reset the journey and explain the matching carrier", async ({
  page,
}) => {
  await page.goto("/practice/connections");
  await page.getByRole("button", { name: "Fiber link", exact: true }).click();
  await expect(page.locator(".signal-view")).toContainText("Light signals");
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(page.locator(".access-ip")).toContainText("80 → 62000");
  await page.getByRole("button", { name: "Arrived", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Next step", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /^DSL Copper/ }).click();
  await expect(page.getByLabel("Technology journey timeline")).toHaveValue("0");
  await page.getByRole("button", { name: "DSL link", exact: true }).click();
  await expect(page.locator(".signal-view")).toContainText(
    "Electrical signals · Copper telephone pair",
  );
  await page.getByRole("button", { name: /^Cable Coaxial/ }).click();
  await page.getByRole("button", { name: /^Ethernet Electrical/ }).click();
  await page.getByLabel("Equipment layout").selectOption("separate");
  await expect(page.locator(".access-story")).toContainText(
    "The access point is not used",
  );
  await page.getByRole("button", { name: "Cable link", exact: true }).click();
  await expect(page.locator(".signal-view")).toContainText(
    "Electrical signals · Coaxial cable",
  );
  await page.getByRole("button", { name: "Play journey", exact: true }).click();
  await page
    .getByText("What are the parts inside my home box?", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play journey", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
