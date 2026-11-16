import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const path = "/learn/hello-tcp";

test("Kitab opens the original walkthrough as a full page at the lesson URL", async ({ page }) => {
  await page.goto("/learn");
  await page.locator(".path-stages summary", { hasText: "Across the Internet" }).click();
  await page.locator(".path-activity", { hasText: "Packet Journey" }).click();
  await expect(page).toHaveURL(new RegExp(path + "$"));
  await expect(page).toHaveTitle("Packet Journey · C# Walkthrough", { timeout: 3_000 });
  await expect(page.locator("#step-number")).toHaveText("1 / 130");
  await expect(page.locator("iframe")).toHaveCount(0);
  await page.goBack();
  await expect(page.locator(".track-roadmap")).toBeVisible();
});

test("the lesson URL serves the HTML file byte for byte", async ({ request }) => {
  const response = await request.get(path);
  expect(response.ok()).toBe(true);
  expect(await response.body()).toEqual(await readFile(new URL("../public/learn/hello-tcp.html", import.meta.url)));
});

test("the original packet, diagram and source controls work", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto(path);
  await page.getByRole("button", { name: "Watch first request chunk" }).click();
  await expect(page.locator("#step-title")).toHaveText("Hand app bytes to TCP");
  await expect(page.locator("#packet-wrap-http-bytes")).toContainText("49");
  await page.locator("#next").click();
  await expect(page.locator("#packet-wrap-tcp-title")).toContainText("52");
  await page.locator("#next").click();
  await page.locator("#next").click();
  await expect(page.locator("#packet-wrap-ip-title")).toContainText("72");

  await page.getByRole("button", { name: "Whole network" }).click();
  await expect(page.locator("#network-view")).toBeVisible();
  await page.getByRole("button", { name: "Sequence", exact: true }).click();
  await expect(page.locator("#sequence-view")).toBeVisible();
  await page.getByText("C# source", { exact: true }).click();
  await expect(page.locator("#source-location")).toContainText("Ipv4.cs");
  await page.getByRole("button", { name: "Full file" }).click();
  await expect(page.locator("#source-code")).toContainText("CreatePacket");

  await page.getByRole("slider", { name: "Trace step" }).focus();
  await page.keyboard.press("End");
  await expect(page.locator("#step-title")).toHaveText("Display the response body");
  await expect(page.locator("#trace-line")).toHaveText("Hello Babti");
  expect(errors).toEqual([]);
});

test("the walkthrough links back into Kitab and on to practice, and missions link back to it", async ({ page }) => {
  await page.goto(path);
  // The same header and course location as every Kitab page.
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Learn" })).toHaveAttribute("aria-current", "page");
  const nav = page.getByRole("navigation", { name: "Where you are" });
  await expect(nav).toContainText("Unit 5: Across the Internet");
  await expect(nav).toContainText("Lesson · 3 of 6 in this unit");
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "The ACK that wouldn't move" }).first().click();
  await expect(page).toHaveURL(/\/missions\/tcp-lost-segment$/);
  await page.getByRole("link", { name: /Follow the walkthrough first: Packet Journey/ }).click();
  await expect(page).toHaveURL(new RegExp(path + "$"));
  await expect(page.locator("#step-number")).toHaveText("1 / 130");
  // The way back is the unit, not a previous-activity link: the course location is context, with one way forward.
  await expect(nav.getByRole("link", { name: /Previous|A request across the Internet/ })).toHaveCount(0);
  await nav.getByRole("link", { name: "Unit 5: Across the Internet" }).click();
  await expect(page).toHaveURL(/\/learn#unit-internet$/);
  await page.goto(path);
  // Its visit is recorded like any page's, so the roadmap can show it opened.
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("kitab.visits.v1")!).activities))).toContain("hello-tcp");
  await page.getByRole("link", { name: "Kitab", exact: true }).click();
  await expect(page.locator("#main h1")).toBeVisible();
  await page.goto("/learn");
  await expect(page.locator(".path-activity", { hasText: "Packet Journey" })).toHaveAttribute("href", path);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
