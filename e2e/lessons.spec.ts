import { expect, test, type Page } from "@playwright/test";
import "../src/learning/engines/index.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { resolveTrack } from "../src/learning/lessons/runtime.ts";
import type { MessageJourneyData } from "../src/learning/engines/message-journey.ts";

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

test("a beginner follows HELLO through every step, and every visible value matches the engine", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "Exhaustive value check runs once; other sizes run the journey below.");
  await open(page);
  const track = resolveTrack(hello, {});
  for (const [index, step] of track.steps.entries()) {
    await expect(title(page)).toHaveText(step.title);
    await expect(page.locator(".step-what")).toHaveText(step.what);
    await expect(page.locator(".step-position")).toHaveText(`${index + 1} / ${track.steps.length}`);
    const s = (track.trace.frames[step.frameIndex].data as MessageJourneyData).event.snapshot;
    await expect(page.locator(".mj-inbox")).toHaveText(s.b.text ?? "Nothing yet");
    await expect(page.locator('[data-entity="endpoint-a"] b')).toHaveText(s.a.state);
    await expect(page.locator('[data-entity="endpoint-b"] b')).toHaveText(s.b.state);
    if (s.unit?.ip) await expect(page.locator(".mj-hdr.hdr-ip small")).toHaveText(`${s.unit.ip.src} → ${s.unit.ip.dst} · TTL ${s.unit.ip.ttl}`);
    if (s.unit?.tcp) await expect(page.locator(".mj-hdr.hdr-tcp small")).toContainText(`seq ${s.unit.tcp.seq}`);
    if (s.unit?.link) await expect(page.locator(".mj-trailer small")).toContainText(`${s.unit.link.frameBytes} B total`);
    if (index < track.steps.length - 1) await next(page).click();
  }
  await expect(page.locator(".completion")).toContainText("Walkthrough completed");
  await expect(page.locator(".completion")).toContainText("Mastery not shown yet");
});

test("the journey works at this screen size: keyboard and touch-sized controls reach the end", async ({ page }) => {
  await open(page);
  const total = resolveTrack(hello, {}).steps.length;
  const box = await next(page).boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // The controls are on screen without scrolling.
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  for (let index = 1; index < total; index += 1) await next(page).click();
  await expect(title(page)).toHaveText(/“HELLO” arrived/);
  await expect(page.locator(".mj-inbox")).toHaveText("HELLO");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("selecting a letter or byte reveals its real UTF-8 value and eight bits, including multi-byte characters", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Next" }).click();
  await page.locator(".chapter-pill", { hasText: "From letters to bytes" }).click();
  await next(page).click();
  await expect(page.locator(".mj-bytes button")).toHaveText(["720x48", "690x45", "760x4C", "760x4C", "790x4F"]);
  await page.locator('[data-entity="byte-4"]').click();
  await expect(page.locator(".mj-bit-row")).toHaveAttribute("aria-label", "bits 01001111");
  await expect(page.locator(".object-panel")).toContainText("“O”");

  await page.locator(".example-controls summary").click();
  await page.getByLabel("Your message").fill("é👋");
  await page.getByRole("button", { name: "Use it" }).click();
  await expect(page.locator(".mj-bytes button b")).toHaveText(["195", "169", "240", "159", "145", "139"]);
  await expect(page.locator(".step-what")).toContainText("2 characters and becomes 6 bytes: 195 169 240 159 145 139");
  await page.locator('[data-entity="char-1"]').click();
  await expect(page.locator(".mj-bit-row")).toHaveAttribute("aria-label", "bits 11110000");
  await expect(page.locator(".object-panel")).toContainText("240 159 145 139");
});

test("opening a level explains it, keeps the place, and returns to the journey", async ({ page }) => {
  await open(page);
  for (let index = 0; index < 9; index += 1) await next(page).click();
  const before = await title(page).textContent();
  await page.locator(".level-button", { hasText: "Network" }).click();
  await expect(page.locator(".level-panel")).toContainText("Routers work at this level");
  await expect(title(page)).toHaveText(before!);
  await page.getByRole("button", { name: "Explore these steps" }).click();
  await expect(page.locator(".step-who .level-badge")).toHaveText("Network level");
  await next(page).click();
  await expect(page.locator(".step-who .level-badge")).toHaveText("Network level");
  await page.getByRole("button", { name: /^Back to the journey/ }).click();
  await expect(title(page)).toHaveText(before!);
  await expect(page.locator(".level-panel")).toHaveCount(0);
});

test("Back, Replay and rapid keyboard input stay consistent; refresh restores the place", async ({ page }, info) => {
  test.skip(info.project.name === "phone-390", "Arrow-key shortcuts are a desktop/keyboard feature.");
  await open(page);
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  for (let index = 0; index < 15; index += 1) await page.keyboard.press("ArrowRight");
  await expect(page.locator(".step-position")).toHaveText("16 / 39");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".step-position")).toHaveText("15 / 39");
  const here = await title(page).textContent();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.locator(".replay-tag")).toContainText("Before:");
  await expect(page.locator(".replay-tag")).toHaveCount(0);
  await expect(title(page)).toHaveText(here!);
  await page.reload();
  await expect(title(page)).toHaveText(here!);
  await expect(page.locator(".step-position")).toHaveText("15 / 39");
});

test("finishing the walkthrough is not mastery; the experiment compares computed runs", async ({ page }) => {
  await open(page);
  for (let index = 1; index < 39; index += 1) await next(page).click();
  await page.getByRole("button", { name: /Experiment: What if the data is lost/ }).click();
  await expect(title(page)).toHaveText("Noise damages the frame on link 2");
  const steps = Number((await page.locator(".step-position").textContent())!.split("/")[1]);
  for (let index = 1; index < steps; index += 1) await next(page).click();
  const rows = page.locator(".compare tbody tr");
  await expect(rows.filter({ hasText: "Times the data was sent" })).toContainText("12");
  await expect(rows.filter({ hasText: "Final ACK at A" })).toContainText("10061006");
  await page.getByRole("button", { name: "Back to the journey" }).first().click();
  await expect(title(page)).toHaveText(/“HELLO” arrived/);

  await page.goto("/");
  await expect(page.locator(".journey-card", { hasText: "HELLO" }).locator(".status-chip")).toHaveText("Walkthrough complete");
  await expect(page.locator(".journey-card", { hasText: "HELLO" })).toContainText("Practice: not started");
  await expect(page.locator(".mission-card", { hasText: "The ACK that wouldn't move" }).locator(".status-chip")).toHaveText("New");
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

test("without AI the follow-up question returns Kitab's reviewed explanation, clearly labelled", async ({ page }) => {
  await open(page);
  await page.getByLabel(/Ask a follow-up question/).fill("What is a program?");
  await page.getByRole("button", { name: "Ask Kitab" }).click();
  await expect(page.locator(".tutor-answer")).toContainText("couldn't be reached, so this is the reviewed explanation");
  await expect(page.locator(".tutor-answer")).toContainText("Chat program A on Computer A");
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
  await expect(page.locator(".step-position")).toHaveText("2 / 39");
  const outline = await next(page).evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});
