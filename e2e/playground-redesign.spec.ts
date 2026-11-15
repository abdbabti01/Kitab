import { expect, test, type Page } from "@playwright/test";

// The Playground's three-part lab (scenario and request, diagram, inspector) at every width, and the subject-first
// pages around it, never scrolling sideways.

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

test("the lab puts the request beside the diagram on wide screens and the diagram first on narrow ones", async ({ page }) => {
  await page.goto("/practice/network");
  await page.locator(".network-inspector").waitFor();
  const width = page.viewportSize()!.width;
  const side = await box(page, ".lab-side");
  const stage = width > 850 ? await box(page, ".workspace-stage") : null!;
  const inspector = await box(page, ".network-inspector");
  if (width > 1280) {
    // Scenario and request | diagram | inspector, side by side.
    expect(side.x + side.width).toBeLessThanOrEqual(stage.x + 1);
    expect(stage.x + stage.width).toBeLessThanOrEqual(inspector.x + 1);
    expect(Math.abs(side.y - stage.y)).toBeLessThan(2);
  } else if (width > 850) {
    // The diagram across the top; the request and the inspector side by side under it.
    expect(stage.y + stage.height).toBeLessThanOrEqual(side.y + 1);
    expect(Math.abs(side.y - inspector.y)).toBeLessThan(2);
  } else {
    // One column: the diagram and its playback, the inspector right under it, then the request.
    const diagram = await box(page, ".journey-stage");
    expect(diagram.y + diagram.height).toBeLessThanOrEqual(inspector.y + 1);
    expect(inspector.y + inspector.height).toBeLessThanOrEqual(side.y + 1);
  }
  // The first run still starts from the diagram, on the first screen.
  await expect(page.locator(".network-canvas").getByRole("button", { name: "Send request and follow it" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test("the scenario card loads a starter and the request summary follows the form", async ({ page }) => {
  await page.goto("/practice/network");
  const scenario = page.locator(".scenario-card");
  await expect(scenario.locator(".scenario-current")).toContainText("A request across the Internet");
  await page.getByLabel("Starter network").selectOption("lan");
  await expect(scenario.locator(".scenario-current")).toContainText("Your first LAN");
  await expect(scenario.locator(".scenario-current")).toContainText("Two computers and a switch");
  const summary = page.locator(".send-summary");
  await expect(summary).toContainText("pings 192.168.1.20");
  await page.getByLabel("Traffic type").selectOption("http");
  await page.getByLabel("Destination").fill("http://192.168.1.20/");
  await expect(summary).toContainText("loads http://192.168.1.20/ over HTTP");
});

test("playback, the timeline and the inspector stay in step", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  const controls = page.getByRole("group", { name: "Journey controls" });
  await controls.getByRole("button", { name: "Pause playback" }).click();
  await expect(controls.getByRole("button", { name: "Play journey" })).toBeVisible();
  const position = page.locator(".journey-position");
  const at = async () => Number((await page.getByLabel("Journey timeline").inputValue()));
  await page.getByLabel("Journey timeline").fill("0");
  await expect.poll(at).toBe(0);
  await expect(controls.getByRole("button", { name: "First event" })).toBeDisabled();
  await controls.getByRole("button", { name: "Next stage" }).click();
  const second = await at();
  expect(second).toBeGreaterThan(0);
  const title = await position.locator("b").textContent();
  // Now explains the same step the timeline shows.
  await expect(page.locator(".journey-card")).toContainText(title!);
  await controls.getByRole("button", { name: "Previous stage" }).click();
  await expect.poll(at).toBe(0);
  // Every event steps one event at a time; Summary steps by stage.
  await page.getByRole("radio", { name: "Every event" }).click();
  await controls.getByRole("button", { name: "Next event" }).click();
  await expect.poll(at).toBe(1);
  await page.getByRole("radio", { name: "Summary" }).click();
  await page.getByLabel("Playback speed").selectOption("2");
  await expect(page.getByLabel("Playback speed")).toHaveValue("2");
  // The Packet view shows the message at this same step; selecting a device opens its view.
  await page.getByRole("button", { name: "Packet", exact: true }).click();
  await expect(page.locator(".packet-inspector")).toBeVisible();
  await page.getByRole("button", { name: "Select Home router", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Device", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("Home, the tracks and the Playground never scroll sideways at 320px", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-390");
  await page.setViewportSize({ width: 320, height: 700 });
  for (const path of ["/", "/learn", "/learn/data-structures", "/practice", "/practice/network"]) {
    await page.goto(path);
    await expect(page.locator("#main h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), path).toBeLessThanOrEqual(0);
  }
});
