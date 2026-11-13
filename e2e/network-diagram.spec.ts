import { test, expect, type Page } from "@playwright/test";
import { toLast, openSteps } from "./track.ts";

// The redesigned diagram: readable on a phone without zooming, what each device is doing, and the packet's movement
// matching the trace event by event.

/** Device tiles and their labels in the visible part of the diagram, in screen pixels. */
const drawn = (page: Page) =>
  page.evaluate(() => {
    const svg = document.querySelector(".topology-svg")!.getBoundingClientRect();
    return [...document.querySelectorAll(".network-device[data-device]")].flatMap((g) => {
      const tile = g.querySelector(".device-tile")!.getBoundingClientRect();
      if (tile.bottom < svg.top || tile.top > svg.bottom || tile.right < svg.left || tile.left > svg.right) return [];
      const parts = [tile, g.querySelector(".device-name")!.getBoundingClientRect(), g.querySelector(".device-ip")!.getBoundingClientRect()];
      const scale = (g as SVGGraphicsElement).ownerSVGElement!.getScreenCTM()!.a;
      return [{
        id: g.getAttribute("data-device"),
        tile: { w: tile.width, h: tile.height },
        box: { l: Math.min(...parts.map((r) => r.left)), r: Math.max(...parts.map((r) => r.right)), t: Math.min(...parts.map((r) => r.top)), b: Math.max(...parts.map((r) => r.bottom)) },
        namePx: parseFloat(getComputedStyle(g.querySelector(".device-name")!).fontSize) * scale,
      }];
    });
  });
const overlapping = (ds: Awaited<ReturnType<typeof drawn>>) =>
  ds.flatMap((a, i) => ds.slice(i + 1).filter((b) => a.box.l < b.box.r - 1 && a.box.r > b.box.l + 1 && a.box.t < b.box.b - 1 && a.box.b > b.box.t + 1).map((b) => `${a.id}/${b.id}`));

test("on a phone the network is arranged in readable rows that fit the screen, with nothing on top of a device", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-390", "The stacked layout is for narrow screens");
  await page.goto("/practice/network");
  await expect(page.locator(".network-canvas")).toHaveClass(/is-stacked/);
  const ds = await drawn(page);
  expect(ds.length).toBeGreaterThan(0);
  for (const d of ds) {
    expect(d.tile.w, `${d.id} tile`).toBeGreaterThanOrEqual(44);
    expect(d.namePx, `${d.id} name`).toBeGreaterThanOrEqual(12);
  }
  expect(overlapping(ds)).toEqual([]);
  // The canvas's own controls are in a bar of their own, not over the drawing.
  const bar = (await page.locator(".canvas-bar").boundingBox())!;
  const svg = (await page.locator(".topology-svg").boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(svg.y + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // The learner's own layout is one tap away, and back.
  await page.getByRole("button", { name: "Rows" }).click();
  await expect(page.locator(".network-canvas")).not.toHaveClass(/is-stacked/);
  await page.getByRole("button", { name: "My layout" }).click();
  await expect(page.locator(".network-canvas")).toHaveClass(/is-stacked/);
});

test("a branching network of the learner's own is laid out without overlaps, and playback keeps the active devices in view", async ({ page }, info) => {
  test.skip(info.project.name !== "phone-390", "The stacked layout is for narrow screens");
  await page.goto("/");
  // Two LANs joined by two routers: a switch with five desks on one side, two servers on the other.
  await page.evaluate(() => {
    let mac = 0;
    const dev = (kind: string, id: string, name: string, ports: string[], ip: Record<string, string> = {}, gateway = "") => ({
      id, name, kind, x: 100, y: 100, group: "", routes: [] as unknown[], ssid: "", password: "", nat: false, inside: "lan", outside: "wan", records: {}, web: { enabled: false, body: "" },
      dhcp: { enabled: false, port: ports[0], start: "", end: "", gateway: "", dns: "", leaseSeconds: 3600 },
      interfaces: ports.map((p, i) => ({ id: p, medium: "ethernet", mac: `02:00:00:00:${(++mac).toString(16).padStart(2, "0")}:${i.toString(16).padStart(2, "0")}`, ip: ip[p] ?? "", prefix: p === "wan" ? 30 : 24, gateway, dns: "", mode: "static", enabled: true })),
    });
    const desks = [1, 2, 3, 4, 5].map((i) => ({ ...dev("pc", `desk${i}`, `Desk ${i}`, ["eth0"], { eth0: `192.168.1.1${i}` }, "192.168.1.1"), x: 150, y: 60 + i * 110 }));
    const r1 = { ...dev("router", "r1", "Branch router", ["lan", "wan"], { lan: "192.168.1.1", wan: "10.0.0.1" }), x: 650, y: 360, routes: [{ network: "192.168.2.0", prefix: 24, via: "10.0.0.2", port: "wan" }] };
    const r2 = { ...dev("router", "r2", "Head office router", ["lan", "wan"], { lan: "192.168.2.1", wan: "10.0.0.2" }), x: 900, y: 360, routes: [{ network: "192.168.1.0", prefix: 24, via: "10.0.0.1", port: "wan" }] };
    const s1 = { ...dev("switch", "s1", "Floor switch", ["p1", "p2", "p3", "p4", "p5", "p6"]), x: 420, y: 360 };
    const s2 = { ...dev("switch", "s2", "Head office switch", ["p1", "p2", "p3", "p4", "p5", "p6"]), x: 1150, y: 360 };
    const web = { ...dev("server", "web", "Web server", ["eth0"], { eth0: "192.168.2.21" }, "192.168.2.1"), x: 1400, y: 470 };
    const files = { ...dev("server", "files", "File server", ["eth0"], { eth0: "192.168.2.20" }, "192.168.2.1"), x: 1400, y: 250 };
    const link = (id: string, a: string, ap: string, b: string, bp: string) => ({ id, a: { device: a, port: ap }, b: { device: b, port: bp }, medium: "ethernet" });
    const links = [link("l0", "s1", "p1", "r1", "lan"), ...desks.map((d, i) => link(`d${i}`, "s1", `p${i + 2}`, d.id, "eth0")), link("w", "r1", "wan", "r2", "wan"), link("l1", "s2", "p1", "r2", "lan"), link("l2", "s2", "p2", "files", "eth0"), link("l3", "s2", "p3", "web", "eth0")];
    localStorage.setItem("kitab.network.workspace.v1", JSON.stringify({ version: 1, name: "Branch and head office", devices: [...desks, r1, r2, s1, s2, files, web], links }));
  });
  await page.goto("/practice/network");
  await expect(page.getByLabel("Network name")).toHaveValue("Branch and head office");
  await expect(page.locator(".network-canvas")).toHaveClass(/is-stacked/);
  expect(overlapping(await drawn(page))).toEqual([]);
  await page.getByLabel("Source device").selectOption("desk3");
  await page.getByLabel("Traffic type").selectOption("ping");
  await page.getByLabel("Destination").fill("192.168.2.21");
  await page.locator(".journey-start").click();
  // Wherever the run goes, the device acting now is drawn inside the view.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(1500);
    const inView = await page.evaluate(() => {
      const svg = document.querySelector(".topology-svg")!.getBoundingClientRect();
      const t = document.querySelector(".network-device.is-active .device-tile")?.getBoundingClientRect();
      return !t || (t.top >= svg.top - 2 && t.bottom <= svg.bottom + 2 && t.left >= svg.left - 2 && t.right <= svg.right + 2);
    });
    expect(inView).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the acting device says what it is doing and what it decided, and the chosen link is marked before the frame is sent", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network?starter=routed");
  await page.locator(".journey-start").click();
  // Something on the diagram changes at once: the source device is active and labelled.
  await expect(page.locator(".action-tag")).toHaveCount(1);
  await expect(page.locator(".network-device.is-active")).toHaveAttribute("data-device", "pc");
  await page.getByRole("radio", { name: "Every event" }).click();
  await page.getByLabel("Journey timeline").fill("1");
  await expect(page.locator(".action-title")).toHaveText("Choose a route");
  await expect(page.locator(".action-detail")).toHaveText("Next hop 192.168.1.1 (Router)");
  await expect(page.locator(".network-wire.is-chosen")).toHaveCount(1);
  // A failing step is labelled at the device where it stopped.
  await page.goto("/practice/network?starter=routed");
  await page.getByLabel("Destination").fill("192.168.2.99");
  await page.locator(".journey-start").click();
  const timeline = page.getByLabel("Journey timeline");
  await timeline.fill((await timeline.getAttribute("max")) ?? "0");
  await expect(page.locator(".action-tag.is-stopped")).toHaveCount(1);
  await expect(page.locator(".network-device.is-stopped")).toHaveCount(1);
});

test("every event of the two-LAN ping is drawn as the trace records it", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "One viewport is enough: the drawing reads the same state everywhere");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network?starter=routed");
  await page.locator(".journey-start").click();
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.getByRole("radio", { name: "Every event" }).click();
  await toLast(page);
  await openSteps(page);
  const titles = await page.locator(".event-list button b").allTextContents();
  const actors = await page.locator(".event-list button small").allTextContents();
  expect(titles).toHaveLength(39);
  for (let i = 0; i < titles.length; i++) {
    await page.getByLabel("Journey timeline").fill(String(i));
    await expect(page.locator(".action-title")).toHaveText(titles[i]);
    const token = page.locator(".packet-token:not(.is-held)");
    if (/^Transmit over/.test(titles[i])) {
      // A frame crossing a link: from the device that sends it, which the diagram marks as the sender.
      await expect(token).toHaveAttribute("aria-label", new RegExp(`from ${actors[i]} to `));
      await expect(page.locator(".network-device.is-sender")).toHaveAttribute("aria-label", `Select ${actors[i]}`);
    } else {
      await expect(token).toHaveCount(0);
      await expect(page.locator(".network-device.is-active")).toHaveAttribute("aria-label", `Select ${actors[i]}`);
    }
  }
});

test("on a desktop the arranged rows are a choice: switching never moves or saves a device", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "The learner's own layout is the default on wide screens");
  await page.goto("/practice/network");
  await page.waitForFunction(() => localStorage.getItem("kitab.network.workspace.v1"));
  const saved = await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"));
  await expect(page.locator(".network-canvas")).not.toHaveClass(/is-stacked/);
  await page.getByRole("button", { name: "My layout" }).click();
  await expect(page.locator(".network-canvas")).toHaveClass(/is-stacked/);
  expect(overlapping(await drawn(page))).toEqual([]);
  // The choice is remembered on this device; the network itself is untouched.
  await page.reload();
  await expect(page.locator(".network-canvas")).toHaveClass(/is-stacked/);
  await page.getByRole("button", { name: "Rows" }).click();
  await expect(page.locator(".network-canvas")).not.toHaveClass(/is-stacked/);
  expect(await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"))).toBe(saved);
});
