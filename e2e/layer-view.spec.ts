import { test, expect, type Page } from "@playwright/test";

/** Shows every event, then selects one from the Steps tab by its accessible name. */
async function goToEvent(page: Page, name: RegExp) {
  await page.getByRole("radio", { name: "Every event" }).click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.locator(".event-list").getByRole("button", { name }).first().click();
}
const view = (page: Page) => page.getByRole("region", { name: "Layers at this step" });
const packetTab = (page: Page) => page.getByRole("button", { name: "Packet", exact: true }).click();

test("the layers of one real message: built by the host, unwrapped and re-framed by the router, translated by NAT", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Destination").fill("http://198.51.100.20/");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  // The PC builds the data segment around the HTTP request.
  await goToEvent(page, /Create TCP segment/);
  await packetTab(page);
  await expect(view(page)).toContainText("TCP segment carrying HTTP request.");
  await expect(view(page)).toContainText("Your PC added the TCP segment.");
  await expect(view(page).locator(".layer-box.is-added")).toHaveText(/TCP segment/);
  // The router takes the frame off and lowers the TTL.
  await goToEvent(page, /Decrease TTL/);
  await packetTab(page);
  await expect(view(page)).toContainText("Home router's network interface removed the Ethernet frame it arrived in.");
  await expect(view(page)).toContainText("Home router changed TTL in the IPv4 packet: 64 → 63.");
  await expect(view(page).locator(".layer-box.is-removed")).toHaveText(/Ethernet frame/);
  await expect(view(page).locator(".layer-box-field")).toHaveText("TTL 64 → 63");
  // NAT rewrites the source.
  await goToEvent(page, /Translate source with NAT/);
  await packetTab(page);
  await expect(view(page)).toContainText("Home router changed Source IP in the IPv4 packet: 192.168.1.10 → 203.0.113.2.");
  await page.screenshot({ path: test.info().outputPath("nat.png"), fullPage: false });
  // It leaves in a new frame with new MAC addresses.
  await page.locator(".packet-trip").getByRole("button", { name: /Home router → ISP router/ }).click();
  await expect(view(page)).toContainText("Home router sent it in a new Ethernet frame, not the Ethernet frame it arrived in: Source MAC");
  await view(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: test.info().outputPath("reframe.png") });
});

test("a ping has no TCP, and its first step says the layers were not recorded being added", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Traffic type").selectOption("ping");
  await page.getByLabel("Destination").fill("198.51.100.20");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await goToEvent(page, /Choose a route/);
  await packetTab(page);
  await expect(view(page)).toContainText("IPv4 packet carrying ICMP message carrying Echo request. No TCP or UDP in this message.");
  await expect(view(page)).toContainText("first appears here with these layers");
});

test("the layer view is reached by keyboard and does not animate with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await goToEvent(page, /Decrease TTL/);
  await page.locator(".journey-card").getByRole("button", { name: /Inspect packet/ }).focus();
  await page.keyboard.press("Enter");
  await expect(view(page).locator(".layer-box.is-removed")).toHaveCount(1);
  const animating = await page.evaluate(() => document.querySelectorAll(".layer-view .layer-box").length && [...document.querySelectorAll(".layer-view .layer-box")].some((el) => el.getAnimations().length > 0));
  expect(animating).toBe(false);
});
