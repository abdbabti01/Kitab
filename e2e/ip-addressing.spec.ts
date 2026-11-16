import { expect, test } from "@playwright/test";
import { goToChapter } from "./lesson.ts";

test("changing the printer’s subnet changes the hop and preserves the packet destination", async ({ page }) => {
  // Replaced by Lessons 1 and 2, it is no longer on the path but still opens at its address.
  await page.goto("/");
  await expect(page.locator(".path-activity", { hasText: "IP Addresses & Subnets" })).toHaveCount(0);
  await page.goto("/learn/ip-addressing");
  await expect(page.locator(".lesson-replaced")).toContainText("This lesson has been replaced by");
  await expect(page.getByRole("button", { name: "PC Wi-Fi interface" })).toBeVisible();
  await page.getByRole("button", { name: "PC Wi-Fi interface" }).click();
  await expect(page.locator(".object-panel")).toContainText("192.168.1.10");
  await goToChapter(page, "Choose a route");

  const scene = page.locator(".ip-scene");
  await expect(scene).toContainText("Direct on the LAN");
  await expect(scene.locator(".ip-chosen")).toContainText("192.168.1.0/24");
  await page.getByText("Change the example", { exact: true }).click();
  await page.getByText("/25 · LAN split into two subnets", { exact: true }).click();
  await expect(scene).toContainText("Via the default gateway");
  await expect(scene.locator(".ip-chosen")).toContainText("192.168.1.1");
  await expect(scene).toContainText("192.168.1.130");
  // A real split: the router has an interface in the printer's half and delivers from there.
  await expect(scene).toContainText("The router has an interface in the printer's subnet, 192.168.1.129/25");
  await page.reload();
  await expect(scene).toContainText("Via the default gateway");

  await goToChapter(page, "Read an address");
  await page.locator(".lesson-controls .next-button").click();
  await expect(scene).toContainText("255.255.255.128");
  await expect(scene).toContainText("192.168.1.128");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the router translates the reply and the lesson opens the original Packet Journey", async ({ page }) => {
  await page.goto("/learn/ip-addressing");
  await goToChapter(page, "Follow NAT");

  const packet = page.locator(".ip-packet");
  await expect(packet.locator(".ip-chosen")).toHaveText("203.0.113.8:62001");
  await page.locator(".lesson-controls .next-button").click();
  await expect(packet.locator(".ip-chosen")).toHaveText("192.168.1.10:51514");
  await page.locator(".lesson-controls .next-button").click();
  await expect(page.locator(".ip-scene")).toContainText("Ipv4.LookupRoute()");
  await page.getByRole("link", { name: "Next lesson: Packet Journey" }).click();
  await expect(page).toHaveURL(/\/learn\/hello-tcp$/);
  await expect(page).toHaveTitle("Packet Journey · C# Walkthrough");
  await page.getByRole("button", { name: "Watch first request chunk" }).click();
  await page.locator("#next").click();
  await page.locator("#next").click();
  await expect(page.locator("#step-title")).toHaveText("Look up the next hop");
});
