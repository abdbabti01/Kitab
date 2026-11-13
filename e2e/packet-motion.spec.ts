import { test, expect, type Page } from "@playwright/test";
import { toLast, openSteps } from "./track.ts";

// Goes to the run's last event, whether or not playback has already reached it (the button is then disabled).
async function toEnd(page: Page) {
  const timeline = page.getByLabel("Journey timeline");
  await timeline.fill((await timeline.getAttribute("max")) ?? "0");
}

/** Shows every event, then selects one from the Steps tab by title. */
async function goToEvent(page: Page, name: RegExp) {
  await page.getByRole("radio", { name: "Every event" }).click();
  await toLast(page);
  await openSteps(page);
  await page.locator(".event-list").getByRole("button", { name }).first().click();
}
const token = (page: Page) => page.locator(".packet-token");

test("a frame crosses its real link once and can be opened to read its headers", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await goToEvent(page, /Transmit over Ethernet/);
  // The first frame is the PC's ARP broadcast for its gateway: square, labelled ARP, marked as a broadcast.
  await expect(token(page)).toHaveCount(1);
  await expect(token(page)).toHaveClass(/kind-arp/);
  await expect(token(page)).toHaveAttribute("aria-label", /^ARP broadcast frame from Your PC to /);
  await expect(token(page).locator(".packet-broadcast")).toHaveCount(1);
  // It moves once and stays at the receiver: no repeating animation.
  const motion = token(page).locator("animateMotion");
  await expect(motion).toHaveAttribute("fill", "freeze");
  expect(await motion.getAttribute("repeatCount")).toBeNull();
  await page.locator(".network-canvas").screenshot({ path: test.info().outputPath("frame.png") });
  // Selecting it opens the real headers of this step.
  await token(page).click();
  await expect(page.locator(".packet-inspector")).toContainText("ARP request");
  await expect(page.locator(".packet-inspector")).toContainText("ff:ff:ff:ff:ff:ff");
});

test("bridge decisions highlight the chosen port or every flooded copy, and a stop is marked where it happened", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await goToEvent(page, /Forward broadcast on LAN/);
  // (A vertical cable has no width, so count rather than check visibility.)
  expect(await page.locator(".network-wire.is-flood").count()).toBeGreaterThan(0);
  await expect(token(page)).toHaveClass(/is-held/);
  await goToEvent(page, /Forward using MAC table/);
  await expect(page.locator(".network-wire.is-forward")).toHaveCount(1);
  await expect(page.locator(".network-wire.is-flood")).toHaveCount(0);
  // A failing run: the stop is marked at the device where delivery stopped.
  await page.getByLabel("Starter network").selectOption("routed");
  await page.getByRole("button", { name: "Select Your PC", exact: true }).click();
  await page.getByLabel("Default gateway").fill("192.168.1.99");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await toEnd(page);
  await expect(page.locator(".packet-halt.is-stopped")).toHaveCount(1);
  await expect(page.locator(".packet-halt text")).toHaveText("Stopped");
});

test("the frame can be opened from the keyboard", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await goToEvent(page, /Transmit over Ethernet/);
  await token(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".packet-inspector")).toContainText("ARP request");
});

test("with reduced motion the frame is drawn at the receiver without moving", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await goToEvent(page, /Transmit over Ethernet/);
  await expect(token(page)).toHaveCount(1);
  await expect(token(page).locator("animateMotion")).toHaveCount(0);
  await expect(token(page)).toHaveAttribute("transform", /^translate\(/);
});

test("the frame has a finger-sized touch area that never takes taps from the device beside it", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await goToEvent(page, /Transmit over Ethernet/);
  await page.locator(".network-canvas").scrollIntoViewIfNeeded();
  const hit = await page.locator(".packet-hit").boundingBox();
  expect(hit!.width).toBeGreaterThanOrEqual(43);
  const box = (await token(page).locator(".packet-shape").boundingBox())!;
  // Just below the drawn frame: outside its shape, inside its touch area.
  const tap = { x: box.x + box.width / 2, y: box.y + box.height + 8 };
  const tapAt = (p: { x: number; y: number }) => (info.project.use.hasTouch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
  await tapAt(tap);
  await expect(page.locator(".packet-inspector")).toContainText("ARP request");
  // The receiving switch's own tile still selects the switch.
  await page.locator(".network-canvas").scrollIntoViewIfNeeded();
  const sw = (await page.locator('[data-device="switch"] .device-tile').boundingBox())!;
  await tapAt({ x: sw.x + sw.width / 2, y: sw.y + sw.height / 2 });
  await expect(page.locator('[data-device="switch"]')).toHaveClass(/selected/);
});
