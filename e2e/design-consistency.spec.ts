import { expect, test } from "@playwright/test";

// Every major route: one type family for headings, the shared surface tokens, and no sideways scrolling, down to
// the narrowest phone.
const routes = [
  "/",
  "/learn",
  "/learn/data-structures",
  "/learn/system-design",
  "/learn/system-design/design-projects",
  "/learn/ipv4-subnets",
  "/practice",
  "/practice/missions/neighbours",
  "/missions/ds-lab",
  "/practice/connections",
  "/practice/subnets",
  "/playground",
  "/practice/network",
  "/practice/structures",
  "/practice/structures?structure=recursion",
  "/practice/architecture",
  "/practice/architecture/labs",
  "/concepts/recursion",
  "/lab",
  "/lab/structures/arrays",
  "/lab/networking/http-inspector",
];

for (const width of [1440, 320]) {
  for (const route of routes) {
    test(`${route} uses the shared heading type and fits ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const display = await page.locator("#main h1").evaluate((h) => getComputedStyle(h).fontFamily);
      await page.goto(route);
      const h1 = page.locator("#main h1").first();
      await expect(h1).toBeVisible();
      expect(await h1.evaluate((h) => getComputedStyle(h).fontFamily)).toBe(display);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${route} scrolls sideways at ${width}px`).toBeLessThanOrEqual(0);
    });
  }
}

test("the connection explorer is drawn with the shared tokens, not its own palette", async ({ page }) => {
  await page.goto("/practice/connections");
  await expect(page.locator(".access-options button").first()).toBeVisible();
  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const css = (selector: string, prop: string) => getComputedStyle(document.querySelector(selector)!).getPropertyValue(prop);
    const probe = document.createElement("i");
    document.body.append(probe);
    const resolve = (token: string) => { probe.style.color = `var(${token})`; return getComputedStyle(probe).color; };
    return {
      page: css(".access-page", "color"),
      ink: resolve("--ink"),
      option: css(".access-options button", "background-color"),
      surface: resolve("--surface"),
      pressed: css('.access-options button[aria-pressed="true"]', "background-color"),
      soft: resolve("--primary-soft"),
      serif: [...document.querySelectorAll("#main *")].some((el) => /georgia|serif$/i.test(getComputedStyle(el).fontFamily.trim()) && !/sans-serif/i.test(getComputedStyle(el).fontFamily)),
      root: root.getPropertyValue("--primary").trim(),
    };
  });
  expect(tokens.page).toBe(tokens.ink);
  expect(tokens.option).toBe(tokens.surface);
  expect(tokens.pressed).toBe(tokens.soft);
  expect(tokens.serif).toBe(false);
});
