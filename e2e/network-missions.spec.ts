import { test, expect, type Page } from "@playwright/test";

const steps = (page: Page) => page.locator(".mission-steps");
async function openMissionTab(page: Page) {
  await page.getByRole("button", { name: "Mission", exact: true }).click();
}
async function selectDevice(page: Page, name: string) {
  // Keyboard selection: works even when the explanation card sits over a device.
  await page.getByRole("button", { name: `Select ${name}`, exact: true }).focus();
  await page.keyboard.press("Enter");
}

test("a learner investigates, diagnoses, fixes and checks a mission, and progress survives a reload", async ({ page }) => {
  await page.goto("/practice/missions");
  await page.getByRole("link", { name: /No connection/ }).click();
  await expect(page.getByRole("heading", { name: "No connection", level: 1 })).toBeVisible();
  // The brief describes symptoms, not the faulty setting.
  await expect(page.locator(".mission-symptom")).toHaveText("Your PC can't reach the file server at 192.168.1.20.");
  await expect(page.locator(".mission-meta")).toContainText("Version 1 of 4");

  // Investigate with the shared journey.
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.locator(".run-status").getByRole("button", { name: "Show where and why" }).click();
  await expect(page.locator(".journey-card h2")).toHaveText("The next hop cannot be reached on this LAN");

  // Diagnose, using the step on the diagram as evidence.
  await openMissionTab(page);
  await page.getByLabel("Faulty device").selectOption("server");
  await page.getByLabel("Faulty setting").selectOption("link");
  await page.getByRole("button", { name: "Submit diagnosis" }).click();
  await expect(steps(page)).toContainText("Yes: the problem is File server's setting. The step you are showing is good evidence.");

  // Fix it in the Device tab: connect the server's cable.
  await selectDevice(page, "File server");
  // Connections opens by itself for a device with no cable.
  const connections = page.locator(".device-inspector details").filter({ has: page.getByText("Connections", { exact: true }) });
  if (!(await connections.evaluate((d) => (d as HTMLDetailsElement).open))) await connections.locator("summary").click();
  await connections.locator("select").selectOption("switch/p2");
  await page.getByRole("button", { name: "Connect cable" }).click();

  // Check: real traffic proves it, with a link to the proof.
  await openMissionTab(page);
  await page.getByRole("button", { name: "Check my fix" }).click();
  const results = page.getByRole("list", { name: "Check results" });
  await expect(results).toContainText("The client pings the file server and the file server replies");
  await expect(results.locator(".is-failed")).toHaveCount(0);
  const done = page.getByRole("region", { name: "Mission completed" });
  await expect(done).toContainText("What was wrong: The file server had no cable to the switch");
  await done.getByRole("button", { name: /An address only says where a device is/ }).click();
  await expect(done).toContainText("Yes, that is the rule at work.");
  await expect(page.locator(".mission-meta .state-pill")).toHaveText("Completed");
  await expect(steps(page)).toContainText("Solve one more version with a different cause");

  // Reload: the attempt and its network are kept.
  await page.reload();
  await expect(page.locator(".mission-meta .state-pill")).toHaveText("Completed");
  await openMissionTab(page);
  await expect(page.getByRole("region", { name: "Mission completed" })).toBeVisible();
  await page.getByRole("button", { name: /Try another version/ }).click();
  await expect(page.locator(".mission-meta")).toContainText("Version 2 of 4");
  await expect(page.locator(".mission-symptom")).toContainText("Its cable is plugged in.");
  // The mission list shows the same state.
  await page.goto("/practice/missions");
  await expect(page.getByRole("link", { name: /No connection/ }).locator(".state-pill")).toHaveText("Completed");
});

test("a fix completes the mission without a diagnosis, and locked settings say why", async ({ page }) => {
  await page.goto("/practice/missions/neighbours");
  await openMissionTab(page);
  // The prediction comes before the first send.
  await page.getByRole("button", { name: /Nothing: the server looks remote/ }).click();
  await expect(steps(page)).toContainText("Your prediction was right.");
  await selectDevice(page, "Your PC");
  // A gateway cannot help without a router: the lock explains this.
  await page.getByLabel("Default gateway").fill("192.168.1.130");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await expect(page.locator(".network-notice")).toContainText("Default gateways can't be changed in this mission: There is no router on this LAN");
  await page.getByLabel("Default gateway").fill("");
  await page.getByLabel("Prefix length").fill("24");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await openMissionTab(page);
  await page.getByRole("button", { name: "Check my fix" }).click();
  await expect(page.getByRole("region", { name: "Mission completed" })).toBeVisible();
  await expect(steps(page)).toContainText("Name the faulty device and setting correctly on your first try.");
});

test("hints go from a tool, to a principle, to where to look, without giving the value", async ({ page }) => {
  await page.goto("/practice/missions/join-and-address");
  await openMissionTab(page);
  const hints = page.getByRole("region", { name: "Hints" });
  for (let i = 1; i <= 3; i++) await hints.getByRole("button", { name: `Show hint ${i} of 3` }).click();
  await expect(hints).toContainText("Hint 1: Send a DHCP request");
  await expect(hints).toContainText("Hint 2: Joining Wi-Fi gives a link");
  await expect(hints).toContainText("Hint 3: Compare the phone's Wi-Fi settings with the access point's.");
  await expect(hints).not.toContainText("learn123");
  await expect(hints.getByRole("button", { name: "No more hints" })).toBeDisabled();
});

test("the investigation mission is answered from evidence found in the journey", async ({ page }) => {
  await page.goto("/practice/missions/missing-segment");
  await openMissionTab(page);
  await page.getByRole("button", { name: /The same bytes again, with the same sequence number/ }).click();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  // Find the ACK that follows the retransmission and read it in the Packet tab, as a learner would.
  await page.getByRole("radio", { name: "Every event" }).click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.locator(".event-list").getByRole("button", { name: /Acknowledge received bytes/ }).first().click();
  await page.getByRole("button", { name: "Packet", exact: true }).click();
  const ack = await page.locator(".packet-layer.layer-transport dl > div").filter({ hasText: "Acknowledgement" }).locator("dd").first().innerText();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.locator(".event-list").getByRole("button", { name: /Retransmit TCP segment/ }).click();
  await openMissionTab(page);
  await page.getByLabel("Acknowledgement number").fill(ack);
  await page.getByRole("button", { name: "Submit answer" }).click();
  await expect(steps(page)).toContainText("Correct, and the step you are showing is the retransmission evidence.");
  await expect(page.getByRole("region", { name: "Mission completed" })).toBeVisible();
});

test("the playground links to the missions, earlier challenge completions are kept, and a copy opens without touching the workspace", async ({ page }) => {
  await page.goto("/practice/network");
  await page.evaluate(() => localStorage.setItem("kitab.network.challenges.v1", JSON.stringify(["subnet"])));
  await page.reload();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"))).toBeTruthy();
  const workspace = await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"));
  await expect(page.getByRole("link", { name: /Practice missions/ })).toContainText("1/6 done");
  await page.getByRole("link", { name: /Practice missions/ }).click();
  await expect(page.getByRole("link", { name: /Neighbours that look remote/ }).locator(".state-pill")).toHaveText("Completed");
  await page.getByRole("link", { name: /Neighbours that look remote/ }).click();
  await expect(page.locator(".mission-meta .state-pill")).toHaveText("Completed");
  await page.getByRole("button", { name: "Open a copy in the playground" }).click();
  await expect(page.locator(".network-notice")).toContainText("practice copy of a mission network");
  await expect(page.getByLabel("Network name")).toHaveValue("Neighbours that look remote (practice copy)");
  expect(await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"))).toBe(workspace);
});

test("a mission can be worked with the keyboard alone", async ({ page }) => {
  await page.goto("/practice/missions/leave-the-lan");
  // Send from the form with the keyboard.
  await page.getByRole("button", { name: "Send request", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".run-status")).toContainText("Delivery stopped");
  // The prediction appears after the first failure; answer it with the keyboard.
  await page.getByRole("button", { name: "Mission", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /No: the request never reached the server/ }).focus();
  await page.keyboard.press("Enter");
  await expect(steps(page)).toContainText("Your prediction was right.");
  await selectDevice(page, "Your PC");
  await page.getByLabel("Default gateway").focus();
  await page.keyboard.type("192.168.1.1");
  await page.getByRole("button", { name: "Apply settings", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Mission", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Check my fix" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Mission completed" })).toBeVisible();
});

test("a mission failure is explained once, at the failing step, and shortcuts are refused with the reason", async ({ page }) => {
  await page.goto("/practice/missions/bring-reply-home");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.locator(".run-status").getByRole("button", { name: "Show where and why" }).click();
  await expect(page.locator(".journey-card")).toContainText("private address (RFC 1918)");
  expect(await page.evaluate(() => document.body.innerText.split("Internet routers do not route to private home networks").length - 1)).toBe(1);
  // In a mission the learner works out the fix: the step keeps its evidence but not "Where to look".
  await page.locator(".journey-card").getByRole("button", { name: "Why it stopped" }).click();
  await expect(page.locator(".step-guide")).toContainText("Caused by");
  await expect(page.locator(".step-guide")).not.toContainText("Where to look:");
  // The repair suggestion would hand over the fix (turn NAT back on): it appears nowhere on the page.
  expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/What to try|home router uses NAT/);
  await page.locator(".journey-card").getByRole("button", { name: "Less detail" }).click();
  // The ISP route makes the page load, but the check refuses it and says why.
  await page.getByRole("button", { name: "Select ISP router", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByText("Routing & NAT", { exact: true }).click();
  await page.getByRole("button", { name: "Add static route" }).click();
  await page.getByLabel("Destination network").fill("192.168.1.0");
  await page.getByLabel("Route prefix").fill("24");
  await page.getByLabel("Next-hop IP").fill("203.0.113.2");
  await page.getByLabel("Outgoing port").fill("lan");
  await page.getByRole("button", { name: "Apply settings", exact: true }).click();
  await openMissionTab(page);
  await page.getByRole("button", { name: "Check my fix" }).click();
  const results = page.getByRole("list", { name: "Check results" });
  await expect(results).toContainText("Real providers do not route private addresses (RFC 1918)");
  await expect(page.getByRole("region", { name: "Mission completed" })).toHaveCount(0);
});
