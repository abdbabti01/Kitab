import { expect, test, type Locator, type Page } from "@playwright/test";

// Explore subnets (/practice/subnets): every value from the shared IPv4 helper, nothing stored.
const open = (page: Page, query = "") => page.goto(`/practice/subnets${query}`);
const facts = (page: Page) => page.locator(".subnet-facts");
const choice = (page: Page, label: string) => page.locator(".subnet-choices button", { has: page.locator("code", { hasText: new RegExp(`^${label.replace(/\./g, "\\.")}$`) }) });
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
// Touch projects tap, the others click: both must work.
async function press(target: Locator) {
  const touch = await target.page().evaluate(() => matchMedia("(pointer: coarse)").matches || "ontouchstart" in window);
  if (touch) await target.tap();
  else await target.click();
}

test("Practice lists the explorer, and a direct link opens it with that example", async ({ page }) => {
  await page.goto("/#missions");
  await press(page.getByRole("link", { name: /Explore subnets/ }));
  await expect(page).toHaveURL(/\/practice\/subnets$/);
  await expect(page.getByRole("heading", { name: "Explore subnets", level: 1 })).toBeVisible();
  await expect(page.locator(".site-header nav a", { hasText: "Practice" })).toHaveAttribute("aria-current", "true");
  await expect(page).toHaveTitle("Explore subnets · Kitab");

  await page.goto("/practice/missions");
  await page.getByRole("link", { name: /Explore subnets/ }).click();
  await expect(page).toHaveURL(/\/practice\/subnets$/);

  await open(page, "?ip=10.20.30.77&prefix=28&to=10.20.30.90");
  await expect(page.getByLabel("IPv4 address")).toHaveValue("10.20.30.77");
  await expect(page.getByLabel("Subnet mask")).toHaveValue("255.255.255.240");
  await expect(page.getByLabel("Destination address")).toHaveValue("10.20.30.90");
  // A malformed link falls back to the default example instead of failing.
  await open(page, "?ip=01.2.3.4&prefix=99");
  await expect(page.getByLabel("IPv4 address")).toHaveValue("192.168.1.10");
  await expect(page.locator(".subnet-prefix output")).toHaveText("/24");
  expect(await fits(page)).toBe(true);
});

test("prediction comes first: a wrong answer gets its own feedback, a retry can succeed, and the facts follow", async ({ page }) => {
  await open(page, "?ip=10.20.30.77&prefix=28");
  await expect(page.locator(".subnet-prompt")).toHaveText("What is the network address of 10.20.30.77/28?");
  await expect(facts(page)).toHaveCount(0);

  await press(choice(page, "10.20.30.0"));
  const feedback = page.locator("#subnet-feedback");
  await expect(feedback).toContainText("Not quite. That cuts the address at a whole octet, as /24 would. With /28 the boundary is 4 bits into octet 4.");
  await expect(facts(page)).toHaveCount(0);
  await expect(choice(page, "10.20.30.0")).toBeDisabled();
  await press(choice(page, "10.20.30.79"));
  await expect(feedback).toContainText("That is the broadcast address");
  await press(choice(page, "10.20.30.64"));
  await expect(feedback).toContainText("Right. Clearing the 4 host bits of 10.20.30.77 gives 10.20.30.64, the first address of its 16-address block 10.20.30.64/28.");
  await expect(facts(page)).toContainText("Network address10.20.30.64");
  await expect(facts(page)).toContainText("Broadcast address10.20.30.79");
  await expect(facts(page)).toContainText("Usable host range10.20.30.65 – 10.20.30.78");
  await expect(facts(page)).toContainText("Usable hosts14");
  // Answered choices stay readable rather than fading like ordinary disabled buttons.
  expect(await choice(page, "10.20.30.0").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

  // A new generated question starts fresh; showing the answer reveals it without a "Right".
  await press(page.getByRole("button", { name: "New question" }));
  await expect(page.locator(".subnet-prompt")).not.toHaveText("What is the network address of 10.20.30.77/28?");
  await expect(facts(page)).toHaveCount(0);
  await press(page.getByRole("button", { name: "Show the answer" }));
  await expect(feedback).toContainText("Answer shown.");
  await expect(facts(page)).toBeVisible();
  await expect(page.locator(".subnet-choices .is-right")).toHaveCount(1);

  // Prediction can be turned off to explore freely.
  await press(page.getByRole("button", { name: "Next block ›" }));
  await expect(facts(page)).toHaveCount(0);
  await page.getByLabel("Predict before you see the answer").uncheck();
  await expect(facts(page)).toBeVisible();
  await expect(page.locator(".subnet-question")).toHaveCount(0);
  expect(await fits(page)).toBe(true);
});

test("a mask sets the prefix, and presets, the slider and the mask stay in step", async ({ page }) => {
  await open(page, "?ip=172.20.200.9");
  await page.getByLabel("Predict before you see the answer").uncheck();
  await page.getByLabel("Subnet mask").fill("255.255.240.0");
  await expect(page.locator(".subnet-prefix output")).toHaveText("/20");
  await expect(facts(page)).toContainText("Network address172.20.192.0");
  await expect(facts(page)).toContainText("Usable hosts4,094");
  await expect(page.locator(".subnet-note")).toHaveText("The boundary is inside octet 3: 200 = 128 + 64 + 8 = 11001000 in binary. Its first 4 bits belong to the network.");
  await press(page.getByRole("button", { name: "/26", exact: true }));
  await expect(page.getByLabel("Subnet mask")).toHaveValue("255.255.255.192");
  await expect(page.getByRole("button", { name: "/26", exact: true })).toHaveAttribute("aria-pressed", "true");
  const slider = page.getByLabel("Prefix length");
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".subnet-prefix output")).toHaveText("/25");
  await expect(page.getByLabel("Subnet mask")).toHaveValue("255.255.255.128");
});

test("/31, /32 and /0 are explained by what they are, never with a network or broadcast address", async ({ page }) => {
  await open(page, "?ip=203.0.113.7&prefix=31");
  await expect(page.locator(".subnet-prompt")).toHaveText("How many addresses in 203.0.113.6/31 can an interface use?");
  await press(choice(page, "0"));
  await expect(page.locator("#subnet-feedback")).toContainText("On a /31 point-to-point link both addresses are usable (RFC 3021).");
  await press(choice(page, "2"));
  await expect(facts(page)).toContainText("Usable addresses203.0.113.6 and 203.0.113.7");
  await expect(page.locator(".subnet-kind")).toContainText("point-to-point link (RFC 3021)");
  await expect(page.locator(".subnet-type")).toContainText("Documentation (RFC 5737)");
  await expect(page.locator(".subnet-page")).not.toContainText(/Network address|Broadcast address/);

  await page.getByLabel("Predict before you see the answer").uncheck();
  await press(page.getByRole("button", { name: "/32", exact: true }));
  await expect(facts(page)).toContainText("Usable address203.0.113.7");
  await expect(facts(page)).toContainText("Usable count1");
  await expect(page.locator(".subnet-page")).not.toContainText(/Network address|Broadcast address/);

  await press(page.getByRole("button", { name: "/0", exact: true }));
  await expect(facts(page)).toContainText("Used asThe default route");
  await expect(facts(page)).toContainText("Usable hostsNot a host setting");
  await expect(page.locator(".subnet-kind")).toContainText("routing tables use 0.0.0.0/0 as the default route");
  await expect(page.locator(".subnet-verdict")).toContainText("Real hosts are never configured with /0");
  expect(await fits(page)).toBe(true);
});

test("invalid input keeps the learner's text, explains it and never leaves stale results", async ({ page }) => {
  await open(page);
  const address = page.getByLabel("IPv4 address"),
    mask = page.getByLabel("Subnet mask"),
    destination = page.getByLabel("Destination address");
  await address.fill("192.168.01.5");
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#subnet-address-error")).toHaveText("“192.168.01.5” is not an IPv4 address: “01” must be a whole number from 0 to 255 with no leading zeros, signs or spaces.");
  await expect(address).toHaveAttribute("aria-describedby", "subnet-address-error");
  await expect(page.locator(".subnet-bits")).toHaveCount(0);
  await expect(page.locator(".subnet-question, .subnet-facts, .subnet-verdict, .subnet-why")).toHaveCount(0);
  await expect(page.locator(".subnet-compare")).toContainText("Correct the address and mask above to compare.");

  await mask.fill("255.0.255.0");
  await expect(page.locator("#subnet-mask-error")).toHaveText("255.0.255.0 is not a valid subnet mask: its 1 bits must be contiguous from the left, followed only by 0 bits.");
  await address.fill("10.1.2.3");
  // The address is valid now, but the mask isn't: still no results, and the invalid mask text is kept.
  await expect(mask).toHaveValue("255.0.255.0");
  await expect(page.locator(".subnet-bits")).toHaveCount(0);
  // Choosing a preset replaces the invalid mask.
  await press(page.getByRole("button", { name: "/16", exact: true }));
  await expect(mask).toHaveValue("255.255.0.0");
  await expect(mask).not.toHaveAttribute("aria-invalid");
  await expect(page.locator(".subnet-bits").first()).toBeVisible();

  await destination.fill("256.1.1.1");
  await expect(page.locator("#subnet-destination-error")).toHaveText("“256.1.1.1” is not an IPv4 address: 256 is larger than 255.");
  await expect(page.locator(".subnet-verdict, .subnet-and")).toHaveCount(0);
  await destination.fill("10.1.200.1");
  await expect(page.locator(".subnet-verdict")).toContainText("Same subnet.");
  await destination.fill("10.2.0.1");
  await expect(page.locator(".subnet-verdict")).toContainText("Different subnet.");
  await expect(page.locator(".subnet-caveat")).toContainText("It does not prove the packet arrives");
  expect(await fits(page)).toBe(true);
});

test("address bits flip by pointer, touch and keyboard, change only the address, and are labelled", async ({ page }) => {
  await open(page, "?ip=192.168.1.10&prefix=24");
  const bits = page.getByRole("group", { name: /Address bits of/ }).getByRole("button");
  await expect(bits).toHaveCount(32);
  const last = page.getByRole("button", { name: "Bit 32 of 32, host bit, place value 1 in octet 4" });
  await expect(last).toHaveAttribute("aria-pressed", "false");
  await press(last);
  await expect(page.getByLabel("IPv4 address")).toHaveValue("192.168.1.11");
  await expect(page.locator(".subnet-page [role=status][aria-live]")).toHaveText("Bit 32 is now 1. The address is 192.168.1.11; the prefix is still /24.");
  await expect(page.locator(".subnet-prefix output")).toHaveText("/24");
  await expect(last).toBeFocused();
  // One tab stop for the strip; arrows move between bits, Space flips the focused one.
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Bit 31 of 32, host bit, place value 2 in octet 4" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByLabel("IPv4 address")).toHaveValue("192.168.1.9");
  await page.keyboard.press("Home");
  await expect(page.getByRole("button", { name: "Bit 1 of 32, network bit, place value 128 in octet 1" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("IPv4 address")).toHaveValue("64.168.1.9");
  await expect(bits.and(page.locator("[tabindex='0']"))).toHaveCount(1);
  // Flipping a network bit moves to another block; the prefix and mask don't change.
  await expect(page.getByLabel("Subnet mask")).toHaveValue("255.255.255.0");

  // Two octets per row at every width, every bit at least 44px tall, and nothing overflows.
  const boxes = await bits.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), h: r.height })));
  expect(new Set(boxes.map((b) => b.top)).size).toBe(2);
  expect(Math.min(...boxes.map((b) => b.h))).toBeGreaterThanOrEqual(44);
  expect(await fits(page)).toBe(true);
});

test("the explorer writes nothing to storage, runs no animations with reduced motion, and leaves no dangling references", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("kitab.learning.v1", JSON.stringify({ version: 1, lessons: { "ip-addressing": { completedAt: "2026-11-01T10:00:00.000Z" } } }));
  });
  const before = await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));
  await open(page, "?ip=10.20.30.77&prefix=28");
  await press(choice(page, "10.20.30.64"));
  await press(page.getByRole("button", { name: "New question" }));
  await press(page.getByRole("button", { name: "/31", exact: true }));
  await page.getByLabel("IPv4 address").fill("1.2.3.4");
  await press(page.getByRole("button", { name: /^Bit 8 of 32/ }));
  expect(await page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()))).toBe(before);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const dangling = await page.evaluate(() =>
    [...document.querySelectorAll("[aria-controls], [aria-describedby], [aria-labelledby]")].flatMap((el) =>
      ["aria-controls", "aria-describedby", "aria-labelledby"].flatMap((a) => (el.getAttribute(a) ?? "").split(/\s+/).filter((id) => id && !document.getElementById(id))),
    ),
  );
  expect(dangling).toEqual([]);
});
