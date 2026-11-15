import { test, expect, type Page } from "@playwright/test";
import { toLast, openSteps, send } from "./track.ts";

// Play → Pause → Next: pausing freezes the run at its event, and stepping by hand moves one event at a time with the
// diagram, the track and the card on that event. (Summary's Next moves a whole stage by design: see the playground spec.)
const position = (page: Page) => page.locator(".journey-position small");
async function eventNo(page: Page) {
  return Number((await position(page).innerText()).match(/^\S+ Event (\d+) of/)![1]);
}
/** Where the moving frame is now on the diagram (its animateMotion offset, apart from any camera movement), and how
 * far it is from the start of its link. */
const frameAt = (page: Page) =>
  page.locator(".packet-token:not(.is-held)").evaluate((g) => {
    const own = (g as SVGGraphicsElement).getCTM()!,
      m = (g.parentNode as SVGGraphicsElement).getCTM()!.inverse().multiply(own);
    const [x0, y0] = g.querySelector("animateMotion")!.getAttribute("values")!.split(";")[0].split(",").map(Number);
    return { x: Math.round(m.e), y: Math.round(m.f), along: Math.round(Math.hypot(m.e - x0, m.f - y0)) };
  });
async function start(page: Page) {
  await page.goto("/practice/network");
  await send(page);
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.getByRole("radio", { name: "Every event" }).click();
}

test("Pause freezes a frame where it is on its link; Play runs that event again", async ({ page }) => {
  await start(page);
  await toLast(page);
  await openSteps(page);
  await page.locator(".event-list").getByRole("button", { name: /Transmit over Ethernet/ }).first().click();
  // From the event before the first frame crosses a link, play into the crossing slowly enough to pause inside it.
  await page.getByRole("button", { name: "Previous event", exact: true }).click();
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("0.5");
  const at = await eventNo(page);
  await page.getByRole("button", { name: "Play journey" }).click();
  await expect(position(page)).toContainText(`Event ${at + 1} of`);
  await page.waitForTimeout(500);
  const moving = await frameAt(page);
  await page.getByRole("button", { name: "Pause playback" }).click();
  const paused = await frameAt(page);
  // Not sent back to the start of the link, and not carried on to the receiver while paused.
  expect(moving.along).toBeGreaterThan(0);
  expect(paused.along).toBeGreaterThanOrEqual(moving.along);
  await page.waitForTimeout(600);
  expect(await frameAt(page)).toEqual(paused);
  await expect(position(page)).toContainText(`Event ${at + 1} of`);
  // Play again: the same event, its frame leaving again in time with the event's restarted timer.
  await page.getByRole("button", { name: "Play journey" }).click();
  await page.waitForTimeout(300);
  expect(await frameAt(page)).not.toEqual(paused);
  await expect(position(page)).toContainText(`Event ${at + 1} of`);
  // Stepped to by hand while paused, the frame still crosses its link.
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.getByRole("button", { name: "Previous event", exact: true }).click();
  await page.getByRole("button", { name: "Next event", exact: true }).click();
  const leaving = await frameAt(page);
  await page.waitForTimeout(400);
  expect(await frameAt(page)).not.toEqual(leaving);
});

test("after Play and Pause each Next and Previous moves exactly one event, up to the last one", async ({ page }) => {
  await page.goto("/practice/network");
  await send(page);
  await page.getByRole("radio", { name: "Every event" }).click();
  await page.getByRole("combobox", { name: "Playback speed" }).selectOption("8");
  const next = page.getByRole("button", { name: "Next event", exact: true }),
    previous = page.getByRole("button", { name: "Previous event", exact: true }),
    play = page.getByRole("button", { name: "Play journey" }),
    pause = page.getByRole("button", { name: "Pause playback" });
  // Play and Pause again and again: the run only ever moves forward, and stays put once paused.
  await pause.click();
  let was = await eventNo(page);
  for (let c = 0; c < 6; c++) {
    await play.click();
    await page.waitForTimeout(40 * c);
    await pause.click();
    const now = await eventNo(page);
    expect(now).toBeGreaterThanOrEqual(was);
    await page.waitForTimeout(400);
    expect(await eventNo(page)).toBe(now);
    was = now;
  }
  // Rapid clicks: one event each, forward and back.
  for (let k = 1; k <= 12; k++) await next.click();
  await expect(position(page)).toContainText(`Event ${was + 12} of`);
  for (let k = 1; k <= 5; k++) await previous.click();
  await expect(position(page)).toContainText(`Event ${was + 7} of`);
  // The diagram, the track and the card all show the event the controls name.
  const title = await page.locator(".journey-position b").innerText();
  await expect(page.locator(".journey-card h2")).toHaveText(title);
  const device = await page.locator(".track-names .is-active").innerText();
  await expect(page.locator(".journey-card .eyebrow")).toContainText(device, { ignoreCase: true });
  await expect(page.getByRole("button", { name: `Select ${device}`, exact: true })).toHaveClass(/is-active/);
  // The last event: reached one step at a time, and Next stops there.
  const timeline = page.getByLabel("Journey timeline");
  const last = Number(await timeline.getAttribute("max"));
  await timeline.fill(String(last - 2));
  await next.click();
  await next.click();
  await expect(position(page)).toContainText(`Event ${last + 1} of ${last + 1}`);
  await expect(next).toBeDisabled();
  await previous.click();
  await expect(position(page)).toContainText(`Event ${last} of ${last + 1}`);
});
