import { expect, test } from "@playwright/test";

test("every page shares one navigation, marks its section by its role in the course, and shares surface tokens", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Learn" })).toBeVisible({ timeout: 3000 });
  await expect(nav.getByRole("link")).toHaveText(["Learn", "Practice", "Playground"]);
  await expect(nav.locator("[aria-current]")).toHaveCount(0);
  const palette = () => page.evaluate(() => {
    const content = document.querySelector("#main")!;
    const style = getComputedStyle(content);
    return ["--bg", "--surface", "--primary", "--font"].map((token) => style.getPropertyValue(token).trim());
  });
  const homePalette = await palette();
  for (const [path, label] of [
    ["/learn/ip-addressing", "Learn"],
    ["/learn/ipv4-subnets", "Learn"],
    ["/practice/connections", "Learn"],
    ["/missions/tcp-lost-segment", "Practice"],
    ["/practice/missions", "Practice"],
    ["/practice/missions/neighbours", "Practice"],
    ["/practice/network", "Playground"],
    ["/practice/network?starter=lan", "Playground"],
    ["/concepts/message-queues", "Learn"],
  ]) {
    await page.goto(path);
    await expect(page.locator("#main h1")).toBeVisible();
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current]")).toHaveCount(1);
    expect(await palette()).toEqual(homePalette);
  }
  await nav.getByRole("link", { name: "Learn" }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole("heading", { name: "The roadmap" })).toBeVisible();
  // Home's old anchors open their pages.
  await page.goto("/#concepts");
  await expect(page).toHaveURL(/\/learn\/library$/);
  await page.getByRole("link", { name: "Kitab", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".journey-hero h1")).toBeInViewport();
});

test("reading playback keeps the same layout after a mission", async ({ page }) => {
  await page.goto("/concepts/message-queues");
  const controls = page.locator(".walkthrough .playback-row");
  await expect(controls).toBeVisible();
  const wrap = await controls.evaluate((element) => getComputedStyle(element).flexWrap);

  await page.goto("/missions/tcp-lost-segment");
  await expect(page.locator(".scene .playback")).toBeVisible();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Learn" }).click();
  await page.getByRole("link", { name: "Library" }).click();
  await page.locator('.concept-list a[href="/concepts/message-queues"]').click();
  await expect(controls).toHaveCSS("flex-wrap", wrap);
});
