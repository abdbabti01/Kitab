import { expect, test, type Page } from "@playwright/test";

// Learn → Playground → Practice → Lab: each mode does its own job, and the hand-offs open the intended place and lead
// back. Learn explains with one small demonstration; the Playground keeps every control; nothing is recorded by reading.

const fresh = async (page: Page, path: string) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto(path);
};
/** Every stored record except the visit log, which opening any page updates as before. */
const records = (page: Page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage).filter(([k]) => k !== "kitab.visits.v1").sort()));
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("Recursion: understand the base case, follow factorial(3), explore the full timeline in the Playground, return and check", async ({ page }) => {
  await fresh(page, "/concepts/recursion");
  const before = await records(page);
  await expect(page.getByRole("heading", { name: "The base case stops it" })).toBeVisible();
  await expect(page.locator(".concept-code")).toContainText("if n <= 1:");
  // A compact demonstration: no scrubber, playback or execution console on the lesson.
  const main = page.locator("main");
  await expect(main.getByRole("slider")).toHaveCount(0);
  await expect(main.getByText("Execution trace")).toHaveCount(0);
  await expect(main.getByText("STATE AFTER EVENT")).toHaveCount(0);
  const demo = page.locator(".recursion-demo");
  await expect(demo.locator(".call-sequence li")).toHaveCount(7);
  await expect(demo.locator(".demo-count")).toHaveText("Step 1 of 7");
  for (let i = 0; i < 3; i++) await demo.getByRole("button", { name: "Next" }).click();
  await expect(demo.locator(".call-sequence li[aria-current=step]")).toHaveText("factorial(1) returns 1 (base case)");
  await expect(demo.locator(".call-frames li")).toHaveCount(4);
  await expect(demo.locator(".call-frames li").first()).toContainText("result 1");
  await demo.getByRole("button", { name: "Previous" }).click();
  await expect(demo.locator(".call-frames li").first()).toContainText("n = 1 · running");
  for (let i = 0; i < 4; i++) await demo.getByRole("button", { name: "Next" }).click();
  await expect(demo.locator(".demo-step")).toContainText("main() receives 6");
  await expect(demo.getByRole("button", { name: "Watch again" })).toBeVisible();
  await expect(demo).toContainText("teaching model");

  // The Playground opens on factorial(3), with every control and the full stack timeline.
  await demo.getByRole("link", { name: "Explore recursion in the Playground" }).click();
  await expect(page).toHaveURL(/\/practice\/structures\?structure=recursion&fn=factorial&n=3&base=1&limit=8&from=%2Fconcepts%2Frecursion$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Data Structures & Recursion Playground");
  const slider = page.getByRole("slider", { name: "Step" });
  await slider.fill((await slider.getAttribute("max"))!);
  await expect(page.locator(".sp-result")).toContainText("6");
  // And from there, a mission tests the understanding.
  await expect(page.locator(".sp-practise").getByRole("link", { name: "How deep does the stack go?" })).toHaveAttribute("href", "/missions/recursion-depth");
  await page.getByRole("link", { name: "Back to your lesson" }).click();
  await expect(page).toHaveURL(/\/concepts\/recursion$/);

  // The understanding check gives feedback for the answer chosen, and records nothing.
  const check = page.locator(".understanding-check");
  await expect(check.getByRole("button", { name: "Check my answer" })).toBeDisabled();
  await check.getByText("It still returns 6, only more slowly").click();
  await check.getByRole("button", { name: "Check my answer" }).click();
  await expect(check.getByRole("status")).toContainText("Not quite.");
  await check.getByText(/The calls never stop/).click();
  await check.getByRole("button", { name: "Check my answer" }).click();
  await expect(check.getByRole("status")).toContainText("Correct.");
  expect(await records(page)).toBe(before);
  // The end of the page doesn't repeat the Playground link; practice and the guided experiment remain.
  const end = page.getByRole("navigation", { name: "Next step" });
  await expect(end.locator(".path-playground")).toHaveCount(0);
  await expect(end.locator(".path-predict")).toContainText("Which call returns first?");
});

test("Arrays: learn insertion, step the engine's demonstration, then change the capacity in the Playground and watch it grow", async ({ page }) => {
  await fresh(page, "/concepts/arrays");
  await expect(page.locator(".key-steps li")).toHaveCount(4);
  const demo = page.locator(".lesson-demo");
  await expect(demo).toContainText("Deterministic simulation");
  await expect(demo.locator(".ds-array > li")).toHaveCount(5);
  const count = await demo.locator(".demo-count").textContent();
  const total = Number(/of (\d+)/.exec(count!)![1]);
  for (let i = 1; i < total; i++) await demo.getByRole("button", { name: "Next" }).click();
  await expect(demo.locator(".ds-array > li")).toHaveCount(6);
  await demo.getByRole("link", { name: "Explore this in the Playground" }).click();
  await expect(page).toHaveURL(/structure=array&op=insert&value=7&index=2&from=%2Fconcepts%2Farrays$/);
  // Full the block: capacity equal to the length forces a reallocation.
  await page.getByLabel("Capacity (slots)").fill("5");
  await expect(page).toHaveURL(/capacity=5/);
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.locator("#step-title")).toHaveText("The block is full");
  const slider = page.getByRole("slider", { name: "Step" });
  await slider.fill((await slider.getAttribute("max"))!);
  await expect(page.locator(".sp-result")).toContainText("after growing the capacity to 10");
  await page.getByRole("link", { name: "Back to your lesson" }).click();
  await expect(page).toHaveURL(/\/concepts\/arrays$/);
  await expect(page.getByRole("heading", { name: "See it happen" })).toBeVisible();
});

test("Networking: DNS is explained inline with a labelled conceptual illustration, then explored in the Network Playground", async ({ page }) => {
  await fresh(page, "/concepts/dns");
  await expect(page.locator(".engine-canvas-head")).toContainText("CONCEPTUAL ILLUSTRATION");
  await expect(page.getByRole("heading", { name: "A common misconception" })).toBeVisible();
  // The illustration's six servers keep whole words at every width.
  const narrowest = await page.locator(".request-hop-wrap article").evaluateAll((cards) => Math.min(...cards.map((c) => c.getBoundingClientRect().width)));
  expect(narrowest).toBeGreaterThan(140);
  await page.locator(".understanding-check").getByText("No one: it answers from its cache").click();
  await page.locator(".understanding-check").getByRole("button", { name: "Check my answer" }).click();
  await expect(page.locator(".understanding-check").getByRole("status")).toContainText("Correct.");
  const explore = page.locator(".demo-explore").getByRole("link", { name: /Network Playground/ });
  await expect(explore).toHaveAttribute("href", "/practice/network?starter=internet");
  // One way into the Playground, not two.
  await expect(page.getByRole("navigation", { name: "Next step" }).locator(".path-playground")).toHaveCount(0);
  await explore.click();
  await expect(page.getByRole("heading", { level: 1, name: /Playground/ })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/concepts\/dns$/);
  await expect(page.getByRole("heading", { name: "DNS resolution", level: 1 })).toBeVisible();
});

test("System Design: learn load balancing, open the lesson's design in the Architecture Playground, change the rate, run and read the results", async ({ page }) => {
  await fresh(page, "/learn/system-design/scalability");
  await expect(page.getByRole("heading", { name: "Load balancing" })).toBeVisible();
  // The guided experiment stays in the lesson; free runs live in the Playground.
  await expect(page.locator(".cycle")).toBeVisible();
  await page.locator(".explore-designs").getByRole("link", { name: /2 API servers behind a load balancer/ }).click();
  await expect(page.getByRole("heading", { name: "Architecture Playground" })).toBeVisible();
  await page.locator("[data-node=client-1]").click();
  await page.getByLabel("Requests per second").fill("700");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.locator(".finding").first()).toBeVisible();
  await expect(page.getByText("This view hit an error")).toHaveCount(0);
});

test("Practice leads to a real implementation only where a lab exists; Labs keep their real-execution labels", async ({ page }) => {
  await fresh(page, "/missions/recursion-depth");
  const end = page.getByRole("navigation", { name: "Next step" });
  await expect(end.locator(".path-lab").getByRole("link", { name: "Recursion and a real stack overflow" })).toHaveAttribute("href", "/lab/structures/recursion");
  // A unit without a lab offers none.
  await page.goto("/missions/ds-linked-list-delete");
  await expect(page.getByRole("navigation", { name: "Next step" }).locator(".path-lab")).toHaveCount(0);
  // Learn steps don't jump ahead to the Lab.
  await page.goto("/concepts/recursion");
  await expect(page.locator(".path-lab")).toHaveCount(0);
  await page.goto("/lab/structures/recursion");
  await expect(page.locator("main")).toContainText(/JavaScript/);
});

test("Learn pages fit every width and never scroll sideways", async ({ page }) => {
  for (const width of [1440, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/concepts/recursion", "/concepts/arrays", "/concepts/hash-tables", "/concepts/dns", "/learn/system-design/scalability"]) {
      await page.goto(path);
      await expect(page.locator("#main h1")).toBeVisible();
      expect(await noSideScroll(page), `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
});
