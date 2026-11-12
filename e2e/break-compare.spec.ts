import { test, expect, type Page } from "@playwright/test";

const panel = (page: Page) => page.getByRole("region", { name: "Break and compare" });
const banner = (page: Page) => page.locator(".experiment-banner");
const workspace = (page: Page) => page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"));
async function open(page: Page, destination = "http://kitab.test/") {
  await page.goto("/practice/network");
  await page.waitForFunction(() => localStorage.getItem("kitab.network.workspace.v1"));
  await page.getByLabel("Destination").fill(destination);
  await page.getByRole("button", { name: "Break and compare…" }).click();
}

test("loaded on demand; only faults that change this request are offered; both runs and their first difference", async ({ page }) => {
  const loaded: string[] = [];
  page.on("request", (r) => r.url().includes("BreakCompare") && loaded.push(r.url()));
  await page.goto("/practice/network");
  await page.getByLabel("Destination").fill("http://kitab.test/");
  expect(loaded).toEqual([]);
  await page.getByLabel("Destination").fill("http://kitab.test/");
  await page.getByRole("button", { name: "Break and compare…" }).click();
  await expect(panel(page).getByRole("radio")).toHaveCount(6);
  expect(loaded.length).toBeGreaterThan(0);
  await expect(panel(page).locator(".compare-option")).toContainText([
    /Change Your PC's subnet mask from \/24 to \/30/,
    /Remove Your PC's default gateway/,
    /Point Your PC's default gateway at 192\.168\.1\.99/,
    /Unplug the cable between Your PC and Home switch/,
    /Remove Home router's route to 0\.0\.0\.0\/0/,
    /Turn off NAT on Home router/,
  ]);
  await panel(page).getByRole("radio", { name: /Turn off NAT on Home router/ }).check();
  await panel(page).getByRole("button", { name: "Run both and compare" }).click();
  await expect(banner(page)).toContainText("Temporary experiment. Showing the broken copy: Turn off NAT on Home router. Your saved network is unchanged.");
  await expect(panel(page).locator(".compare-changed")).toHaveText("One change: NAT on Home router, on → off. This copy is temporary; your network is unchanged.");
  await expect(panel(page).locator(".compare-run.is-working")).toContainText("Works. HTTP 200 OK");
  await expect(panel(page).locator(".compare-run.is-broken")).toContainText("Stops. Delivery stopped at ISP router.");
  await expect(panel(page).locator(".compare-why")).toContainText("Why it stops: DNS server answered the DNS query, but the reply could not get back to Your PC.");
  await expect(panel(page).locator(".compare-run.is-working .compare-event")).toContainText("Step 35: Translate source with NAT");
  await expect(panel(page).locator(".compare-run.is-broken .compare-event")).toContainText("Step 35: ARP: discover the next-hop MAC");
  await expect(panel(page).locator("tbody tr")).toHaveText([/Step\s*Translate source with NAT\s*ARP: discover the next-hop MAC/]);
  // The Journey shows the broken run at its first difference; each side can be shown and its packet inspected.
  await page.getByRole("radio", { name: "Every event" }).click();
  await expect(page.locator(".journey-position b")).toHaveText("ARP: discover the next-hop MAC");
  await panel(page).locator(".compare-run.is-working").getByRole("button", { name: "Show it in the Journey" }).click();
  await expect(page.locator(".journey-position b")).toHaveText("Translate source with NAT");
  await expect(banner(page)).toContainText("Showing your network");
  await panel(page).locator(".compare-run.is-working").getByRole("button", { name: "Inspect its packet" }).click();
  await expect(page.getByRole("button", { name: "Packet", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".network-inspector")).toContainText("203.0.113.2");
});

test("a temporary copy: nothing is edited or sent, Restore brings back the learner's network, nothing is saved", async ({ page }) => {
  await open(page, "198.51.100.20");
  await page.getByLabel("Traffic type").selectOption("ping");
  await page.getByLabel("Destination").fill("198.51.100.20");
  const saved = await workspace(page);
  // The internet starter's own cable between the PC and the switch.
  await panel(page).getByRole("radio", { name: /Unplug the cable between Your PC and Home switch/ }).check();
  await panel(page).getByRole("button", { name: "Run both and compare" }).click();
  const wires = page.locator(".network-canvas .network-wire");
  const all = await page.evaluate(() => JSON.parse(localStorage.getItem("kitab.network.workspace.v1")!).links.length);
  await expect(wires).toHaveCount(all - 1);
  // Sending or editing is refused while the experiment is open.
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".network-notice")).toContainText("This is a temporary experiment. Choose Restore my network to change or send anything.");
  expect(await workspace(page)).toBe(saved);
  // Restore: the learner's network, as saved, with its run shown at the same point.
  await banner(page).getByRole("button", { name: "Restore my network" }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(wires).toHaveCount(all);
  await expect(panel(page).getByRole("radio").first()).toBeVisible();
  expect(await workspace(page)).toBe(saved);
  expect(await page.evaluate(() => localStorage.getItem("kitab.network-missions.v1"))).toBeNull();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("Ping");
});

test("a request that already fails is not a starting point", async ({ page }) => {
  await open(page, "10.9.9.9");
  await page.getByLabel("Traffic type").selectOption("ping");
  await page.getByLabel("Destination").fill("10.9.9.9");
  await expect(panel(page).locator(".compare-empty")).toContainText("Break and compare starts from something that works. This request stops:");
});

test("by keyboard and touch, with reduced motion, stacked on narrow screens", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await expect(panel(page).getByRole("radio")).toHaveCount(6);
  await panel(page).getByRole("radio").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(panel(page).getByRole("radio").nth(1)).toBeChecked();
  expect(await panel(page).locator(".compare-option").nth(1).evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
  for (const h of await panel(page).locator(".compare-option").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
  if (info.project.use.hasTouch) await panel(page).locator(".compare-option").nth(5).tap();
  else await panel(page).getByRole("radio").nth(5).check();
  await panel(page).getByRole("button", { name: "Run both and compare" }).focus();
  await page.keyboard.press("Enter");
  await expect(panel(page).locator(".compare-changed")).toHaveAttribute("role", "status");
  const columns = await panel(page).locator(".compare-grid").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
  expect(columns).toBe((info.project.use.viewport?.width ?? 1440) <= 640 ? 1 : 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length)).toBe(0);
  await panel(page).screenshot({ path: info.outputPath("compare.png") });
  await panel(page).getByRole("button", { name: "Restore my network" }).click();
  await expect(banner(page)).toHaveCount(0);
});
