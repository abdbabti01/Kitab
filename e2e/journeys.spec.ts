import { expect, test, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error.message));
  page.on("console", (message) => {
    // The dev server has no Worker, so /api calls fail by design; everything else must be clean.
    if (message.type() === "error" && !/Failed to load resource|\/api\//.test(message.text())) list.push(message.text());
  });
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page), "console/page errors").toEqual([]);
});

async function choose(page: Page, text: string | RegExp) {
  await page.locator("label.choice", { hasText: text }).click();
}

async function runToEnd(page: Page) {
  const slider = page.getByRole("slider", { name: "Step" });
  await expect(slider).toBeEnabled();
  await slider.focus();
  await page.keyboard.press("End");
}

test("wrong prediction → run → evidence → explanation → retry on a new scenario → mastery", async ({ page }) => {
  await page.goto("/missions/tcp-lost-segment");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The ACK that wouldn't move");
  // Before predicting, the run is locked and only the starting state shows.
  await expect(page.getByRole("button", { name: "Play" })).toBeDisabled();
  await expect(page.getByText("Starting state", { exact: true })).toBeVisible();

  await choose(page, "ACK 4501");
  await page.getByLabel(/Why\?/).fill("The receiver has the newest bytes.");
  await page.getByRole("button", { name: "Test prediction" }).click();
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeVisible();
  await expect(page.getByText("The receiver has the newest bytes.")).toBeVisible();
  await runToEnd(page);

  await expect(page.getByRole("heading", { name: "Explain what happened" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "The engine computed" })).toContainText("ACK 2461");
  await page.getByRole("button", { name: "Show me the evidence" }).click();
  await expect(page.locator(".scene-title")).toHaveText("The receiver repeats ACK 2461");
  await expect(page.locator(".guide-message")).toContainText("can't skip the gap");
  await expect(page.locator('[data-entity="segment-2"]')).toHaveClass(/is-attention/);

  await choose(page, /stays at 2461/);
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("heading", { name: "Not mastered yet" })).toBeVisible();

  await page.getByRole("button", { name: "Retry with a new scenario" }).click();
  await expect(page.getByText(/MSS of 1200 B/)).toBeVisible();
  await choose(page, "ACK 2201");
  await page.getByRole("button", { name: "Test prediction" }).click();
  await runToEnd(page);
  await choose(page, /stays at 2201/);
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("heading", { name: "Mission mastered" })).toBeVisible();
  await expect(page.locator(".kitab-avatar.mood-celebrating").first()).toBeVisible();

  await page.goto("/");
  await expect(page.locator(".mission-card", { hasText: "The ACK that wouldn't move" }).locator(".status-chip")).toHaveText("Mastered");
});

test("blank answers and watch-only runs never grant mastery", async ({ page }) => {
  await page.goto("/missions/array-insert-shift");
  await page.getByRole("button", { name: "Test prediction" }).click();
  await expect(page.getByRole("alert")).toHaveText("Choose an answer first.");
  await page.getByRole("button", { name: "Just watch (no credit)" }).click();
  await runToEnd(page);
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("alert")).toHaveText("Choose the evidence first.");
  await choose(page, /Slots are contiguous/);
  await page.getByRole("button", { name: "Check explanation" }).click();
  await expect(page.getByRole("heading", { name: "Not mastered yet" })).toBeVisible();
  await expect(page.getByText("No prediction (watched only)")).toBeVisible();
});

test("progress and reasoning survive a refresh; back and forward keep routes", async ({ page }) => {
  await page.goto("/");
  await page.locator(".mission-card", { hasText: "How deep does the stack go?" }).click();
  await expect(page).toHaveURL(/\/missions\/recursion-depth$/);
  await choose(page, "4 frames");
  await page.getByLabel(/Why\?/).fill("One frame per call");
  await page.getByRole("button", { name: "Test prediction" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeVisible();
  await expect(page.getByText("You predicted 4 frames")).toBeVisible();
  await expect(page.getByText("One frame per call")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How deep does the stack go?");
});

test("legacy URLs redirect and unknown routes show a recoverable page", async ({ page }) => {
  await page.goto("/lesson/tcp");
  await expect(page).toHaveURL(/\/missions\/tcp-lab$/);
  await page.goto("/lesson/data-structures");
  await expect(page).toHaveURL(/\/missions\/ds-lab$/);
  await page.goto("/missions/not-a-mission");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
});

test("changing TCP settings rebuilds the trace without a blank screen (old crash path)", async ({ page }) => {
  await page.goto("/missions/tcp-lab");
  const max = async () => Number(await page.getByRole("slider", { name: "Step" }).getAttribute("max"));
  const before = await max();
  await page.getByRole("button", { name: "Just watch (no credit)" }).click();
  await runToEnd(page);
  await page.locator("label.choice").first().click();
  await page.getByRole("button", { name: "Check explanation" }).click();
  await page.getByRole("button", { name: /Retry/ }).click();
  // At the previous run's final index, shrink the payload to 500 B.
  await page.getByLabel(/Payload/).fill("500");
  await expect.poll(max).toBeLessThan(before);
  await expect(page.locator(".scene-title")).toBeVisible();
  await expect(page.locator(".tcp-segment")).toHaveCount(1);
  // Mid-run: start playing, then step and scrub; the scene must stay consistent.
  await page.locator("label.field", { hasText: "Your number" }).locator("input").fill("1");
  await page.getByRole("button", { name: "Test prediction" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.locator(".scene-step")).toHaveText(/Step \d+ of \d+/);
});

test("Kitab: hints before prediction don't spoil, tutor outage falls back, collapse and reopen", async ({ page }) => {
  await page.goto("/missions/tcp-lost-segment");
  await expect(page.locator(".kitab-avatar.mood-welcoming").first()).toBeVisible();
  await page.getByRole("button", { name: "Give me a hint" }).click();
  // No Worker in dev: the tutor request fails and the reviewed hint is shown instead.
  await expect(page.locator(".kitab-avatar.mood-unavailable")).toBeVisible();
  await expect(page.locator(".guide-source")).toHaveText("Reviewed explanation.");
  await page.locator(".guide-detail summary").click();
  const detail = await page.locator(".guide-detail p").textContent();
  expect(detail).toContain("segment 2");
  expect(detail).not.toMatch(/2461/);
  await page.getByRole("button", { name: "Show Segment 2" }).click();
  await expect(page.locator('[data-entity="segment-2"]')).toBeFocused();

  await page.getByRole("button", { name: "Collapse Kitab's guidance" }).click();
  await expect(page.locator("#guide-body")).toBeHidden();
  await page.getByRole("button", { name: "Open Kitab's guidance" }).click();
  await expect(page.locator("#guide-body")).toBeVisible();
  // The guide never steals focus from the learner.
  await expect(page.getByRole("button", { name: "Collapse Kitab's guidance" })).toBeFocused();
});

test("object selection is stable and the inspector reads the same frame", async ({ page }) => {
  await page.goto("/missions/graph-bfs-reach");
  await page.locator('[data-entity="vertex-6"]').click();
  await expect(page.locator('[data-entity="vertex-6"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".guide-message")).toHaveText("That's vertex 6.");
  await page.getByRole("tab", { name: "State" }).click();
  await expect(page.locator(".facts")).toContainText("BFS queue (front first)");
  await choose(page, "4th vertex");
  await page.getByRole("button", { name: "Test prediction" }).click();
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.locator('[data-entity="vertex-6"]')).toHaveAttribute("aria-pressed", "true");
  const queueFact = (await page.locator(".facts div", { hasText: "BFS queue" }).locator("dd").textContent())?.replace(" (changed)", "");
  const queueScene = await page.locator(".ds-queue-tokens li").allTextContents();
  expect(queueFact).toBe(queueScene.join(", ") || "empty");
});

test("keyboard-only: predict, run and explain without a pointer", async ({ page }) => {
  await page.goto("/missions/recursion-base-case");
  const radio = page.getByRole("radio").first();
  await radio.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(1);
  await page.keyboard.press("Enter"); // submits the prediction form
  await expect(page.getByRole("heading", { name: "Running the system" })).toBeFocused();
  await page.getByRole("slider", { name: "Step" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("heading", { name: "Explain what happened" })).toBeFocused();
  // Tab order reaches the evidence choices and the submit button.
  for (let i = 0; i < 6 && !(await page.getByRole("radio").first().evaluate((el) => el === document.activeElement)); i += 1) await page.keyboard.press("Tab");
  await page.keyboard.press("Space");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /mastered|Not mastered yet/ })).toBeFocused();
});

test("concept routes match slugs exactly", async ({ page }) => {
  await page.goto("/concepts/dns");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("DNS resolution");
  await page.goto("/concepts/a");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Not found");
});
