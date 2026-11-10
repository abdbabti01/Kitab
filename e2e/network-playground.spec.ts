import { test, expect } from "@playwright/test";
test("practice workspace runs and rewinds a real HTTP journey", async ({
  page,
}) => {
  await page.goto("/practice/network");
  await expect(
    page.getByRole("heading", { name: "Network playground" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Last event", exact: true }).click();
  await expect(page.locator(".event-explanation")).toContainText(
    "HTTP journey complete",
  );
  await expect(page.locator(".packet-inspector")).toContainText(
    "Hello from your network",
  );
  await page.getByRole("button", { name: "First event", exact: true }).click();
  await expect(page.locator(".event-explanation")).toContainText(
    "Prepare HTTP request",
  );
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
  await expect(page.locator(".event-explanation")).toContainText("ARP");
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
  await page
    .getByRole("button", { name: "DHCP Discover", exact: true })
    .click();
  await page.getByRole("button", { name: "Play journey", exact: true }).click();
  await page
    .getByText("Who receives it, and what happens next?", { exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Play journey", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show event list", exact: true })
    .click();
  // Device names distinguish repeated receive events and must remain visible on phones.
  await expect(page.locator(".event-list small").filter({ hasText: "Your PC" }).first()).toBeVisible();
  await page
    .locator(".event-list")
    .getByRole("button", { name: /Receive frame Your PC$/ })
    .first()
    .click();
  await expect(page.locator(".step-guide")).toContainText("does not answer");
  await expect(page.locator(".step-guide")).toContainText("port 68 → 67");
  await page.getByRole("button", { name: "DHCP Offer", exact: true }).click();
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
test("challenge feedback explains unfinished runs and what a pass proved", async ({
  page,
}) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: /Challenges/ }).click();
  const verdict = page.locator(".challenge-verdict");
  await page.getByLabel("Choose a challenge").selectOption("nat");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(verdict).toContainText("The network stopped the delivery.");
  // The reason is explained once, at the failing step; the verdict and status only point to it.
  await verdict.getByRole("button", { name: "Show where and why" }).click();
  await expect(page.locator(".event-explanation")).toContainText("private address (RFC 1918)");
  expect(await page.evaluate(() => document.body.innerText.split("Internet routers do not route to private home networks").length - 1)).toBe(1);

  await page.getByLabel("Choose a challenge").selectOption("loss");
  await expect(verdict).toHaveCount(0);
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(verdict).toContainText("no segment was lost");
  await page.getByLabel("Drop one data segment").check();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(verdict).toContainText("Challenge complete. What you proved:");
  await expect(page.locator(".challenge-goal")).toContainText("Completed");
  await expect(page.getByRole("button", { name: /Challenges/ })).toContainText("1/6");
});
test("TCP steps disclose stop-and-wait and link to the send-window mission", async ({
  page,
}) => {
  await page.goto("/practice/network");
  await page.getByLabel("Starter network").selectOption("lan");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "TCP wrapping", exact: true }).click();
  const note = page.locator(".step-note");
  await expect(note).toContainText("Real TCP keeps several segments in flight");
  await note.getByRole("link").click();
  await expect(page).toHaveURL(/\/missions\/tcp-send-window$/);
  await expect(page.getByRole("heading", { name: "How full can the pipe get?" })).toBeVisible();
});
test("no playground control is clipped or pushed off screen", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.getByRole("button", { name: "Show event list", exact: true }).click();
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
  const guide = page.locator(".step-guide");
  await expect(guide.locator(".failure-title")).toHaveText("The DNS answer could not come back");
  await expect(guide.getByRole("list", { name: "What caused it" })).toContainText("No route to a private address");
  await expect(guide).toContainText("Where to look:");
});
