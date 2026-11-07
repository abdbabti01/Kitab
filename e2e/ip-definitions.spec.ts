import { expect, test } from "@playwright/test";

test("networking terms explain their meaning and purpose before the calculations", async ({ page }) => {
  await page.goto("/learn/ip-addressing");
  const term = page.locator(".key-concept");
  await expect(term.getByRole("heading", { name: "LAN", exact: true })).toBeVisible();
  await expect(term).toContainText("Why we use it");
  const next = page.locator(".lesson-controls .next-button");
  await next.click();
  await expect(term.getByRole("heading", { name: "IP address", exact: true })).toBeVisible();
  await next.click();
  await expect(term.getByRole("heading", { name: "Subnet", exact: true })).toBeVisible();
  await expect(term).toContainText("a block of IP addresses");
  await expect(term).toContainText("directly");
  await expect(term).toContainText("192.168.1.0/24");
  await expect(page.locator(".ip-scene")).toContainText("192.168.1.0/24");
  await expect(page.locator(".ip-scene .ip-bits")).toHaveCount(0);
  await page.getByText("Change the example", { exact: true }).click();
  await page.getByText("/25 · split subnets", { exact: true }).click();
  await expect(page.locator(".ip-scene")).toContainText("192.168.1.0/25");
  await expect(page.locator(".ip-scene")).toContainText("Outside this subnet");

  await page.locator(".chapter-pill", { hasText: "Follow NAT" }).click();
  await expect(term.getByRole("heading", { name: "NAT", exact: true })).toBeVisible();
  await expect(term).toContainText("share one public IP address");
  await term.getByRole("link", { name: "See all terms" }).click();
  const glossary = page.locator(".lesson-term-reference");
  await expect(glossary.getByRole("heading", { name: "Default gateway", exact: true })).toBeVisible();
  await expect(glossary.getByRole("heading", { name: "ARP", exact: true })).toBeVisible();
});
