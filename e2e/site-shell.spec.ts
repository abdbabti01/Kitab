import { expect, test } from "@playwright/test";

test("every page shares one navigation, marks its section by its role in the course, and shares surface tokens", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Learn" })).toBeVisible({ timeout: 3000 });
  await expect(nav.getByRole("link")).toHaveText(["Learn", "Practice", "Playground", "Lab"]);
  await expect(nav.locator("[aria-current]")).toHaveCount(0);
  // The Playground entry always opens the choice of the three Playgrounds.
  await expect(nav.getByRole("link", { name: "Playground" })).toHaveAttribute("href", "/playground");
  const palette = () => page.evaluate(() => {
    const content = document.querySelector("#main")!;
    const style = getComputedStyle(content);
    return ["--bg", "--surface", "--primary", "--font"].map((token) => style.getPropertyValue(token).trim());
  });
  const homePalette = await palette();
  // The Playground is drawn on the shared night palette: the same tokens, as they read on navy.
  const nightPalette = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return [...["--night-bg", "--night-surface", "--night-primary"].map((token) => root.getPropertyValue(token).trim()), root.getPropertyValue("--font").trim()];
  });
  for (const [path, label] of [
    ["/learn/ip-addressing", "Learn"],
    ["/learn/ipv4-subnets", "Learn"],
    ["/practice/connections", "Learn"],
    ["/missions/tcp-lost-segment", "Practice"],
    ["/practice/missions", "Practice"],
    ["/practice/missions/neighbours", "Practice"],
    ["/practice/network", "Playground"],
    ["/practice/network?starter=lan", "Playground"],
    ["/playground", "Playground"],
    ["/practice/structures", "Playground"],
    ["/practice/structures?structure=recursion", "Playground"],
    ["/practice/architecture", "Playground"],
    ["/concepts/message-queues", "Learn"],
    ["/lab", "Lab"],
    ["/lab/structures/arrays", "Lab"],
  ]) {
    await page.goto(path);
    await expect(page.locator("#main h1")).toBeVisible();
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator("[aria-current]")).toHaveCount(1);
    // The Playgrounds and the Engineering Lab share the lab shell on the night palette.
    expect(await palette()).toEqual(label === "Playground" || label === "Lab" ? nightPalette : homePalette);
  }
  await nav.getByRole("link", { name: "Learn" }).click();
  await expect(page).toHaveURL(/\/learn$/);
  await expect(page.getByRole("heading", { name: "The roadmap" })).toBeVisible();
  // Home's old anchors open their pages.
  await page.goto("/#concepts");
  await expect(page).toHaveURL(/\/learn\/library$/);
  await page.getByRole("link", { name: "Kitab", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  // Home is the same for a returning learner: the subjects first.
  await expect(page.locator(".home-hero h1")).toBeInViewport();
  await expect(page.locator(".subject-card")).toHaveCount(3);
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
