import { expect, test, type Page } from "@playwright/test";

// Lesson 1 "Understanding IPv4 addresses and subnets" (/learn/ipv4-subnets). Every value comes from the shared helper.
const next = (page: Page) => page.locator(".lesson-controls .next-button");
const scene = (page: Page) => page.locator(".v4-scene");
async function open(page: Page, seed?: Record<string, unknown>) {
  await page.goto("/");
  await page.evaluate((items) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(items ?? {})) localStorage.setItem(key, JSON.stringify(value));
  }, seed);
  await page.goto("/learn/ipv4-subnets");
  await expect(scene(page)).toBeVisible();
}
async function toStep(page: Page, title: string) {
  for (let i = 0; i < 20 && (await page.locator("#step-title").textContent()) !== title; i++) await next(page).click();
  await expect(page.locator("#step-title")).toHaveText(title);
}
async function example(page: Page, change: { address?: string; prefix?: number; destination?: string }) {
  const panel = page.locator(".example-controls");
  if (!(await panel.evaluate((el) => (el as HTMLDetailsElement).open))) await panel.locator("summary").click();
  if (change.address !== undefined) {
    await page.getByRole("textbox", { name: "IPv4 address", exact: true }).fill(change.address);
    await page.getByRole("textbox", { name: "IPv4 address", exact: true }).press("Enter");
  }
  if (change.destination !== undefined) {
    await page.getByRole("textbox", { name: "Destination address", exact: true }).fill(change.destination);
    await page.getByRole("textbox", { name: "Destination address", exact: true }).press("Enter");
  }
  if (change.prefix !== undefined) await page.getByRole("group", { name: "Prefix length presets" }).getByRole("button", { name: `/${change.prefix}`, exact: true }).click();
}

test("the six chapters run end to end with values from the helper, and finishing records only this lesson", async ({ page }) => {
  const old = { lessonVersion: "1.1.0", visits: 1, lastVisitedAt: "t", seen: [], total: 0, chaptersSeen: [], completedAt: "2026-11-01T10:00:00.000Z", experimentsCompleted: [], position: null, updated: false };
  await open(page, { "kitab.learning.v1": { version: 1, lessons: { "ip-addressing": old } } });
  await expect(page).toHaveTitle("Understanding IPv4 addresses and subnets · Kitab");
  await expect(page.locator(".chapter-pill")).toHaveText([/Address & interface/, /Bits and octets/, /Prefix & mask/, /Network & broadcast/, /Special cases/, /Local or remote\?/]);
  await expect(page.locator(".step-what")).toContainText("10.20.30.77 with prefix /28, written together as 10.20.30.77/28");
  await toStep(page, "One octet in binary");
  await expect(page.locator(".step-what")).toContainText("Octet 4 is 77, which is 01001101 in binary. The boundary is inside octet 4: 77 = 64 + 8 + 4 + 1");
  await toStep(page, "The prefix as a mask");
  await expect(page.locator(".step-what")).toContainText("/28 written as a mask is 255.255.255.240");
  await toStep(page, "Keep the network bits");
  await expect(page.locator(".step-what")).toContainText("10.20.30.77 AND 255.255.255.240 = 10.20.30.64");
  await toStep(page, "The whole block");
  await expect(scene(page).locator(".subnet-facts")).toContainText("Usable hosts14");
  await toStep(page, "Same subnet or not");
  await expect(page.locator(".step-what")).toContainText("Your PC decides: different subnet: hand the packet to the default gateway");
  await expect(page.locator(".step-why")).toContainText("not proof that the packet arrives");
  await expect(next(page)).toBeDisabled();
  await expect(page.locator(".completion")).toContainText("Walkthrough completed");
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("kitab.learning.v1")!).lessons);
  expect(saved["ip-addressing"]).toEqual(old);
  expect(saved["ipv4-subnets"].completedAt).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("predictions run in the scene: specific feedback, retry, show the answer, and nothing stored for them", async ({ page }) => {
  await open(page);
  await toStep(page, "Predict the network address");
  await expect(scene(page).locator(".subnet-facts")).toHaveCount(0);
  await expect(page.locator(".step-what")).not.toContainText("10.20.30.64");
  const choice = (label: RegExp) => scene(page).locator(".subnet-choices button", { hasText: label });
  await choice(/^10\.20\.30\.0$/).click();
  await expect(page.locator("#lesson-network-feedback")).toContainText("as /24 would. With /28 the boundary is 4 bits into octet 4");
  await choice(/^10\.20\.30\.64$/).click();
  await expect(page.locator("#lesson-network-feedback")).toContainText("Right. Clearing the 4 host bits");
  await expect(scene(page).locator(".subnet-facts")).toContainText("Network address10.20.30.64");
  const before = await page.evaluate(() => localStorage.getItem("kitab.learning.v1"));
  await toStep(page, "Predict: same subnet or not?");
  await scene(page).locator(".subnet-choices button", { hasText: "Same subnet: their first 3 octets match" }).click();
  await expect(page.locator("#lesson-local-feedback")).toContainText("compares whole octets, as /24 would");
  await scene(page).getByRole("button", { name: "Show the answer" }).click();
  await expect(page.locator("#lesson-local-feedback")).toContainText("Answer shown. 10.20.30.77 masks to 10.20.30.64 but 10.20.30.90 masks to 10.20.30.80");
  // Progress only notes the steps seen, as for any lesson: no score, no mastery and no record of the answers.
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("kitab.learning.v1")!).lessons["ipv4-subnets"]);
  expect(Object.keys(after).sort()).toEqual(Object.keys(JSON.parse(before!).lessons["ipv4-subnets"]).sort());
  expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(["kitab.learning.v1"]);
});

test("invalid addresses keep the learner's text and aren't applied; the slider and presets change the prefix", async ({ page }) => {
  await open(page);
  await example(page, { address: "192.168.01.5" });
  const field = page.getByRole("textbox", { name: "IPv4 address", exact: true });
  await expect(field).toHaveValue("192.168.01.5");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#control-address-error")).toContainText("“01” must be a whole number from 0 to 255 with no leading zeros");
  await expect(page.locator("#control-address-error")).toContainText("The example still shows 10.20.30.77.");
  await expect(page.locator(".step-what")).toContainText("10.20.30.77");
  await example(page, { address: "172.20.200.9" });
  await expect(field).not.toHaveAttribute("aria-invalid");
  await expect(page.locator(".step-what")).toContainText("172.20.200.9");
  // /20 isn't a preset: the slider reaches any prefix.
  const slider = page.getByRole("slider", { name: "Prefix length" });
  await slider.fill("20");
  await expect(page.locator(".range-control output")).toHaveText("/20");
  await expect(page.getByRole("group", { name: "Prefix length presets" }).getByRole("button", { name: "/20", exact: true })).toHaveCount(0);
  await slider.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".range-control output")).toHaveText("/21");
  // Arrow keys on the slider change the prefix, not the step.
  await expect(page.locator(".step-meta")).toContainText("Chapter 1");
});

test("/31, /32 and /0 are described by what they are, never with a network or broadcast address", async ({ page }) => {
  await open(page);
  await example(page, { address: "203.0.113.7", prefix: 31 });
  await toStep(page, "The whole block");
  await expect(page.locator(".step-what")).toContainText("a point-to-point link: both 203.0.113.6 and 203.0.113.7 are usable");
  await expect(scene(page)).not.toContainText(/Network address|Broadcast address/);
  await expect(scene(page).locator(".subnet-kind")).toContainText("RFC 3021");
  await example(page, { prefix: 32 });
  await expect(page.locator(".step-what")).toContainText("the single address 203.0.113.7, usable on its own");
  await expect(scene(page)).not.toContainText(/Network address|Broadcast address/);
  await example(page, { prefix: 0 });
  await expect(page.locator(".step-what")).toContainText("every IPv4 address: used as the default route");
  await expect(scene(page).locator(".subnet-facts")).toContainText("Used asThe default route");
});

test("the experiments run from the completion card, and the mask mismatch shows two devices disagreeing", async ({ page }) => {
  await open(page);
  await page.locator(".chapter-pill", { hasText: "Local or remote?" }).click();
  while (!(await next(page).isDisabled())) await next(page).click();
  await page.getByRole("button", { name: "Experiment: Only your PC changes its prefix" }).click();
  await expect(page.locator(".step-what")).toContainText("Your PC uses 10.20.30.77/24. For 10.20.30.90 it decides: same subnet");
  await next(page).click();
  await expect(page.locator(".step-what")).toContainText("The neighbour uses 10.20.30.90/28. For 10.20.30.77 it decides: different subnet");
  await expect(page.locator(".step-what")).toContainText("The two devices agree: no");
  await next(page).click();
  await expect(page.locator(".compare")).toContainText("The destination treats your PC as local");
});

test("the lesson links to Explore subnets with its example, and the explorer links back to the lesson", async ({ page }) => {
  await open(page);
  const link = scene(page).getByRole("link", { name: /Open this example in Explore subnets/ });
  await expect(link).toHaveAttribute("href", "/practice/subnets?ip=10.20.30.77&prefix=28&to=10.20.30.90");
  await link.click();
  await expect(page).toHaveURL(/\/practice\/subnets\?ip=10\.20\.30\.77&prefix=28&to=10\.20\.30\.90$/);
  await expect(page.getByRole("textbox", { name: "IPv4 address" })).toHaveValue("10.20.30.77");
  await expect(page.getByRole("textbox", { name: "Destination address" })).toHaveValue("10.20.30.90");
  await page.getByRole("link", { name: "New to subnets? Learn it step by step →" }).click();
  await expect(page).toHaveURL(/\/learn\/ipv4-subnets$/);
  await expect(page.locator("#step-title")).toBeVisible();
});
