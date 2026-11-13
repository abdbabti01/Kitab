import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import { aftermath, experimentsFor, type FaultKind } from "../src/practice/network/experiments.ts";
import { starter } from "../src/practice/network/starters.ts";
import type { Action } from "../src/practice/network/model.ts";

// Break and compare in the lab: every line the learner sees is checked against the experiment the engine itself
// produces for the same network, action and fault.
const panel = (page: Page) => page.getByRole("region", { name: "Break and compare" });
const now = (page: Page) => page.getByRole("region", { name: "What the experiment shows" });
const banner = (page: Page) => page.locator(".experiment-banner");
const timeline = (page: Page) => page.getByLabel("Journey timeline");
const sides = (page: Page) => banner(page).getByRole("radiogroup", { name: "Run shown" });
const http: Action = { kind: "http", source: "pc", target: "http://kitab.test/", ttl: 64 };
const cases: [string, string, Action, FaultKind][] = [
  ["NAT turned off", "", http, "nat"],
  ["a wrong default gateway", "", http, "wrong-gateway"],
  ["a missing router route", "", http, "route"],
  ["a disconnected link", "", http, "cable"],
  ["DHCP with no free address", "?starter=wifi", { kind: "dhcp", source: "phone", target: "" }, "dhcp-pool"],
];

for (const [title, query, action, kind] of cases)
  test(`${title}: the change, both runs, the first difference and the failure come from the engine`, async ({ page }) => {
    const network = starter(query ? "wifi" : "internet");
    const x = experimentsFor(network, action).experiments.find((e) => e.fault.kind === kind)!;
    const d = x.divergence!;
    const name = (id: string) => network.devices.find((v) => v.id === id)!.name;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`/practice/network${query}`);
    await page.locator(".journey-start").waitFor();
    await page.locator(".canvas-bar").getByRole("button", { name: "Break and compare…" }).click();
    await panel(page).getByRole("radio", { name: x.fault.label }).check();
    await panel(page).getByRole("button", { name: "Run both and compare" }).click();
    await page.getByRole("radio", { name: "Every event" }).click();
    // What changed, and where, on the diagram and in Now.
    await expect(banner(page)).toContainText(x.fault.label);
    await expect(page.locator(".network-device.is-changed")).toHaveCount(x.fault.devices.length);
    await expect(now(page)).toContainText(
      kind === "cable"
        ? `What changed. The cable ${x.fault.before}: connected → unplugged.`
        : `What changed. ${x.fault.setting} on ${name(x.fault.device)}: ${x.fault.before} → ${x.fault.after}.`,
    );
    // The broken run is shown at its own first difference, marked on the track.
    await expect(sides(page).getByRole("radio", { name: "With the fault" })).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(".track-run")).toHaveText("With the fault (temporary copy)");
    await expect(timeline(page)).toHaveValue(String(d.broken));
    await expect(page.locator(".journey-position b")).toHaveText(x.broken.events[d.broken!].title);
    await expect(page.locator(".track-marker")).toHaveCount(1);
    await expect(panel(page).locator(".compare-run.is-working .compare-event")).toContainText(`Step ${d.working! + 1}: ${x.working.events[d.working!].title}`);
    await expect(panel(page).locator(".compare-run.is-broken .compare-event")).toContainText(`Step ${d.broken! + 1}: ${x.broken.events[d.broken!].title}`);
    await expect(now(page)).toContainText(`Every device made the same decisions in both runs until ${name(d.device)}`);
    // Why it fails, from the engine; and when the failure shows at another device, that is said.
    await expect(now(page)).toContainText(`Why it fails. ${x.broken.failure!.message}`);
    const after = aftermath(x)!;
    await expect(now(page)).toContainText(after.steps ? `With the fault, the run records ${after.steps} more` : "With the fault, nothing more happens: that step is the run's last.");
    await expect(now(page).locator(".compare-apart")).toHaveCount(after.stopsAt !== d.device ? 1 : 0);
    // Each run keeps its own place: an event of one run is never looked up in the other.
    await timeline(page).fill(String(Math.min(d.broken! + 1, x.broken.events.length - 1)));
    const brokenAt = await timeline(page).inputValue();
    await sides(page).getByRole("radio", { name: "Your network" }).click();
    await expect(page.locator(".track-run")).toHaveText("Your network");
    await expect(timeline(page)).toHaveValue(String(d.working));
    await expect(page.locator(".journey-position b")).toHaveText(x.working.events[d.working!].title);
    await sides(page).getByRole("radio", { name: "With the fault" }).click();
    await expect(timeline(page)).toHaveValue(brokenAt);
    // The packet of the real event at the first difference.
    const event = x.broken.events[d.broken!];
    if (event.layers.length) {
      await panel(page).locator(".compare-run.is-broken").getByRole("button", { name: "Inspect its packet" }).click();
      await expect(page.getByRole("button", { name: "Packet", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".network-inspector")).toContainText(event.layers.at(-1)!.name);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

test("the first difference and the failure at different devices are told apart", async ({ page }) => {
  await page.goto("/practice/network");
  await page.locator(".canvas-bar").getByRole("button", { name: "Break and compare…" }).click();
  await panel(page).getByRole("radio", { name: /Turn off NAT/ }).check();
  await panel(page).getByRole("button", { name: "Run both and compare" }).click();
  await expect(now(page).locator(".compare-apart")).toHaveText(
    "The runs part at Home router, but the failure shows up later, at ISP router: the first difference is the cause, the stop is where it becomes visible.",
  );
  await expect(page.getByRole("button", { name: "Select Home router, changed in this experiment: NAT: off" })).toBeVisible();
  await sides(page).getByRole("radio", { name: "Your network" }).click();
  await expect(page.getByRole("button", { name: "Select Home router, changed in this experiment: NAT: on" })).toBeVisible();
});

test("restore with predictions on: the learner's run, place and answers come back; nothing leaks or is credited", async ({ page }) => {
  await page.goto("/practice/network");
  await page.waitForFunction(() => localStorage.getItem("kitab.network.workspace.v1"));
  const saved = await page.evaluate(() => ({ w: localStorage.getItem("kitab.network.workspace.v1"), m: localStorage.getItem("kitab.network-missions.v1") }));
  await page.getByLabel("Predict as you go").check();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  const question = page.getByRole("region", { name: "Prediction", exact: true });
  await question.getByRole("radio", { name: "192.168.1.1 (Home router)" }).check();
  await question.getByRole("button", { name: "Check my prediction" }).click();
  await expect(page.getByRole("region", { name: "Prediction result" })).toBeVisible();
  const before = { at: await timeline(page).inputValue(), max: await timeline(page).getAttribute("max") };
  await page.locator(".canvas-bar").getByRole("button", { name: "Break and compare…" }).click();
  await panel(page).getByRole("radio", { name: /Turn off NAT/ }).check();
  await panel(page).getByRole("button", { name: "Run both and compare" }).click();
  // During the experiment: no question, the switch cannot be changed, and the experiment's runs are not gated.
  await expect(page.getByLabel("Predict as you go")).toBeDisabled();
  await expect(page.getByRole("region", { name: "Prediction result" })).toHaveCount(0);
  expect(Number(await timeline(page).getAttribute("max"))).toBeGreaterThan(Number(before.max));
  await banner(page).getByRole("button", { name: "Restore my network" }).click();
  // The learner's own run: the same place, the same hidden part, the answered prediction still answered.
  await expect(timeline(page)).toHaveValue(before.at);
  await expect(timeline(page)).toHaveAttribute("max", before.max!);
  await expect(page.getByRole("region", { name: "Prediction result" })).toContainText("Your prediction was right.");
  await expect(page.getByLabel("Predict as you go")).toBeEnabled();
  await page.getByRole("region", { name: "Prediction result" }).getByRole("button", { name: "Continue" }).click();
  await expect(question.getByRole("heading")).toContainText("Which device answers?");
  // Nothing was saved or credited.
  expect(await page.evaluate(() => ({ w: localStorage.getItem("kitab.network.workspace.v1"), m: localStorage.getItem("kitab.network-missions.v1") }))).toEqual(saved);
});

test("restore without a run of their own returns the learner to an empty Journey, not the experiment's run", async ({ page }) => {
  await page.goto("/practice/network");
  await page.locator(".canvas-bar").getByRole("button", { name: "Break and compare…" }).click();
  await panel(page).getByRole("radio", { name: /Remove Your PC's default gateway/ }).check();
  await panel(page).getByRole("button", { name: "Run both and compare" }).click();
  await expect(timeline(page)).toBeEnabled();
  await banner(page).getByRole("button", { name: "Restore my network" }).click();
  await expect(timeline(page)).toBeDisabled();
  await expect(page.locator(".journey-start")).toBeVisible();
});

// No full fault tag covers another device's tile, name or address; a crowded spot gets a compact badge instead, and
// every changed device keeps the full text in its accessible name. Device positions are never changed.
async function overlaps(page: Page) {
  return page.evaluate(() => {
    const boxes = [...document.querySelectorAll(".network-canvas .network-device")].map((g) => ({
      g,
      parts: [...g.querySelectorAll(".device-tile, .device-name, .device-ip")].map((e) => e.getBoundingClientRect()),
    }));
    const hit = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top && a.width > 0 && b.width > 0;
    const out: string[] = [];
    for (const tag of document.querySelectorAll(".network-canvas .changed-tag:not(.is-compact) rect")) {
      const r = tag.getBoundingClientRect();
      const own = tag.closest(".network-device");
      for (const o of boxes) if (o.g !== own && o.parts.some((p) => hit(r, p))) out.push(o.g.getAttribute("aria-label") ?? "");
    }
    return out;
  });
}
const layouts = ["My layout", "Rows"] as const;
for (const [what, seed, fault] of [
  ["the internet starter", null, /Unplug the cable between Your PC and Home switch/],
  ["a crowded 36-device campus", "campus", null],
] as const)
  test(`fault tags never cover another device: ${what}`, async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    if (seed) {
      const campus = fs.readFileSync(new URL("./fixtures/campus.json", import.meta.url), "utf8");
      await page.goto("/");
      await page.evaluate((n) => localStorage.setItem("kitab.network.workspace.v1", n), campus);
    }
    await page.goto("/practice/network");
    await page.locator(".journey-start").waitFor();
    if (seed) {
      await page.getByLabel("Source device").selectOption("pc25");
      await page.getByLabel("Traffic type").selectOption("ping");
      await page.getByLabel("Destination").fill("10.2.0.13");
    }
    const positions = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("kitab.network.workspace.v1") ?? "{}").devices?.map((d: { x: number; y: number }) => [d.x, d.y])));
    await page.locator(".canvas-bar").getByRole("button", { name: "Break and compare…" }).click();
    const option = fault ? panel(page).getByRole("radio", { name: fault }) : panel(page).getByRole("radio").first();
    await option.check();
    await panel(page).getByRole("button", { name: "Run both and compare" }).click();
    for (const layout of layouts) {
      const toggle = page.locator(".canvas-layout");
      if (!(await toggle.textContent())!.includes(layout)) await toggle.click();
      await expect(toggle).toContainText(layout);
      for (const side of ["With the fault", "Your network"]) {
        await sides(page).getByRole("radio", { name: side }).click();
        expect(await overlaps(page), `${layout}, ${side}, ${info.project.name}`).toEqual([]);
        // Every changed device names its change, whether it shows the full tag or the compact badge.
        const changed = page.locator(".network-canvas .network-device.is-changed");
        expect(await changed.count()).toBeGreaterThan(0);
        for (const d of await changed.all()) await expect(d).toHaveAttribute("aria-label", /, changed in this experiment: .+/);
      }
    }
    expect(await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("kitab.network.workspace.v1") ?? "{}").devices?.map((d: { x: number; y: number }) => [d.x, d.y])))).toBe(positions);
  });
