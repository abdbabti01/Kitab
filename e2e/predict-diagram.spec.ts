import { test, expect, type Page } from "@playwright/test";

// Predict on the diagram: the switch at the top of the lab, the question's device marked, and the devices a choice
// names as lettered answers. Tapping one chooses it; only "Check my prediction" submits.
const question = (page: Page) => page.getByRole("region", { name: "Prediction", exact: true });
const answers = (page: Page) => page.locator(".network-device.is-answer");
async function start(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  // The switch is in the diagram's own bar, at the top of the lab.
  const toggle = page.locator(".canvas-bar").getByLabel("Predict as you go");
  await expect(toggle).toBeVisible();
  await toggle.check();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(question(page)).toBeVisible();
}

test("the question is marked on the device that decides, and its answers are lettered devices", async ({ page }, info) => {
  await start(page);
  await expect(page.locator(".network-device.is-asking")).toHaveAttribute("aria-label", "Select Your PC, where the question is asked");
  await expect(page.locator(".network-device.is-asking .ask-badge text")).toHaveText("?");
  // Each lettered device is the choice with that letter in the question.
  const options = await question(page).locator(".predict-option").evaluateAll((els) => els.map((e) => [e.querySelector(".predict-letter")!.textContent, e.querySelector("span")!.textContent]));
  await expect(answers(page)).toHaveCount(2);
  for (const a of await answers(page).all()) {
    const label = (await a.getAttribute("aria-label"))!;
    const [, letter, text] = label.match(/^Answer ([A-Z]): (.*)$/)!;
    expect(options).toContainEqual([letter, text]);
    await expect(a.locator(".answer-badge text")).toHaveText(letter);
    await expect(a).toHaveAttribute("aria-pressed", "false");
  }
  // Tapping a device chooses its answer, nothing more: the question stays, nothing later is shown.
  const max = await page.getByLabel("Journey timeline").getAttribute("max");
  const router = page.getByRole("button", { name: /^Answer [A-Z]: 192\.168\.1\.1 \(Home router\)$/ });
  // Centred, clear of the sticky site header.
  await router.evaluate((e) => e.scrollIntoView({ block: "center" }));
  const box = (await router.locator(".device-tile").boundingBox())!;
  if (info.project.use.hasTouch) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(question(page).getByRole("radio", { name: "192.168.1.1 (Home router)" })).toBeChecked();
  await expect(router).toHaveAttribute("aria-pressed", "true");
  await expect(question(page)).toBeVisible();
  await expect(page.getByLabel("Journey timeline")).toHaveAttribute("max", max!);
  // The tap did not select the device for the Device tab.
  await expect(page.locator(".inspector-tabs").getByRole("button", { name: "Device", exact: true })).toHaveAttribute("aria-pressed", "false");
  // Choosing in the list moves the mark on the diagram too.
  await question(page).getByRole("radio", { name: "198.51.100.53 (DNS server)" }).check();
  await expect(router).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: /^Answer [A-Z]: 198\.51\.100\.53 \(DNS server\)$/ })).toHaveAttribute("aria-pressed", "true");
  // Submitting is still the learner's own step.
  await question(page).getByRole("button", { name: "Check my prediction" }).click();
  await expect(page.getByRole("region", { name: "Prediction result" })).toBeVisible();
  // Once answered, the marks go and devices select as usual.
  await expect(answers(page)).toHaveCount(0);
  await expect(page.locator(".network-device.is-asking")).toHaveCount(0);
});

test("a lettered device is chosen with the keyboard too", async ({ page }) => {
  await start(page);
  const router = page.getByRole("button", { name: /^Answer [A-Z]: 192\.168\.1\.1 \(Home router\)$/ });
  await router.focus();
  await page.keyboard.press("Enter");
  await expect(question(page).getByRole("radio", { name: "192.168.1.1 (Home router)" })).toBeChecked();
  await expect(router).toHaveAttribute("aria-pressed", "true");
});

test("the second question letters the devices that heard the broadcast", async ({ page }) => {
  await start(page);
  await question(page).getByRole("button", { name: "Show me" }).click();
  await page.getByRole("region", { name: "Prediction result" }).getByRole("button", { name: "Continue" }).click();
  await expect(question(page).getByRole("heading")).toContainText("Which device answers?");
  // Every choice that names a device is on the diagram; "No device" is only in the list.
  const named = await question(page).locator(".predict-option span").allTextContents();
  await expect(answers(page)).toHaveCount(named.filter((t) => !t.startsWith("No device")).length);
  await expect(page.locator(".track-gate")).toHaveAttribute("width", "40");
});

test("experiments and missions are unchanged: no lettered devices outside a question", async ({ page }) => {
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(answers(page)).toHaveCount(0);
  await page.goto("/practice/missions/no-connection");
  await expect(page.getByLabel("Predict as you go")).toHaveCount(0);
});

test("answers inside a collapsed Internet are shown by their letters on it, without saying which is right", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "The Internet collapses in the learner's own layout, on wide screens");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice/network");
  await page.getByRole("button", { name: "Collapse Internet" }).click();
  await page.locator(".canvas-bar").getByLabel("Predict as you go").check();
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await expect(question(page)).toBeVisible();
  // The DNS server is a choice and is inside the Internet: its letter is on the cloud; the home router's is on it.
  const dns = (await question(page).locator(".predict-option", { hasText: "DNS server" }).locator(".predict-letter").textContent())!;
  await expect(page.getByRole("button", { name: `Expand simulated Internet, which holds answer ${dns}` })).toBeVisible();
  await expect(answers(page)).toHaveCount(1);
  // Every choice is still in the list, and nothing expanded by itself.
  await expect(question(page).getByRole("radio")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Expand Internet" })).toBeVisible();
});
