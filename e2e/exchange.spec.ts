import { test, expect, type Page } from "@playwright/test";
import { openExchange, toLast } from "./track.ts";

const exchange = (page: Page) => page.getByRole("region", { name: "Protocol exchange" });
const rows = (page: Page) => exchange(page).locator(".exchange-row");
const active = (page: Page) => exchange(page).locator(".exchange-row[aria-current]");
async function send(page: Page, target = "http://kitab.test/") {
  await page.getByLabel("Destination").fill(target);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
}

test("the exchange is loaded on demand and shows ARP, DNS and TCP as the trace records them", async ({ page }) => {
  const loaded: string[] = [];
  page.on("request", (r) => r.url().includes("ExchangeView") && loaded.push(r.url()));
  await page.goto("/practice/network");
  await send(page);
  await expect(page.getByRole("radio", { name: "Summary" })).toBeVisible();
  expect(loaded).toEqual([]);
  // While the run plays for the first time, the table holds only what has been sent so far.
  await page.getByRole("button", { name: "Open full exchange" }).click();
  await page.getByRole("button", { name: "First event", exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await openExchange(page);
  await expect(rows(page)).toHaveCount(23);
  expect(loaded.length).toBeGreaterThan(0);
  await expect(rows(page).nth(0)).toHaveAccessibleName(
    "Message 1 of 23: broadcast ARP request from Your PC, received by Home router and Your phone, sent on by Home switch and Wi-Fi access point.",
  );
  await expect(rows(page).nth(1)).toHaveAccessibleName(/^Message 2 of 23: ARP reply from Home router, delivered to Your PC/);
  await expect(rows(page).nth(2)).toHaveAccessibleName(/^Message 3 of 23: DNS query from Your PC, delivered to DNS server, sent on by Home switch, Home router, ISP router and Datacenter switch\.$/);
  await expect(rows(page).filter({ hasText: /^TCP SYN Seq/ })).toHaveCount(1);
  await expect(rows(page).filter({ hasText: "TCP SYN-ACK" })).toHaveAccessibleName(/from kitab\.test, delivered to Your PC/);
  // Opening it is remembered.
  await page.reload();
  await send(page);
  await expect(page.getByRole("button", { name: "Close full exchange" })).toHaveAttribute("aria-expanded", "true");
  await toLast(page);
  await expect(rows(page)).toHaveCount(23);
});

test("selecting a message moves the Journey to its real event and opens its packet; the Journey moves the highlight", async ({ page }) => {
  await page.goto("/practice/network");
  await send(page);
  await openExchange(page);
  await rows(page).filter({ hasText: "DNS query" }).click();
  // The Journey is on the DNS query's first transmission (Your PC sends it), the Packet tab shows that packet.
  await expect(page.locator(".network-device.is-sender")).toHaveAttribute("aria-label", "Select Your PC");
  await expect(page.getByRole("button", { name: "Packet", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".network-inspector")).toContainText("198.51.100.53");
  await expect(active(page)).toContainText("DNS query");
  // Its recorded steps: sent, forwarded, delivered. Each one moves the Journey.
  const steps = exchange(page).getByRole("list", { name: "Steps of message 3" });
  await expect(steps.getByRole("button")).toHaveText([
    "Your PC sent it to Home switch",
    "Home switch sent it on to Home router",
    "Home router sent it on to ISP router",
    "ISP router sent it on to Datacenter switch",
    "Datacenter switch sent it on to DNS server",
    "DNS server delivered it",
  ]);
  await steps.getByRole("button", { name: "Home router sent it on to ISP router" }).click();
  await expect(page.locator(".network-device.is-sender")).toHaveAttribute("aria-label", "Select Home router");
  await expect(steps.getByRole("button", { name: "Home router sent it on to ISP router" })).toHaveAttribute("aria-current", "step");
  // Moving the Journey moves the highlight to the message of the current event (positions from the recorded trace).
  const timeline = page.getByLabel("Journey timeline");
  await timeline.fill("39"); // the ISP router sends its ARP reply
  await expect(active(page)).toHaveAccessibleName(/^Message 5 of 23: ARP reply from ISP router, delivered to Home router\.$/);
  await timeline.fill("106"); // the PC sends the SYN
  await expect(active(page)).toHaveAccessibleName(/^Message 9 of 23: TCP SYN from Your PC/);
  // Steps that belong to no message (opening the socket, the end of the journey) highlight none.
  await timeline.fill("101");
  await expect(active(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Last event", exact: true }).click();
  await expect(active(page)).toHaveCount(0);
});

test("a lost segment is marked and linked to its retransmission", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Drop one data segment").check();
  await send(page);
  await openExchange(page);
  const lost = rows(page).filter({ hasText: "lost" });
  await expect(lost).toHaveAccessibleName(/HTTP request · TCP PSH, ACK from Your PC, lost on the link from Your PC to Home switch\.$/);
  await expect(lost.locator(".exchange-line.is-lost")).toHaveCount(1);
  await lost.click();
  await exchange(page).getByRole("button", { name: "Show the retransmission" }).click();
  await expect(active(page)).toHaveAccessibleName(/It resends message 14, which was lost\.$/);
  await expect(page.locator(".network-device.is-sender")).toHaveAttribute("aria-label", "Select Your PC");
  await exchange(page).getByRole("button", { name: "Show the lost one" }).click();
  await expect(active(page)).toContainText("lost");
});

test("broadcast DHCP reaches every host, and a failed run ends with where it stopped", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Source device").selectOption("phone");
  await page.getByLabel("Traffic type").selectOption("dhcp");
  await page.getByRole("button", { name: "Configure automatically", exact: true }).click();
  await openExchange(page);
  await expect(rows(page)).toHaveText([/^DHCP Discover/, /^DHCP Offer/, /^DHCP Request/, /^DHCP ACK/]);
  await expect(rows(page).nth(3)).toHaveAccessibleName(/broadcast DHCP ACK from Home router, delivered to Your phone; received by Your PC/);
  await expect(rows(page).nth(0).locator(".exchange-head")).toHaveCount(2);
  // A ping to an address nobody has: the run stops, and the exchange says where.
  await page.getByLabel("Source device").selectOption("pc");
  await page.getByLabel("Traffic type").selectOption("ping");
  await send(page, "192.168.1.77");
  await toLast(page);
  await expect(exchange(page).locator(".exchange-stop")).toContainText("Delivery stopped at Your PC");
});

test("messages are reachable by keyboard with a visible focus, and the page never scrolls sideways", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  await send(page);
  await openExchange(page);
  await rows(page).first().focus();
  await expect(rows(page).first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(2)).toBeFocused();
  expect(await rows(page).nth(2).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(rows(page).nth(2)).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press(" ");
  await expect(rows(page).nth(3)).toHaveAttribute("aria-current", "step");
  // Nothing animates, and the page itself is never wider than the screen.
  expect(await page.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect)?.target?.closest?.(".exchange")).length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // Rows are comfortable touch targets, and a tap selects one.
  for (const box of await rows(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
  const row = rows(page).nth(5);
  await row.scrollIntoViewIfNeeded();
  if (info.project.use.hasTouch) await row.tap();
  else await row.click();
  await expect(row).toHaveAttribute("aria-current", "step");
  await exchange(page).screenshot({ path: info.outputPath("exchange.png") });
});
