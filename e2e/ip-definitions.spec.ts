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
  await page.getByText("/25 · LAN split into two subnets", { exact: true }).click();
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

test("binary, AND and the two kinds of address are explained at the steps that use them", async ({ page }) => {
  await page.goto("/learn/ip-addressing");
  const term = page.locator(".key-concept");
  const chips = page.getByLabel("New terms");
  await page.locator(".chapter-pill", { hasText: "Read an address" }).click();
  await chips.getByText("Binary", { exact: true }).click();
  await expect(chips).toContainText("128, 64, 32, 16, 8, 4, 2 and 1");
  await expect(chips).toContainText("10 = 8 + 2 = 00001010");
  await page.locator(".lesson-controls .next-button").click();
  await expect(term.getByRole("heading", { name: "Subnet mask", exact: true })).toBeVisible();
  await chips.getByText("Bitwise AND", { exact: true }).click();
  await expect(chips).toContainText("10000010 AND 10000000 = 10000000 = 128");

  await page.locator(".chapter-pill", { hasText: "Choose a route" }).click();
  await page.locator(".lesson-controls .next-button").click();
  await expect(term.getByRole("heading", { name: "Why both addresses", exact: true })).toBeVisible();
  await expect(term).toContainText("The frame's MAC addresses name the two devices on the current link");
  await expect(page.locator(".step-why")).toContainText("the MACs change at every hop while the IP destination stays the same");
  await chips.getByText("MAC address", { exact: true }).click();
  await expect(chips).toContainText("random MAC for each Wi-Fi network");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
