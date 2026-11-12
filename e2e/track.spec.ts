import { test, expect, type Page } from "@playwright/test";
import { openSteps, toLast } from "./track.ts";
import { starter, starterOptions } from "../src/practice/network/starters.ts";
import { runSequence } from "../src/practice/network/mission-assess.ts";

// The track under the diagram: its arrows are the trace's link crossings, and it moves only the Journey.
const timeline = (page: Page) => page.getByLabel("Journey timeline");
const plot = (page: Page) => page.locator(".track-plot");
const arrows = (page: Page) => page.locator(".track-arrow");
const sender = (page: Page) => page.locator(".network-device.is-sender");
const tab = (page: Page, name: string) => page.locator(".inspector-tabs").getByRole("button", { name, exact: true });
async function sendAndHold(page: Page, query = "") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/practice/network${query}`);
  await page.locator(".journey-start").click();
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.getByRole("radio", { name: "Every event" }).click();
}
/** [index, from, to] of every arrow the track shows. */
const shown = (page: Page) =>
  arrows(page).evaluateAll((els) => els.map((e) => [Number(e.getAttribute("data-index")), e.getAttribute("data-from"), e.getAttribute("data-to")] as const));

test("every arrow is a recorded link crossing, shown at its own event, never a shortcut across the routers", async ({ page }) => {
  const network = starter("routed");
  const trace = runSequence(network, [starterOptions.find((s) => s.id === "routed")!.steps![0].action]);
  const crossings = trace.events.flatMap((e, i) => (e.hop && e.packet ? [[i, e.hop.from, e.hop.to] as const] : []));
  const name = (id: string) => network.devices.find((d) => d.id === id)!.name;
  await sendAndHold(page, "?starter=routed");
  await toLast(page);
  await expect(page.locator(".track-steps summary")).toHaveText(`All steps (${trace.events.length})`);
  for (const [i, from, to] of crossings) {
    await timeline(page).fill(String(i));
    const arrow = page.locator(`.track-arrow[data-index="${i}"]`);
    await expect(arrow).toHaveClass(/is-current/);
    await expect(arrow).toHaveAttribute("data-from", from);
    await expect(arrow).toHaveAttribute("data-to", to);
    // The diagram shows the same transmission.
    await expect(sender(page)).toHaveAttribute("aria-label", `Select ${name(from)}`);
    // Every arrow on screen is one of the recorded crossings, between two devices that share a link.
    for (const a of await shown(page)) expect(crossings).toContainEqual(a);
  }
  // The PC never reaches the office server directly: its frames go to the switch, and the router sends them on.
  expect(crossings.some(([, f, t]) => f === "pc" && t === "server")).toBe(false);
  await timeline(page).fill(String(crossings.at(-1)![0]));
  await expect(page.locator(".track-arrow.is-forwarded").first()).toBeAttached();
});

test("choosing an arrow, a key or a step moves the one Journey: diagram, Now and Packet follow", async ({ page }, info) => {
  await sendAndHold(page);
  await toLast(page);
  await timeline(page).fill("20");
  // Choose the first arrow on screen with a pointer.
  const first = arrows(page).first();
  const i = Number(await first.getAttribute("data-index"));
  await first.scrollIntoViewIfNeeded();
  const box = (await first.locator("line").boundingBox())!;
  if (info.project.use.hasTouch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(timeline(page)).toHaveValue(String(i));
  await expect(first).toHaveClass(/is-current/);
  const from = await first.getAttribute("data-from");
  expect(await page.locator(`.network-device[data-device="${from}"]`).getAttribute("class")).toMatch(/is-sender/);
  // The keyboard moves to the next message; Enter opens its packet.
  await plot(page).focus();
  await page.keyboard.press("ArrowRight");
  // The next message may sit in the next window (on a phone); either way it is the current arrow.
  await expect(timeline(page)).not.toHaveValue(String(i));
  const next = await timeline(page).inputValue();
  expect(Number(next)).toBeGreaterThan(i);
  await expect(page.locator(".track-arrow.is-current")).toHaveAttribute("data-index", next);
  await expect(plot(page)).toBeFocused();
  expect(await plot(page).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  await page.keyboard.press("Enter");
  await expect(tab(page, "Packet")).toHaveAttribute("aria-pressed", "true");
  // A broadcast arrow's packet is addressed to everyone, as the Packet view shows.
  await timeline(page).fill("2");
  const broadcast = page.locator(".track-arrow.is-broadcast").first();
  await timeline(page).fill((await broadcast.getAttribute("data-index"))!);
  await expect(page.locator(".network-inspector")).toContainText("ff:ff:ff:ff:ff:ff");
  // A step chosen from the list shows it in Now.
  await openSteps(page);
  await page.locator(".event-list").getByRole("button", { name: /DNS query/ }).first().click();
  await expect(tab(page, "Now")).toHaveAttribute("aria-pressed", "true");
});

test("before a prediction, nothing later is drawn, listed or reachable; answering shows it", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Predict as you go").check();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.getByRole("region", { name: "Prediction", exact: true })).toBeVisible();
  const max = Number(await timeline(page).getAttribute("max"));
  for (const [i] of await shown(page)) expect(i).toBeLessThanOrEqual(max);
  await expect(page.locator(".track-gate-text")).toHaveText("Later steps are hidden until you predict.");
  await expect(page.locator(".track-gate")).toHaveAttribute("width", "40");
  await expect(page.locator(".track-steps summary")).toHaveText(`All steps (${max + 1})`);
  await expect(page.locator(".track-mark")).toHaveCount(0);
  // Keys cannot step past the question.
  await plot(page).focus();
  for (let k = 0; k < 5; k++) await page.keyboard.press("ArrowRight");
  expect(Number(await timeline(page).inputValue())).toBeLessThanOrEqual(max);
  // Each answer shows a little more; the ARP broadcast appears once the second question is answered.
  await page.getByRole("region", { name: "Prediction", exact: true }).getByRole("button", { name: "Show me" }).click();
  await page.getByRole("region", { name: "Prediction result" }).getByRole("button", { name: "Continue" }).click();
  // The second answer shows the ARP broadcast and its reply: the run on the track grows past the old question.
  await page.getByRole("region", { name: "Prediction", exact: true }).getByRole("button", { name: "Show me" }).click();
  expect(Number(await timeline(page).getAttribute("max"))).toBeGreaterThan(max);
  await openSteps(page);
  await expect(page.locator(".event-list").getByRole("button", { name: /ARP reply/ }).first()).toBeAttached();
});

test("loss, retransmission and a stopped run are marked from the trace", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  await page.getByLabel("Drop one data segment").check();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("radio", { name: "Every event" }).click();
  await toLast(page);
  await openSteps(page);
  await page.locator(".event-list").getByRole("button", { name: /Drop TCP data segment/ }).click();
  await expect(page.locator(".track-arrow.is-lost.is-current .track-lost")).toBeAttached();
  await openSteps(page);
  await page.locator(".event-list").getByRole("button", { name: /Retransmit TCP segment/ }).click();
  await plot(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".track-arrow.is-current .track-resent")).toHaveText("↻");
  // A ping to an address nobody has stops; the track says where.
  await page.getByLabel("Drop one data segment").uncheck();
  await page.getByLabel("Traffic type").selectOption("ping");
  await page.getByLabel("Destination").fill("192.168.1.77");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".track-mark.is-stopped")).toHaveCount(0);
  await toLast(page);
  await expect(page.locator(".track-mark.is-stopped")).toHaveCount(1);
  await expect(page.locator(".track-stage").last()).toHaveClass(/kind-stop/);
});

test("the track fits the screen: lanes scroll inside it, names are touch targets, nothing animates with reduced motion", async ({ page }) => {
  await sendAndHold(page);
  await toLast(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  const lanes = await page.locator(".track-lanes").boundingBox();
  expect(lanes!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  for (const h of await page.locator(".track-names button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
    expect(h).toBeGreaterThanOrEqual(24);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => (a.effect as KeyframeEffect)?.target?.closest?.(".track")).length)).toBe(0);
  // A lane's name selects its device.
  await page.locator(".track-names button").first().click();
  await expect(tab(page, "Device")).toHaveAttribute("aria-pressed", "true");
  // A long run shows a window of it and says which.
  await expect(page.locator(".track-range")).toHaveText(/^Events \d+–489 of 489$/);
});

test("messages are named by the layers they carry, never as an \"IP frame\"", async ({ page }) => {
  await sendAndHold(page, "?starter=routed");
  await toLast(page);
  await timeline(page).fill("6");
  await expect(page.locator(`.track-arrow[data-index="6"] title`)).toHaveText("Event 7: Router sends to Your PC: an Ethernet frame carrying an ARP reply");
  await timeline(page).fill("3");
  await expect(page.locator(`.track-arrow[data-index="3"] title`)).toHaveText("Event 4: Your PC sends to Router: a broadcast Ethernet frame carrying an ARP request");
  await timeline(page).fill("22");
  await expect(page.locator(`.track-arrow[data-index="22"] title`)).toHaveText(
    "Event 23: Router forwards to Office server: an Ethernet frame carrying an IPv4 packet, which carries an ICMP message with an Echo request",
  );
  await expect(plot(page)).toHaveAttribute("aria-label", /Selected: Router forwards to Office server: an Ethernet frame carrying an IPv4 packet/);
  for (const t of await page.locator(".track-arrow title").allTextContents()) expect(t).not.toMatch(/\b(IP|ARP|DHCP) frame\b/);
});

test("a tap picks the step under it; where steps sit closer than a finger, it asks which one", async ({ page }, info) => {
  await sendAndHold(page);
  await toLast(page);
  await timeline(page).fill("215");
  await plot(page).scrollIntoViewIfNeeded();
  // Two dots on the same lane, next to each other: internal steps of one device.
  const dots = await page.locator(".track-tick").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { i: Number(e.getAttribute("data-index")), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  const k = dots.findIndex((d, n) => n > 0 && d.i === dots[n - 1].i + 1 && Math.abs(d.y - dots[n - 1].y) < 1);
  const [p, q] = [dots[k - 1], dots[k]];
  const mid = { x: (p.x + q.x) / 2, y: p.y };
  const choose = page.getByRole("group", { name: "Steps close together" });
  if (info.project.use.hasTouch) {
    await page.touchscreen.tap(mid.x, mid.y);
    if (q.x - p.x < 32) {
      // Closer than a finger: both are offered, and the one chosen is exactly the one shown.
      await expect(choose.getByRole("button", { name: new RegExp(`^Event (${p.i + 1}|${q.i + 1}):`) })).toHaveCount(2);
      await expect(choose.getByRole("button").first()).toBeFocused();
      for (const h of await choose.getByRole("button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(36);
      // Escape closes it without moving.
      await page.keyboard.press("Escape");
      await expect(choose).toHaveCount(0);
      await expect(timeline(page)).toHaveValue("215");
      await page.touchscreen.tap(mid.x, mid.y);
      await choose.getByRole("button", { name: new RegExp(`^Event ${q.i + 1}:`) }).click();
      await expect(timeline(page)).toHaveValue(String(q.i));
      await expect(choose).toHaveCount(0);
    } else await expect(choose).toHaveCount(0);
  } else {
    // A mouse is precise: a click on a dot picks exactly that step.
    await page.mouse.click(q.x, q.y);
    await expect(timeline(page)).toHaveValue(String(q.i));
    await page.mouse.click(p.x, p.y);
    await expect(timeline(page)).toHaveValue(String(p.i));
    await expect(choose).toHaveCount(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("every stage the band shows is reachable with the keyboard alone, at the same step", async ({ page }) => {
  await sendAndHold(page, "?starter=routed");
  await toLast(page);
  await page.getByRole("radio", { name: "Summary" }).click();
  // The band goes to the last step of a stage; "Show this stage" in the list goes to the same one.
  await page.locator(".track-stage").nth(2).click();
  const byBand = await timeline(page).inputValue();
  await timeline(page).fill("0");
  await page.locator(".track-steps summary").focus();
  await page.keyboard.press("Enter");
  const stage = page.locator(".stage-list > li").nth(2);
  await stage.locator("summary").focus();
  await page.keyboard.press("Enter");
  await stage.getByRole("button", { name: "Show this stage" }).focus();
  await page.keyboard.press("Enter");
  await expect(timeline(page)).toHaveValue(byBand);
  // The band itself is a picture of the list, kept out of the accessibility tree.
  await expect(page.locator(".track-band")).toHaveAttribute("aria-hidden", "true");
});
