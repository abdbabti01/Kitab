import { test, expect, type Page } from "@playwright/test";
import { toLast, openSteps } from "./track.ts";

// The packet on the diagram is its recorded layers, and the panel beside the diagram explains the step (Now), the
// message (Packet) and a device (Device). Indexes below are events of the starters' own runs.

const segments = (page: Page) => page.locator(".packet-token .packet-seg:not(.is-gone) text").allTextContents();
const note = (page: Page) => page.locator(".packet-token .packet-note text");
async function everyEvent(page: Page, starter = "") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/practice/network${starter}`);
}
async function sendAndHold(page: Page) {
  await page.locator(".journey-start").click();
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.getByRole("radio", { name: "Every event" }).click();
}
const goTo = (page: Page, i: number) => page.getByLabel("Journey timeline").fill(String(i));
/** The index of the first event with this title, read from the Steps list. */
async function indexOf(page: Page, title: string) {
  await toLast(page);
  await openSteps(page);
  const titles = await page.locator(".event-list button b").allTextContents();
  await page.getByRole("button", { name: "Now", exact: true }).click();
  return titles.indexOf(title);
}

test("an ARP frame carries no IP, TCP or UDP; a router takes the frame off, lowers the TTL and sends a new frame", async ({ page }) => {
  await everyEvent(page, "?starter=routed");
  await sendAndHold(page);
  // Event 4: Your PC's ARP broadcast crosses its link, in a frame added at this step.
  await goTo(page, 3);
  expect(await segments(page)).toEqual(["Eth", "ARP"]);
  await expect(note(page)).toHaveText("+ Eth");
  // Event 13 (Decrease TTL): the router has taken the Ethernet frame off and lowered the TTL.
  await goTo(page, 12);
  expect(await segments(page)).toEqual(["IP", "ICMP", "Echo"]);
  await expect(note(page)).toHaveText("− Eth  TTL 64→63");
  await expect(page.locator(".packet-token .packet-seg.is-changed text")).toHaveText("IP");
  // Event 23: the same packet leaves for the office server in a new frame.
  await goTo(page, 22);
  expect(await segments(page)).toEqual(["Eth", "IP", "ICMP", "Echo"]);
  await expect(note(page)).toHaveText("new Eth");
  // Scrubbing back and forth shows each step's own state, with nothing left over from another step.
  await goTo(page, 11);
  await expect(note(page)).toHaveCount(0);
  await goTo(page, 12);
  await expect(note(page)).toHaveText("− Eth  TTL 64→63");
  await expect(page.locator(".packet-token .packet-seg.is-added, .packet-token .packet-seg.is-replaced")).toHaveCount(0);
});

test("an HTTP request is drawn as Ethernet, IP, TCP and HTTP; DHCP over Wi-Fi as Wi-Fi, IP, UDP and DHCP", async ({ page }) => {
  await everyEvent(page);
  await sendAndHold(page);
  const write = await indexOf(page, "Write application bytes");
  expect(write).toBeGreaterThan(0);
  // From the moment the request is written, find the first step it crosses a link.
  let found = false;
  for (let i = write; i < write + 40 && !found; i++) {
    await goTo(page, i);
    const label = await page.evaluate(() => document.querySelector(".packet-token:not(.is-held)")?.getAttribute("aria-label") ?? null);
    if (label?.includes("HTTP request")) {
      expect(await segments(page)).toEqual(["Eth", "IP", "TCP", "HTTP"]);
      found = true;
    }
  }
  expect(found).toBe(true);
  await everyEvent(page, "?starter=wifi");
  await sendAndHold(page);
  // The first DHCP message crossing a link (the phone first builds it, before any frame is added).
  let dhcp = false;
  for (let i = 0; i < 30 && !dhcp; i++) {
    await goTo(page, i);
    const moving = await page.evaluate(() => !!document.querySelector(".packet-token:not(.is-held)"));
    const s = await segments(page);
    if (moving && s.includes("DHCP")) {
      expect(s).toEqual(["Wi-Fi", "IP", "UDP", "DHCP"]);
      dhcp = true;
    }
  }
  expect(dhcp).toBe(true);
});

test("NAT is shown where the home router translates the source address", async ({ page }) => {
  await everyEvent(page);
  await sendAndHold(page);
  const nat = await indexOf(page, "Translate source with NAT");
  await goTo(page, nat);
  await expect(note(page)).toContainText("src → 203.0.113.2:");
  await page.getByRole("button", { name: "Packet", exact: true }).click();
  await expect(page.locator(".layer-log")).toContainText("Source IP");
});

test("the panel follows what the learner chooses: the step, the packet, a device", async ({ page }) => {
  await everyEvent(page, "?starter=routed");
  await page.locator(".journey-start").click();
  // Sending shows Now: which device acts, what it does, and what comes next.
  await expect(page.getByRole("button", { name: "Now", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".journey-card")).toBeVisible();
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.getByRole("radio", { name: "Every event" }).click();
  await goTo(page, 12);
  await expect(page.locator(".journey-next")).toHaveText("Next: Router · Choose a route");
  // The packet opens Packet, with its addresses at each level; focus stays where it was.
  await page.locator(".packet-token").click({ force: true });
  await expect(page.getByRole("button", { name: "Packet", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Addresses" })).toContainText("192.168.1.10 (Your PC) → 192.168.2.20 (Office server)");
  // A device opens Device: its role, its interfaces and tables at this step, then its settings.
  await page.getByRole("button", { name: "Select Router", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Device", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Select Router", exact: true })).toBeFocused();
  const device = page.locator(".network-inspector");
  await expect(device.getByRole("heading", { name: "State at this step" })).toBeVisible();
  await expect(device.locator(".state-tables")).toContainText("192.168.2.1/24");
  await expect(device.locator(".state-tables")).toContainText("ARP cache");
});

test("with predictions on, Now says what comes next only once the answer is given", async ({ page }) => {
  await everyEvent(page);
  await page.getByLabel("Predict as you go").check();
  await page.locator(".journey-start").click();
  await expect(page.getByRole("region", { name: "Prediction", exact: true })).toBeVisible();
  await expect(page.locator(".journey-next")).toHaveText("Next: Waiting for your prediction.");
});

test("on a phone the panel sits right under the diagram, and the packet opens it", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-390", "Phone layout");
  await everyEvent(page, "?starter=routed");
  await sendAndHold(page);
  await goTo(page, 12);
  await page.locator(".packet-token").click({ force: true });
  const controls = (await page.locator(".journey-controls").boundingBox())!;
  const panel = (await page.locator(".network-inspector").boundingBox())!;
  // Nothing between the playback controls and the panel but the view options.
  expect(panel.y - (controls.y + controls.height)).toBeLessThan(160);
  await expect(page.getByRole("region", { name: "Addresses" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The packet stays small enough not to cover half the diagram.
  const token = (await page.locator(".packet-token .packet-shape").boundingBox())!;
  const svg = (await page.locator(".topology-svg").boundingBox())!;
  expect(token.width).toBeLessThan(svg.width * 0.45);
});

test("the short tags are explained beside the network, with the names this packet's layers were recorded with", async ({ page }) => {
  await everyEvent(page, "?starter=routed");
  await sendAndHold(page);
  // An ARP broadcast: Now names its two layers; Packet says what each tag stands for and does. No TCP or UDP anywhere.
  await goTo(page, 3);
  await expect(page.locator(".journey-carrying")).toHaveText("Eth Ethernet frame › ARP ARP request");
  await page.locator(".packet-token").click({ force: true });
  const key = page.getByRole("region", { name: "Reading this packet" });
  await expect(key.locator("li")).toHaveCount(2);
  await expect(key).toContainText("Ethernet frame (Ethernet): carries it across this one link");
  await expect(key).toContainText("ARP request (Address Resolution Protocol)");
  await expect(key).not.toContainText(/TCP|UDP/);
  // At the router the frame is gone: IP, ICMP and the echo request, each explained.
  await goTo(page, 12);
  await expect(key.locator("li")).toHaveCount(3);
  await expect(key).toContainText("IPv4 packet (Internet Protocol, version 4)");
  await expect(key).toContainText("Echo request (ICMP echo)");
});

test("while a frame crosses a link, the two devices' names are drawn above it", async ({ page }) => {
  await everyEvent(page, "?starter=wifi");
  await sendAndHold(page);
  for (let i = 0; i < 30; i++) {
    await goTo(page, i);
    const label = await page.evaluate(() => document.querySelector(".packet-token:not(.is-held)")?.getAttribute("aria-label") ?? "");
    const m = /frame from (.+) to (.+?)(,|:|\.)/.exec(label);
    if (!m) continue;
    const over = await page.locator("[data-labels-for]").evaluateAll((gs) => gs.map((g) => g.querySelector(".device-name")!.textContent));
    expect(over.sort()).toEqual([m[1], m[2]].sort());
    // Drawn after the packet, so above it.
    expect(await page.evaluate(() => {
      const tok = document.querySelector(".packet-token")!, over = document.querySelector("[data-labels-for]")!;
      return !!(tok.compareDocumentPosition(over) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    return;
  }
  throw new Error("no frame crossed a link");
});
