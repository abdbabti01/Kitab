import { expect, test, type Page } from "@playwright/test";
import "../src/learning/engines/index.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { resolveTrack } from "../src/learning/lessons/runtime.ts";
import type { PacketJourneyData } from "../src/learning/engines/packet-journey.ts";

const hello = findLesson("hello-tcp")!;
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error.message));
  page.on("console", (message) => {
    // The plain dev server has no Worker, so /api calls fail by design.
    if (message.type() === "error" && !/Failed to load resource|\/api\//.test(message.text())) list.push(message.text());
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), "console/page errors").toEqual([]);
});

const title = (page: Page) => page.locator("#step-title");
const next = (page: Page) => page.locator(".lesson-controls .next-button");

async function open(page: Page, path = "/learn/hello-tcp") {
  await page.goto(path);
  await expect(title(page)).toBeVisible();
}

test("a beginner follows all recorded Packet Journey events", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "Exhaustive value check runs once; other sizes run the journey below.");
  await open(page);
  const track = resolveTrack(hello, {});
  test.setTimeout(90_000);
  for (const [index, step] of track.steps.entries()) {
    await expect(title(page)).toHaveText(step.title);
    await expect(page.locator(".step-what")).toHaveText(step.what);
    await expect(page.locator(".step-position")).toHaveText(`${index + 1} / ${track.steps.length}`);
    const frame = track.trace.frames[step.frameIndex].data as PacketJourneyData;
    await expect(page.getByTestId("packet-location")).toHaveText(frame.location);
    if (frame.showIp) await expect(page.getByRole("button", { name: "IPv4 header" })).toContainText(`TTL ${frame.event.wire.ttl}`);
    if (frame.showTcp) await expect(page.getByRole("button", { name: "TCP header" })).toContainText(`seq ${frame.event.wire.sequence}`);
    if (index < track.steps.length - 1) await next(page).click();
  }
  await expect(page.locator(".completion")).toContainText("Walkthrough completed");
  await expect(page.locator(".completion")).toContainText("Mastery not shown yet");
});

test("the journey works at this screen size: keyboard and touch-sized controls reach the end", async ({ page }) => {
  await open(page);
  const box = await next(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.locator(".chapter-pill", { hasText: "Display the reply" }).click();
  for (let index = 0; index < 3; index += 1) await next(page).click();
  await expect(title(page)).toHaveText("Display the response body");
  await expect(page.locator(".packet-result")).toHaveText("Hello Babti");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("the request goes from HTTP bytes to a TCP segment to an IPv4 packet", async ({ page }) => {
  await open(page);
  await page.locator(".chapter-pill", { hasText: "HTTP request" }).click();
  await expect(page.getByRole("button", { name: "HTTP payload" })).toContainText("49 B");
  await next(page).click();
  await expect(page.getByRole("button", { name: "TCP header" })).toContainText("52 B");
  await next(page).click();
  await next(page).click();
  await expect(page.getByRole("button", { name: "IPv4 header" })).toContainText("72 B");
  await page.locator(".packet-source summary").click();
  await expect(page.locator(".packet-source")).toContainText("Ipv4.CreatePacket");
  await next(page).click();
  await expect(page.getByTestId("packet-location")).toHaveText("Routing table");
  await next(page).click();
  await expect(page.getByRole("button", { name: "IPv4 header" })).toContainText("TTL 63");
  await next(page).click();
  await expect(page.getByRole("button", { name: "IPv4 header" })).toHaveCount(0);
  await next(page).click();
  await next(page).click();
  await expect(page.getByRole("button", { name: "TCP header" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "HTTP payload" })).toContainText("32 B");
});

test("opening a level explains it, keeps the place, and returns to the journey", async ({ page }) => {
  await open(page);
  for (let index = 0; index < 9; index += 1) await next(page).click();
  const before = await title(page).textContent();
  await page.locator(".level-button", { hasText: "IPv4" }).click();
  await expect(page.locator(".level-panel")).toContainText("Routers work at this level");
  await expect(title(page)).toHaveText(before!);
  await page.getByRole("button", { name: "Explore these steps" }).click();
  await expect(page.locator(".step-who .level-badge")).toHaveText("IPv4 level");
  await next(page).click();
  await expect(page.locator(".step-who .level-badge")).toHaveText("IPv4 level");
  await page.getByRole("button", { name: /^Back to the journey/ }).click();
  await expect(title(page)).toHaveText(before!);
  await expect(page.locator(".level-panel")).toHaveCount(0);
});

test("Back, Replay and rapid keyboard input stay consistent; refresh restores the place", async ({ page }, info) => {
  test.skip(info.project.name === "phone-390", "Arrow-key shortcuts are a desktop/keyboard feature.");
  await open(page);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  for (let index = 0; index < 15; index += 1) await page.keyboard.press("ArrowRight");
  await expect(page.locator(".step-position")).toHaveText("16 / 130");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".step-position")).toHaveText("15 / 130");
  const here = await title(page).textContent();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator(".replay-tag")).toContainText("Before:");
  await expect(page.locator(".replay-tag")).toHaveCount(0);
  await expect(title(page)).toHaveText(here!);
  await page.reload();
  await expect(title(page)).toHaveText(here!);
  await expect(page.locator(".step-position")).toHaveText("15 / 130");
});

test("finishing Packet Journey records lesson progress and links to TCP practice", async ({ page }) => {
  await open(page);
  for (const chapter of ["TCP handshake", "HTTP request", "HTTP response", "Display the reply"]) {
    await page.locator(".chapter-pill", { hasText: chapter }).click();
  }
  for (let index = 0; index < 3; index += 1) await next(page).click();
  await expect(page.locator(".completion")).toContainText("Walkthrough completed");
  await expect(page.locator(".completion")).toContainText("Mastery not shown yet");
  for (const { missionId } of hello.practice) {
    await expect(page.locator(`.completion a[href="/missions/${missionId}"]`)).toBeVisible();
  }
  await page.goto("/");
  const card = page.locator('.journey-card[href="/learn/hello-tcp"]');
  await expect(card.locator(".status-chip")).toHaveText("Walkthrough complete");
  await expect(card).toContainText("Practice: not started");
});

test("the array walkthrough uses the same runtime and recomputes the shifts for a new position", async ({ page }) => {
  await open(page, "/learn/array-insert");
  await expect(page.locator(".level-button")).toHaveText([/Program/, /Array/, /Memory/]);
  await page.locator(".example-controls summary").click();
  await page.getByText("Index 3", { exact: true }).click();
  await page.locator(".chapter-pill", { hasText: "What it cost" }).click();
  await expect(page.locator(".step-what")).toContainText("2 values moved one slot right, then one write placed 9");
  await expect(page.locator(".step-what")).toContainText("8, 3, 12, 9, 1, 6");
});

test("changing the example during a replay shows the new example's step, not a frame of the old trace", async ({ page }) => {
  // Reduced motion keeps the replay on screen long enough to change the example mid-replay.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "/learn/array-insert");
  await page.locator(".example-controls summary").click();
  while (!/now holds 9/.test(await page.locator(".step-what").innerText())) await next(page).click();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator(".replay-tag")).toBeVisible();
  await page.getByText("Index 3", { exact: true }).click();
  await expect(page.locator(".replay-tag")).toHaveCount(0);
  await expect(title(page)).toHaveText("The request: insert 9 at index 3");
  await expect(page.locator(".stage-scene")).toBeVisible();
});

test("the example controls never widen the page: hidden radio buttons stay 1 px", async ({ page }) => {
  await open(page, "/learn/array-insert");
  await page.locator(".example-controls summary").click();
  const sizes = await page.locator('.example-controls input[type="radio"]').evaluateAll((inputs) => inputs.map((input) => input.getBoundingClientRect().width));
  expect(sizes.length).toBeGreaterThan(0);
  for (const width of sizes) expect(width).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
});

test("without AI the follow-up question returns Kitab's reviewed explanation, clearly labelled", async ({ page }) => {
  await open(page);
  await page.getByLabel(/Ask a follow-up question/).fill("What is a program?");
  await page.getByRole("button", { name: "Ask Kitab" }).click();
  await expect(page.locator(".tutor-answer")).toContainText("couldn't be reached, so this is the reviewed explanation");
  await expect(page.locator(".tutor-answer")).toContainText("The server app creates a socket object");
});

test("reduced motion: steps change without animation and Replay still shows the before state", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  for (let index = 0; index < 13; index += 1) await next(page).click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator(".replay-tag")).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});

test("keyboard users see focus on the controls and can operate them", async ({ page }, info) => {
  test.skip(info.project.name === "phone-390", "Keyboard check runs on keyboard-sized layouts.");
  await open(page);
  await next(page).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".step-position")).toHaveText("2 / 130");
  const outline = await next(page).evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});
