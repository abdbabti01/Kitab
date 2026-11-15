import { expect, test, type Page } from "@playwright/test";

// Lesson 2 foundation (/learn/local-delivery-routing): every value comes from a real simulator run.
const next = (page: Page) => page.locator(".lesson-controls .next-button");
const scene = (page: Page) => page.locator(".ld-scene");
async function open(page: Page, seed?: Record<string, unknown>) {
  await page.goto("/");
  await page.evaluate((items) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(items ?? {})) localStorage.setItem(key, JSON.stringify(value));
  }, seed);
  await page.goto("/learn/local-delivery-routing");
  await expect(scene(page)).toBeVisible();
}
async function toStep(page: Page, title: string) {
  for (let i = 0; i < 30 && (await page.locator("#step-title").textContent()) !== title; i++) await next(page).click();
  await expect(page.locator("#step-title")).toHaveText(title);
}

test("the six chapters run end to end on the lab's own diagram, and earlier lesson records stay as they were", async ({ page }) => {
  const old = { lessonVersion: "1.0.0", visits: 1, lastVisitedAt: "t", seen: [], total: 13, chaptersSeen: [], completedAt: "2026-11-13T10:00:00.000Z", experimentsCompleted: [], position: null, updated: false };
  await open(page, { "kitab.learning.v1": { version: 1, lessons: { "ipv4-subnets": old } } });
  await expect(page).toHaveTitle("Local delivery, gateways and routing · Kitab");
  await expect(page.locator(".chapter-pill")).toHaveText([/Same subnet\?/, /ARP or gateway/, /Two addresses, two jobs/, /A router between subnets/, /Leaving home: NAT/, /Try it in the lab/]);
  // The diagram is the lab's NetworkCanvas, loaded with the lesson.
  await expect(scene(page).locator(".network-canvas")).toBeVisible();
  // Prediction first: the calculation appears once the question is answered.
  await expect(scene(page).locator(".ld-settings")).toHaveCount(0);
  await scene(page).locator(".subnet-choices button", { hasText: "Different subnet:" }).click();
  await expect(scene(page)).toContainText("A calculation your PC makes before sending: not a simulated event.");
  await expect(page.locator(".step-what")).toContainText("Same subnet: no.");
  for (let i = 0; i < 30 && !(await next(page).isDisabled()); i++) {
    await next(page).click();
    await expect(scene(page).locator(".ld-run")).toContainText("Simulated run:");
    if ((await page.locator("#step-title").textContent()) === "The reply comes home")
      await expect(page.locator(".step-what")).toContainText("Ping succeeded. The reply arrived. Your PC received the reply from 198.51.100.20");
  }
  await expect(page.locator("#step-title")).toHaveText("Try it in the lab");
  await expect(page.locator(".step-what")).toContainText("Apart from chapter 1’s subnet calculation");
  // The journey ends with the three experiments on offer.
  await expect(page.locator(".completion button", { hasText: "Experiment:" })).toHaveText([/A wrong default gateway/, /A server with no way back/, /Turn off NAT/]);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("kitab.learning.v1")!).lessons);
  expect(saved["ipv4-subnets"]).toEqual(old);
  expect(saved["local-delivery-routing"].completedAt).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("ARP or gateway: a wrong MAC is explained, and the evidence shows the router's MAC from the trace", async ({ page }) => {
  await open(page);
  await toStep(page, "Your PC chooses its next hop");
  await expect(scene(page).locator(".ld-envelope")).toHaveCount(0);
  await scene(page).locator(".subnet-choices button", { hasText: "(the server)" }).click();
  await expect(scene(page).locator(".subnet-feedback")).toContainText("an Ethernet frame only crosses one link");
  await scene(page).locator(".subnet-choices button", { hasText: "(the router's LAN interface)" }).click();
  await expect(scene(page).locator(".subnet-feedback")).toContainText("Right.");
  await expect(scene(page).locator(".ld-decision")).toContainText("Next hop192.168.1.1");
  await toStep(page, "The frame and the packet inside");
  const envelope = scene(page).locator(".ld-envelope");
  await expect(envelope).toContainText("Destination MAC02:3b:27:36:10:00");
  await expect(envelope).toContainText("Destination IP192.168.2.20");
  await expect(envelope).toContainText("TTL64");
});

test("two addresses, two jobs: the router's frame keeps the IPs, changes both MACs and lowers TTL", async ({ page }) => {
  await open(page);
  await toStep(page, "A switch passes the frame on unchanged");
  await expect(scene(page).locator(".ld-summary")).toHaveText("Nothing in the frame or the packet changed.");
  await toStep(page, "A router builds a new frame");
  await scene(page).locator(".subnet-choices button", { hasText: "The IP addresses, because the router is now sending the packet" }).click();
  await expect(scene(page).locator(".subnet-feedback")).toContainText("Changing IP addresses is NAT, and this router doesn't do it.");
  await scene(page).getByRole("button", { name: "Show the answer" }).click();
  await expect(scene(page).locator(".ld-summary")).toHaveText("Changed: Source MAC, Destination MAC, TTL. Unchanged: Source IP, Destination IP.");
  await expect(scene(page).locator(".ld-envelope .is-changed")).toHaveCount(3);
});

test("a router between subnets: the interface question, then the route the simulator chose", async ({ page }) => {
  await open(page);
  await toStep(page, "The router chooses a route");
  await scene(page).locator(".subnet-choices button", { hasText: "Back out the interface it arrived on" }).click();
  await expect(scene(page).locator(".subnet-feedback")).toContainText("looks the destination up in its routing table");
  await scene(page).locator(".subnet-choices button", { hasText: /^wan/ }).click();
  await expect(scene(page).locator(".ld-decision")).toContainText("RouteConnected 192.168.2.0/24");
  await expect(scene(page).getByRole("link", { name: "Open this network in the Playground →" })).toHaveAttribute("href", "/practice/network?starter=routed");
  await toStep(page, "The simulated ping completes");
  await expect(page.locator(".step-why")).toContainText("simulated run succeeded = yes");
});

test("leaving home: the server sees the router's public address, and the router restores the reply's destination", async ({ page }) => {
  await open(page);
  await toStep(page, "The home router translates the source");
  await expect(scene(page).locator(".ld-envelope")).toHaveCount(0);
  await scene(page).locator(".subnet-choices button", { hasText: "(your PC's own address)" }).click();
  await expect(scene(page).locator(".subnet-feedback")).toContainText("192.168.1.10 is a private address");
  await scene(page).locator(".subnet-choices button", { hasText: "(the home router's public address)" }).click();
  await expect(scene(page).locator(".subnet-feedback")).toContainText("Right.");
  await expect(scene(page).locator(".ld-envelope h4")).toHaveText(["Before: Choose a route", "After: Translate source with NAT"]);
  await expect(scene(page).locator(".ld-summary")).toHaveText("Changed: Source IP. Unchanged: Destination IP, TTL.");
  await expect(scene(page).getByRole("link", { name: "Practise: Bring the reply home →" })).toHaveAttribute("href", "/practice/missions/bring-reply-home");
  await expect(scene(page).getByRole("link", { name: "Open this network in the Playground →" })).toHaveAttribute("href", "/practice/network?starter=internet");
  await toStep(page, "What the server sees");
  await expect(scene(page).locator(".ld-envelope")).toContainText("Source IP203.0.113.2");
  await toStep(page, "The home router restores the destination");
  await expect(scene(page).locator(".ld-summary")).toHaveText("Changed: Destination IP. Unchanged: Source IP, TTL.");
  await expect(scene(page).locator(".ld-envelope").last()).toContainText("Destination IP192.168.1.10");
});

// Each experiment: the normal run, one change (no result shown), the real run's first difference and stop, then put back.
const experiments = [
  { title: "A wrong default gateway", normal: "192.168.1.1", changed: "192.168.1.99", diverges: true, stopsAt: "Your PC", reason: "ARP_NO_OWNER", row: ["Your PC's next hop", "192.168.1.1", "192.168.1.99"] },
  { title: "A server with no way back", normal: "192.168.2.1", changed: "none", diverges: false, stopsAt: "Office server", reason: "REPLY_NO_PATH", row: ["The ping succeeded", "yes", "no"] },
  { title: "Turn off NAT", normal: "on", changed: "off", diverges: true, stopsAt: "ISP router", reason: "REPLY_NO_PATH", row: ["Source address the server saw", "203.0.113.2", "192.168.1.10"] },
];
for (const x of experiments) {
  test(`experiment “${x.title}”: one change, a real run that stops, then the setting put back`, async ({ page }) => {
    await open(page);
    await toStep(page, "Try it in the lab");
    await page.locator(".completion button", { hasText: `Experiment: ${x.title}` }).click();
    await expect(page.locator("#step-title")).toHaveText("The normal run");
    await expect(scene(page).locator(".ld-result")).toHaveText(/^Simulated run succeeded\./);
    await next(page).click();
    await expect(page.locator("#step-title")).toHaveText("One change");
    await expect(scene(page).locator(".ld-decision .is-changed")).toContainText(x.changed);
    await expect(scene(page).locator(".ld-decision")).toContainText(`Normal value${x.normal}`);
    await expect(scene(page).locator(".ld-result")).toHaveCount(0);
    await next(page).click();
    if (x.diverges) {
      await expect(page.locator("#step-title")).toHaveText("Where the runs part");
      await expect(scene(page).locator(".ld-differences")).toBeVisible();
    }
    await toStep(page, "The run stops");
    const stop = scene(page).locator(".ld-stop");
    await expect(stop.locator("h4")).toHaveText(`The run stops at ${x.stopsAt}`);
    await expect(stop).toContainText(`Reason${x.reason}`);
    await expect(page.locator(".step-what")).toContainText(x.reason);
    await next(page).click();
    await expect(page.locator("#step-title")).toHaveText("Put it back and run again");
    await expect(scene(page).locator(".ld-run")).toContainText("setting restored");
    await expect(scene(page).locator(".ld-result")).toHaveText(/^Simulated run succeeded\./);
    // The framework's comparison: normal run vs this experiment, from the two traces' outcomes.
    const row = page.locator(".compare tr", { hasText: x.row[0] });
    await expect(row.locator("td")).toHaveText(x.row.slice(1));
    await expect(row).toHaveClass(/is-different/);
    await page.locator(".compare").getByRole("button", { name: "Back to the journey" }).click();
    await expect(page.locator("#step-title")).toHaveText("Try it in the lab");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("kitab.learning.v1")!).lessons["local-delivery-routing"]);
    expect(saved.experimentsCompleted).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("keyboard and assistive tech: predictions answer by keyboard with visible focus, and no ARIA reference dangles", async ({ page }) => {
  await open(page);
  await toStep(page, "Your PC chooses its next hop");
  const choice = scene(page).locator(".subnet-choices button").first();
  // Reach it the way a keyboard user does, so :focus-visible applies.
  await choice.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(choice).toBeFocused();
  expect(await choice.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(scene(page).locator(".subnet-feedback")).not.toBeEmpty();
  const dangling = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-controls], [aria-describedby], [aria-labelledby]")].flatMap((el) =>
      ["aria-controls", "aria-describedby", "aria-labelledby"].flatMap((a) => (el.getAttribute(a) ?? "").split(/\s+/).filter((id) => id && !document.getElementById(id))),
    ),
  );
  expect(dangling).toEqual([]);
});
