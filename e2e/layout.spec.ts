import { expect, test } from "@playwright/test";

const pages = ["/", "/missions/tcp-lost-segment", "/missions/ds-lab", "/missions/graph-bfs-reach", "/missions/recursion-depth", "/concepts/message-queues"];

for (const path of pages) {
  test(`no horizontal overflow and usable targets: ${path}`, async ({ page }, info) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "horizontal overflow (px)").toBeLessThanOrEqual(0);
    // Interactive controls should be comfortably sized (≥ 44 px), excluding inline text links.
    const small = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button, select, [role=tab], input:not([type=radio]):not([type=hidden])")]
        .filter((el) => el.offsetParent !== null && !el.classList.contains("text-button") && !el.closest(".facts, .rating"))
        .map((el) => ({ el: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30), h: el.getBoundingClientRect().height }))
        .filter((item) => item.h < 43.5),
    );
    expect(small).toEqual([]);
    await page.screenshot({ path: `test-results/screens/${info.project.name}${path.replace(/\//g, "_") || "_home"}.png`, fullPage: true });
  });
}

test("200% text size keeps the mission readable without horizontal scrolling", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440" && info.project.name !== "phone-390");
  await page.goto("/missions/tcp-lost-segment");
  await page.addStyleTag({ content: "html { font-size: 200% !important; } body { font-size: 2rem !important; }" });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByRole("button", { name: "Test prediction" })).toBeVisible();
  await page.screenshot({ path: `test-results/screens/${info.project.name}_text-200.png`, fullPage: true });
});

test("reduced motion: no FLIP animations run, stepping still works", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/missions/tcp-lost-segment");
  await page.locator("label.choice").first().click();
  await page.getByRole("button", { name: "Test prediction" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  // Script-driven (FLIP) animations only; CSS ones are collapsed to ~0ms by the reduced-motion rule.
  const running = await page.evaluate(() => document.getAnimations().filter((animation) => !(animation instanceof CSSAnimation) && !(animation instanceof CSSTransition)).length);
  expect(running).toBe(0);
  await expect(page.locator(".scene-step")).toHaveText(/Step 3 of/);
});

test("motion: packets glide between locations with FLIP when motion is allowed", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440");
  await page.goto("/missions/tcp-lab");
  await page.getByRole("button", { name: "Just watch (no credit)" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Next step" }).click(); // SYN appears
  await page.getByRole("button", { name: "Next step" }).click(); // SYN moves down a layer
  const moving = await page.evaluate(() => document.querySelector("[data-flip='packet-syn']")?.getAnimations().length ?? 0);
  expect(moving).toBeGreaterThan(0);
});
