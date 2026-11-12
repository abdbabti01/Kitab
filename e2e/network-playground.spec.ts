import { test, expect, type Page } from "@playwright/test";
/** Shows every event, then selects one from the Steps tab by title (and device). */
async function goToEvent(page: Page, name: RegExp) {
  await page.getByRole("radio", { name: "Every event" }).click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.locator(".event-list").getByRole("button", { name }).first().click();
}
test("practice workspace runs and rewinds a real HTTP journey", async ({
  page,
}) => {
  await page.goto("/practice/network");
  await expect(
    page.getByRole("heading", { name: "Network playground" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  const card = page.locator(".journey-card");
  await page.getByRole("button", { name: "Last event", exact: true }).click();
  await expect(card).toContainText("Page delivered");
  await expect(card).toContainText("The page arrived, and both sides closed the connection");
  await expect(page.locator(".packet-inspector")).toContainText(
    "Hello from your network",
  );
  await page.getByRole("button", { name: "First event", exact: true }).click();
  await expect(card).toContainText("Prepare the HTTP request");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("device settings affect delivery and designs survive reload", async ({
  page,
}) => {
  await page.goto("/practice/network");
  await page.getByLabel("Starter network").selectOption("routed");
  await page
    .getByRole("button", { name: "Select Your PC", exact: true })
    .click();
  await page.getByLabel("Default gateway").fill("192.168.1.99");
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("Delivery stopped");
  await page.locator(".run-status").getByRole("button", { name: "Show where and why" }).click();
  await expect(page.locator(".journey-card")).toContainText("ARP");
  await page.reload();
  await page
    .getByRole("button", { name: "Select Your PC", exact: true })
    .click();
  await expect(page.getByLabel("Default gateway")).toHaveValue("192.168.1.99");
});
test("adding and undoing devices works without dragging", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Starter network").selectOption("empty");
  await page.getByRole("button", { name: "Add PC", exact: true }).click();
  await expect(page.getByRole("button", { name: /Select PC/ })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: /Select PC/ })).toHaveCount(0);
});

test("switching device types and adding a routed interface keeps the editor usable", async ({
  page,
}) => {
  await page.goto("/practice/network");
  await page
    .getByRole("button", { name: "Select Your PC", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select Home router", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Add routed interface", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: /Interface \/ port/ }),
  ).toHaveValue("eth2");
  await page
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Select Your phone", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: /Interface \/ port/ }),
  ).toHaveValue("wlan0");
});

test("undoing a move keeps the DHCP lease and replay", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Source device").selectOption("phone");
  await page.getByLabel("Traffic type").selectOption("dhcp");
  await page
    .getByRole("button", { name: "Configure automatically", exact: true })
    .click();
  await page.getByRole("button", { name: "Last event", exact: true }).click();
  const phone = page.getByRole("button", {
    name: "Select Your phone",
    exact: true,
  });
  await phone.focus();
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText(
    "received 192.168.1.100",
  );
  await expect(phone).toContainText("192.168.1.100");
});

test("step explanations pause playback and explain DHCP recipients", async ({
  page,
}) => {
  await page.goto("/practice/network");
  await page.getByLabel("Source device").selectOption("phone");
  await page.getByLabel("Traffic type").selectOption("dhcp");
  await page
    .getByRole("button", { name: "Configure automatically", exact: true })
    .click();
  await goToEvent(page, /DHCP Discover/);
  await page.getByRole("button", { name: "Play journey", exact: true }).click();
  // Reading the details pauses playback.
  await page.locator(".journey-card").getByRole("button", { name: "Why and how" }).click();
  await expect(
    page.getByRole("button", { name: "Play journey", exact: true }),
  ).toBeVisible();
  // Device names distinguish repeated receive events and must remain visible on phones.
  await expect(page.locator(".event-list small").filter({ hasText: "Your PC" }).first()).toBeVisible();
  await page
    .locator(".event-list")
    .getByRole("button", { name: /Receive frame Your PC$/ })
    .first()
    .click();
  await expect(page.locator(".step-guide")).toContainText("does not answer");
  await page.getByText("Who receives it, and what happens next?", { exact: true }).click();
  await expect(page.locator(".step-guide")).toContainText("port 68 → 67");
  await page.locator(".event-list").getByRole("button", { name: /DHCP Offer/ }).first().click();
  await expect(page.locator(".step-guide")).toContainText(
    "not simply because it is a router",
  );
  await expect(page.locator(".step-guide details")).toHaveAttribute("open", "");
  await expect(page.locator(".step-guide")).toContainText("port 67 → 68");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("TCP steps disclose stop-and-wait and link to the send-window mission", async ({
  page,
}) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await goToEvent(page, /Create TCP segment/);
  await page.locator(".journey-card").getByRole("button", { name: "Why and how" }).click();
  const note = page.locator(".step-note");
  await expect(note).toContainText("Real TCP keeps several segments in flight");
  await note.getByRole("link").click();
  await expect(page).toHaveURL(/\/missions\/tcp-send-window$/);
  await expect(page.getByRole("heading", { name: "How full can the pipe get?" })).toBeVisible();
});
test("no playground control is clipped or pushed off screen", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  // Checks real clipping: a control wider than the viewport or than its nearest overflow-clipping ancestor.
  const clipped = await page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    for (const el of document.querySelectorAll(".network-playground :is(button, select, input, a, label)")) {
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      let box = { left: 0, right: vw };
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement)
        if (/hidden|auto|scroll|clip/.test(getComputedStyle(p).overflowX)) {
          box = p.getBoundingClientRect();
          break;
        }
      if (r.right > Math.min(vw, box.right) + 1 || r.left < Math.max(0, box.left) - 1)
        out.push(el.getAttribute("aria-label") ?? el.textContent!.trim().slice(0, 30));
    }
    return out;
  });
  expect(clipped).toEqual([]);
});
test("a typing mistake is shown at the field, not as a network failure", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Destination").fill("https://kitab.test/");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("HTTP on port 80");
  await expect(page.getByLabel("Destination")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator(".run-status")).toHaveCount(0);
  await page.getByLabel("Destination").fill("http://kitab.test/");
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("a failure names its cause chain and where to look", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Select Home router", exact: true }).click();
  await page.getByText("Routing & NAT", { exact: true }).click();
  await page.getByLabel("Enable NAT / port translation").uncheck();
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("Delivery stopped at ISP router");
  await page.locator(".run-status").getByRole("button", { name: "Show where and why" }).click();
  const card = page.locator(".journey-card");
  await expect(card.locator("h2")).toHaveText("The DNS answer could not come back");
  await card.getByRole("button", { name: "Why it stopped" }).click();
  const guide = page.locator(".step-guide");
  await expect(guide.getByRole("list", { name: "What caused it" })).toContainText("No route to a private address");
  await expect(guide).toContainText("Where to look:");
  // The playground also gives the simulator's repair suggestion; missions leave it out.
  await expect(guide).toContainText("What to try: Replies reach a home network through its public address when the home router uses NAT.");
});
test("a step links to the earlier step that caused it and cites its rule", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByLabel("Source device").selectOption("phone");
  await page.getByLabel("Traffic type").selectOption("dhcp");
  await page.getByRole("button", { name: "Configure automatically", exact: true }).click();
  await goToEvent(page, /Apply DHCP lease/);
  await expect(page.locator(".journey-card .journey-summary")).toContainText("now uses 192.168.1.100/24, gateway 192.168.1.1");
  await page.locator(".journey-card").getByRole("button", { name: "Why and how" }).click();
  const guide = page.locator(".step-guide");
  await guide.getByRole("button", { name: /^Go to step \d+: DHCP ACK$/ }).click();
  await expect(page.locator(".journey-card h2")).toHaveText("DHCP ACK");
  await page.getByText("Who receives it, and what happens next?", { exact: true }).click();
  await expect(guide.locator("cite")).toHaveText("RFC 2131 §3.1");
  await expect(guide).toContainText("unicast unless the client sets the broadcast flag");
});

test("Follow the journey: the card explains each stage beside the diagram and both views share one position", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  // Send plays the journey; going back to the first event pauses it there.
  await page.getByRole("button", { name: "First event", exact: true }).click();
  const card = page.locator(".journey-card");
  const position = page.locator(".journey-position");
  // Summary is the first-visit view: Next moves a whole stage.
  await expect(page.getByRole("radio", { name: "Summary" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Next stage", exact: true }).click();
  await page.getByRole("button", { name: "Next stage", exact: true }).click();
  await expect(position).toContainText("Stage 3 of 27");
  await expect(card.locator("h2")).toHaveText("ARP · Your PC looks for 192.168.1.1");
  await expect(card).toContainText("Home router answered with its MAC");
  // The stage's devices stay prominent; unrelated ones are dimmed but still there.
  await expect(page.getByRole("button", { name: "Select ISP router", exact: true })).toHaveClass(/is-dimmed/);
  await expect(page.getByRole("button", { name: "Select Home router", exact: true })).not.toHaveClass(/is-dimmed/);
  // Switching views keeps the same event; Next then moves one event.
  const at = await position.locator("small").innerText();
  await page.getByRole("radio", { name: "Every event" }).click();
  await expect(position).toContainText(at.match(/event (\d+)/)![1]);
  await page.getByRole("button", { name: "Next event", exact: true }).click();
  await expect(position).toContainText("Event 26 of 489");
  await expect(card.locator("h2")).toHaveText("Wrap in a link frame");
  // The view is remembered on this device.
  await page.reload();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "First event", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Every event" })).toHaveAttribute("aria-checked", "true");
  // The card can be hidden and brought back, and the step is announced for screen readers.
  await card.getByRole("button", { name: "Hide the explanation" }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "Show the explanation" }).click();
  await expect(card).toBeVisible();
  await expect(page.locator(".journey-stage [aria-live]")).toHaveText(/^Event 1 of 489: Prepare HTTP request$/);
});

test("a stage in progress never claims its later events already happened", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByLabel("Journey timeline").fill("10");
  const card = page.locator(".journey-card");
  await expect(card.locator("h2")).toHaveText("ARP · Your PC looks for 192.168.1.1");
  await expect(card).toContainText("In progress: event 8 of 22 in this stage.");
  await expect(card).not.toContainText("Home router answered");
});

test("on the desktop the card sits on the diagram without covering the stage's devices or the zoom controls", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "Floating placement applies to wide canvases");
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Next stage", exact: true }).click();
  await page.getByRole("button", { name: "Next stage", exact: true }).click();
  const overlap = await page.evaluate(() => {
    const card = document.querySelector(".journey-card")!.getBoundingClientRect();
    const hits = (r: DOMRect) => r.left < card.right && r.right > card.left && r.top < card.bottom && r.bottom > card.top;
    return [...document.querySelectorAll(".network-device:not(.is-dimmed) .device-tile, .canvas-zoom")]
      .filter((el) => hits(el.getBoundingClientRect()))
      .map((el) => el.closest("[aria-label]")?.getAttribute("aria-label") ?? el.className);
  });
  expect(overlap).toEqual([]);
  const canvas = await page.locator(".network-canvas").boundingBox();
  const box = await page.locator(".journey-card").boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height);
});
test("the packet inspector follows one packet, shows what changed at each link and why", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("radio", { name: "Every event" }).click();
  // The DNS query's frame from the home router to the ISP router: NAT and TTL have rewritten it.
  await page.getByLabel("Journey timeline").fill("43");
  await expect(page.locator(".journey-position")).toContainText("Event 44 of 489");
  await page.getByRole("button", { name: "Packet", exact: true }).click();
  const changes = page.getByRole("region", { name: "Changed since the previous link" });
  await expect(changes).toContainText("Source IP 192.168.1.10 → 203.0.113.2");
  await expect(changes).toContainText("translated the private source");
  await expect(changes).toContainText("TTL 64 → 63");
  const trip = page.getByRole("region", { name: "Follow this packet" });
  await expect(trip.locator("li")).toHaveCount(5);
  await trip.getByRole("button", { name: /DNS server/ }).click();
  await expect(page.locator(".journey-card h2")).toHaveText("Transmit over Ethernet");
  await expect(page.locator(".packet-identity")).toContainText("On link 5 of 5");
});
test("selecting a device during a run explains its part in that run", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Last event", exact: true }).click();
  // A device the card happens to cover stays reachable from the keyboard.
  await page.getByRole("button", { name: "Select Home router", exact: true }).focus();
  await page.keyboard.press("Enter");
  const role = page.getByRole("region", { name: "Home router in this run" });
  await expect(role).toContainText("Here it also runs a DHCP server and NAT");
  await expect(role).toContainText(/Translated \d+ outgoing packets to its public address \(NAT\)/);
  await expect(role).toContainText("does not pass local broadcasts");
});
test("the first run starts from the diagram, and sending brings the journey into view", async ({ page }, info) => {
  await page.goto("/practice/network");
  const start = page.locator(".network-canvas").getByRole("button", { name: "Send request and follow it" });
  await expect(start).toBeInViewport();
  await start.click();
  await expect(page.locator(".journey-card")).toBeVisible();
  await expect(start).toHaveCount(0);
  // Sending again from the form further down the page scrolls back to the diagram.
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect.poll(() => page.locator(".journey-stage").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(200);
  // Narrow screens follow the journey by zooming to the current stage.
  const zoom = page.getByLabel("Zoom to the current stage");
  if (info.project.name === "phone-390") await expect(zoom).toBeChecked();
  else await expect(zoom).not.toBeChecked();
});
test("each path starter opens with the action its path step promises", async ({ page }) => {
  const starters = [
    { id: "lan", note: "ping the local server at 192.168.1.20", kind: "ping", from: "pc", result: "Ping succeeded", first: "Send a ping", last: "Ping complete" },
    { id: "wifi", note: "joins the Wi-Fi network at the access point", kind: "dhcp", from: "phone", result: "Your phone received 192.168.1.100", first: "Join Wi-Fi", last: "DHCP ACK" },
    { id: "routed", note: "sends the packet to its default gateway", kind: "ping", from: "pc", result: "Ping succeeded", first: "Send a ping", last: "Ping complete" },
  ];
  for (const s of starters) {
    await page.goto(`/practice/network?starter=${s.id}`);
    await expect(page.locator(".network-notice")).toContainText(s.note);
    await expect(page.getByLabel("Source device")).toHaveValue(s.from);
    await expect(page.getByLabel("Traffic type")).toHaveValue(s.kind);
    await page.locator(".send-button").click();
    await expect(page.locator(".run-status")).toContainText(s.result);
    await expect(page.locator(".journey-card")).toContainText(s.first);
    await page.getByRole("button", { name: "Last event", exact: true }).click();
    await expect(page.locator(".journey-card")).toContainText(s.last);
  }
});
test("the Internet starter makes its preparation explicit: DHCP on the phone first, then the page", async ({ page }) => {
  await page.goto("/practice/network?starter=internet");
  const notice = page.locator(".network-notice");
  await expect(notice).toContainText("Step 1 of 2");
  await expect(page.getByLabel("Source device")).toHaveValue("phone");
  await page.getByRole("button", { name: "Configure automatically", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("Your phone received 192.168.1.100");
  await expect(notice).toContainText("Step 2 of 2");
  await expect(page.getByLabel("Traffic type")).toHaveValue("http");
  await expect(page.getByLabel("Destination")).toHaveValue("http://kitab.test/");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("HTTP 200 OK");
  await page.getByRole("button", { name: "Last event", exact: true }).click();
  await expect(page.locator(".journey-card")).toContainText("Page delivered");
  // The learner's own saved design is untouched by the starter.
  expect(await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"))).toBeNull();
});
test("guided steps advance only on success, and a reset or edit returns to the step whose state it discarded", async ({ page }) => {
  await page.goto("/practice/network?starter=internet");
  const notice = page.locator(".network-notice");
  const send = page.locator(".send-button");
  // A failed DHCP run does not advance: a wrong passphrase keeps the phone off Wi-Fi.
  await page.getByRole("button", { name: "Select Your phone", exact: true }).click();
  await page.getByLabel("Wi-Fi passphrase").fill("wrong");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await send.click();
  await expect(page.locator(".run-status")).toContainText("Delivery stopped");
  await expect(page.getByLabel("Traffic type")).toHaveValue("dhcp");
  await expect(page.getByText("Step 2 of 2")).toHaveCount(0);
  // Undoing the edit and succeeding advances to step 2, whose first stage says the phone is still on Wi-Fi.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await send.click();
  await expect(notice).toContainText("Step 2 of 2");
  await expect(page.getByLabel("Traffic type")).toHaveValue("http");
  // Restarting discards the lease, so the guidance goes back to step 1 instead of promising an address.
  await page.getByRole("button", { name: "Restart simulation" }).click();
  await expect(notice).toContainText("Step 1 of 2");
  await expect(page.getByLabel("Traffic type")).toHaveValue("dhcp");
  await send.click();
  await expect(notice).toContainText("Step 2 of 2");
  // Editing the network between steps resets the run too.
  await page.getByRole("button", { name: "Select Your PC", exact: true }).click();
  await page.getByLabel("Device name").fill("Desk PC");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(notice).toContainText("Network updated");
  await expect(notice).toContainText("Step 1 of 2");
  await expect(page.getByLabel("Traffic type")).toHaveValue("dhcp");
  await send.click();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(page.locator(".run-status")).toContainText("HTTP 200 OK");
  await expect(page.locator(".journey-card")).toContainText("Still on Wi-Fi");
  await expect(page.locator(".journey-card")).toContainText("keeps 192.168.1.100 from its DHCP lease");
});
test("changing the form leaves the guidance, and a reload starts the starter again from step 1", async ({ page }) => {
  await page.goto("/practice/network?starter=internet");
  await page.getByLabel("Source device").selectOption("pc");
  await page.getByLabel("Traffic type").selectOption("ping");
  await page.getByLabel("Destination").fill("192.168.1.1");
  await page.locator(".send-button").click();
  await expect(page.locator(".run-status")).toContainText("Ping succeeded");
  await expect(page.getByLabel("Traffic type")).toHaveValue("ping");
  await expect(page.locator(".network-notice")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".network-notice")).toContainText("Step 1 of 2");
  await expect(page.getByLabel("Source device")).toHaveValue("phone");
  await expect(page.getByLabel("Traffic type")).toHaveValue("dhcp");
});
test("a starter copy says it is not saved, and switching starters inside it never overwrites the saved design", async ({ page }) => {
  // Seed from a page that never writes the workspace itself.
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("kitab.network.workspace.v1", JSON.stringify({ version: 1, name: "My home lab", devices: [], links: [] })));
  await page.goto("/practice/network?starter=lan");
  await expect(page.locator(".save-status")).toHaveText("Practice copy · not saved");
  await page.getByLabel("Starter network").selectOption("routed");
  await expect(page.getByLabel("Network name")).toHaveValue("Two connected LANs");
  await expect(page.locator(".network-notice")).toContainText("default gateway");
  await page.locator(".send-button").click();
  await expect(page.locator(".run-status")).toContainText("Ping succeeded");
  await expect(page.locator(".save-status")).toHaveText("Practice copy · not saved");
  expect(await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"))).toContain("My home lab");
  // The learner's own playground still opens their design, which autosaves as before.
  await page.goto("/practice/network");
  await expect(page.getByLabel("Network name")).toHaveValue("My home lab");
  await expect(page.locator(".save-status")).toHaveText("Saved on this device");
});

test("the Wi-Fi starters say a real phone joins and starts DHCP by itself, and the home router names the PC", async ({ page }) => {
  for (const s of ["wifi", "internet"]) {
    await page.goto(`/practice/network?starter=${s}`);
    await expect(page.locator(".network-notice")).toContainText("A real phone does both by itself when you choose the network.");
  }
  await page.goto("/practice/network?starter=wifi");
  await page.getByRole("button", { name: "Select Home router", exact: true }).click();
  await expect(page.locator(".dns-record").first().locator("input").first()).toHaveValue("pc.home.arpa");
});

test("Send plays the journey at once; pause holds it, and the end says how it finished", async ({ page }) => {
  await page.goto("/practice/network?starter=routed");
  await page.locator(".journey-start").click();
  // Nothing else to press: playback runs, the focus is on Pause, and a frame crosses a link within seconds.
  await expect(page.locator(".playback-state")).toHaveText("Playing");
  await expect(page.getByRole("button", { name: "Pause playback" })).toBeFocused();
  await expect(page.locator(".packet-token animateMotion")).toHaveCount(1, { timeout: 8000 });
  await expect(page.locator(".network-wire.active")).toHaveClass(/kind-/);
  await page.getByRole("button", { name: "Pause playback" }).click();
  await expect(page.locator(".playback-state")).toHaveText("Paused");
  const at = await page.locator(".journey-position small").innerText();
  await page.waitForTimeout(2500);
  await expect(page.locator(".journey-position small")).toHaveText(at);
  await page.getByRole("button", { name: "Last event", exact: true }).click();
  await expect(page.locator(".playback-state")).toHaveText("Complete");
  // Play at the end replays from the start.
  await page.getByRole("button", { name: "Play journey" }).click();
  await expect(page.locator(".journey-position small")).toContainText(/event [12] of 39/);
});
