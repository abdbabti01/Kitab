import { expect, test, type Page } from "@playwright/test";
import { idempotencyUnit } from "../src/architecture/concepts/idempotency.ts";
import { productionUnit } from "../src/architecture/concepts/production.ts";
import { labs } from "../src/architecture/labs/index.ts";

// Architecture labs and System Design concept units: predict, observe, fix, explain; mastery only from all three in
// one attempt; concept checks and decisions completing a unit; saved progress from before the labs; narrow screens.

async function fresh(page: Page, path: string) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(path);
}
const stored = (page: Page, key: string) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), key);
const lab = (page: Page) => fresh(page, "/practice/architecture/labs/idempotent-payments");

async function predict(page: Page, value: string) {
  await page.getByRole("radio", { name: value, exact: true }).check();
  await page.getByRole("button", { name: "Lock in my prediction" }).click();
}

async function fixPayments(page: Page) {
  await page.getByLabel("Idempotency key").selectOption("per-order");
  await page.getByLabel("Where the API records keys").selectOption("atomic");
  await page.getByLabel("Pass the key on to the card provider").check();
  await page.getByLabel("Retries", { exact: true }).fill("3");
  await page.getByLabel("Wait before retrying (ms)").fill("500");
  await page.getByLabel("In-progress lease (ms)").fill("2000");
}

test("a lab: predict, watch the failure, fix it for every scenario, explain it, mastered", async ({ page }) => {
  await lab(page);
  await expect(page.getByRole("heading", { name: "Build an idempotent payment API" })).toBeVisible();
  // Before predicting, nothing of the run is shown and there's nothing to fix yet.
  await expect(page.getByRole("region", { name: "The run: today's system" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Fix it" })).toHaveCount(0);
  await predict(page, "2");
  await expect(page.getByRole("status").filter({ hasText: "Right: 2." })).toBeVisible();
  const run = page.getByRole("region", { name: "The run: today's system" });
  await expect(run.getByText(/charged 2 times for one order/)).toBeVisible();
  // The starter fails its checks.
  await page.getByRole("button", { name: "Check every scenario" }).click();
  await expect(page.getByRole("heading", { name: /of 12 requirements met/ })).toBeFocused();
  await fixPayments(page);
  await page.getByRole("button", { name: "Check every scenario" }).click();
  await expect(page.getByRole("heading", { name: "Every requirement is met in every scenario" })).toBeVisible();
  // Explain it; the right answer here completes mastery.
  await page.getByRole("radio", { name: /No: repeats still arrive and are handled/ }).check();
  await page.getByRole("button", { name: "Answer", exact: true }).click();
  await expect(page.getByText("Mastered.", { exact: false })).toBeVisible();
  const saved = await stored(page, "kitab.architecture.labs.v1");
  expect(saved.labs["idempotent-payments"].masteredAt).toBeTruthy();
  // The roadmap and the labs index read the same record.
  await page.goto("/practice/architecture/labs");
  await expect(page.locator(".lab-tile", { hasText: "Build an idempotent payment API" }).locator(".status-chip")).toHaveText("Mastered");
  await page.goto("/learn/system-design");
  const unit = page.locator(".path-stages details", { has: page.locator("summary", { hasText: "Idempotency and safe retries" }) });
  await unit.locator("summary").click();
  await expect(unit.locator(".path-activity", { hasText: "Build an idempotent payment API" }).locator(".status-chip")).toHaveText("Mastered");
});

test("a wrong prediction completes the lab but doesn't master it; another variant asks something new", async ({ page }) => {
  await lab(page);
  await predict(page, "3");
  await expect(page.getByText(/You said 3; the run shows 2/)).toBeVisible();
  await fixPayments(page);
  await page.getByRole("button", { name: "Check every scenario" }).click();
  await expect(page.getByRole("heading", { name: "Every requirement is met in every scenario" })).toBeVisible();
  await page.getByRole("radio", { name: /No: repeats still arrive and are handled/ }).check();
  await page.getByRole("button", { name: "Answer", exact: true }).click();
  await expect(page.getByText(/Completed, not mastered yet/)).toBeVisible();
  await expect(page.getByText(/this attempt's prediction was off/)).toBeVisible();
  // A new attempt: a different prediction and today's system again.
  await page.getByRole("button", { name: "Try another variant" }).click();
  await expect(page.getByText(/answers to the first two attempts are lost/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fix it" })).toHaveCount(0);
  await predict(page, "3");
  await expect(page.getByLabel("Idempotency key")).toHaveValue("none");
  // Reloading keeps the attempt where it was.
  await page.reload();
  await expect(page.getByLabel("Idempotency key")).toHaveValue("none");
  await expect(page.getByText(/answers to the first two attempts are lost/)).toBeVisible();
});

test("playback: step through a run, jump to an event, and read the numbers so far", async ({ page }) => {
  await lab(page);
  await predict(page, "2");
  const run = page.getByRole("region", { name: "The run: today's system" });
  const clock = run.locator(".clock");
  await expect(clock).toContainText(/Event (\d+) of \1/);
  await run.getByRole("button", { name: "First event" }).click();
  await expect(clock).toContainText("Event 1 of");
  await expect(run.getByText("Step to the end to see what the whole run means.")).toBeVisible();
  await run.getByRole("button", { name: "Next event" }).click();
  await expect(clock).toContainText("Event 2 of");
  // Card charges so far: none yet at the start.
  await expect(run.locator(".run-stats div", { hasText: "Card charges" }).locator("dd")).toHaveText("0");
  await run.locator(".seq-row", { hasText: "Charges the card $40 again" }).getByRole("button").click();
  await expect(run.locator(".run-stats div", { hasText: "Card charges" }).locator("dd")).toHaveText("2");
  await run.getByRole("button", { name: "Last event" }).click();
  await expect(run.getByText(/What happened:/)).toBeVisible();
});

test("a series lab shows its chart, with a table for screen readers", async ({ page }) => {
  await fresh(page, "/practice/architecture/labs/retry-storm");
  await predict(page, "6,400");
  const run = page.getByRole("region", { name: "The run: today's system" });
  await expect(run.locator("figure.series svg")).toBeVisible();
  await run.getByText("Show as a table").click();
  await expect(run.locator(".chart-table table tbody tr").first()).toBeVisible();
});

test("a concept unit completes only when every check is answered right", async ({ page }) => {
  await fresh(page, "/learn/system-design/idempotency");
  await expect(page.getByRole("heading", { level: 1, name: "Idempotency and safe retries" })).toBeVisible();
  const total = idempotencyUnit.concepts.length;
  await expect(page.getByText(`0 of ${total} checks answered right`)).toBeVisible();
  for (const [index, concept] of idempotencyUnit.concepts.entries()) {
    const card = page.locator(`article#${concept.id}`);
    const wrong = concept.check.options.find((o) => !o.correct)!;
    if (index === 0) {
      await card.getByRole("radio", { name: wrong.text, exact: true }).check();
      await card.getByRole("button", { name: "Check my answer" }).click();
      await expect(card.getByText("Try another answer.", { exact: false })).toBeVisible();
    }
    await card.getByRole("radio", { name: concept.check.options.find((o) => o.correct)!.text, exact: true }).check();
    await card.getByRole("button", { name: "Check my answer" }).click();
    await expect(card.getByRole("status")).toContainText("Right.");
  }
  await expect(page.getByText(`Lesson complete: all ${total} checks answered right.`)).toBeVisible();
  await page.goto("/learn/system-design");
  const unit = page.locator(".path-stages details", { has: page.locator("summary", { hasText: "Idempotency and safe retries" }) });
  await unit.locator("summary").click();
  await expect(unit.locator(".path-activity", { hasText: "Idempotency and safe retries" }).locator(".status-chip")).toHaveText("Completed");
});

test("a design decision accepts any sound choice, and only reasons that support it", async ({ page }) => {
  await fresh(page, "/learn/system-design/production#decision-startup-architecture");
  const decision = productionUnit.decisions!.find((d) => d.id === "startup-architecture")!;
  const card = page.locator("article#decision-startup-architecture");
  const reasons = decision.reasons.filter((r) => r.relevant).map((r) => r.text);
  // The plain monolith is also acceptable; an unsupported reason makes the decision fail.
  await card.getByRole("radio", { name: decision.choices[1].text }).check();
  for (const r of reasons.slice(0, 2)) await card.getByRole("checkbox", { name: r }).check();
  await card.getByRole("checkbox", { name: decision.reasons.find((r) => !r.relevant)!.text }).check();
  await card.getByRole("button", { name: "Check my decision" }).click();
  await expect(card.getByRole("status")).toContainText("don't hold or don't support it");
  await card.getByRole("checkbox", { name: decision.reasons.find((r) => !r.relevant)!.text }).uncheck();
  await card.getByRole("button", { name: "Check my decision" }).click();
  await expect(card.locator(".lab-feedback.is-right")).toBeVisible();
  const saved = await stored(page, "kitab.architecture.labs.v1");
  expect(saved.units.production.answers["decision:startup-architecture"].correct).toBe(true);
});

test("saved progress from before the labs still shows, and a damaged lab store is set aside", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("kitab.architecture.progress.v1", JSON.stringify({ version: 1, challenges: { "simple-web-app": { version: "1", attempts: 2, lastAt: "2026-11-10T10:00:00.000Z", passedAt: "2026-11-10T10:00:00.000Z" } }, lessons: { fundamentals: { experimentAt: "2026-11-10T09:00:00.000Z" } } }));
    localStorage.setItem("kitab.architecture.labs.v1", "{damaged");
  });
  const before = await stored(page, "kitab.architecture.progress.v1");
  await page.goto("/learn/system-design");
  const unit = page.locator(".path-stages details", { has: page.locator("summary", { hasText: "Architecture fundamentals" }) });
  await expect(unit.locator("summary")).toContainText("2 of 2 completed");
  // Browsing the roadmap rewrites nothing.
  expect(await stored(page, "kitab.architecture.progress.v1")).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("kitab.architecture.labs.v1"))).toBe("{damaged");
  // Using a lab repairs its own store and keeps the damaged copy aside; the old store is untouched.
  await page.goto("/practice/architecture/labs/outbox");
  await predict(page, "2");
  expect(await page.evaluate(() => localStorage.getItem("kitab.architecture.labs.v1.corrupt"))).toBe("{damaged");
  expect((await stored(page, "kitab.architecture.labs.v1")).labs.outbox.attempts).toHaveLength(1);
  expect(await stored(page, "kitab.architecture.progress.v1")).toEqual(before);
});

test("every lab opens, predicts and runs without errors, fits the screen, and names its controls", async ({ page }) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fresh(page, "/practice/architecture/labs");
  for (const l of labs) {
    await page.goto(`/practice/architecture/labs/${l.id}`);
    await expect(page.getByRole("heading", { level: 1, name: l.title })).toBeVisible();
    await page.locator(".lab-choice input[type=radio]").first().check();
    await page.getByRole("button", { name: "Lock in my prediction" }).click();
    await expect(page.getByRole("region", { name: "The run: today's system" }).getByText(/What happened:/)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${l.id} overflows horizontally`).toBeLessThanOrEqual(1);
    const unnamed = await page.evaluate(() =>
      [...document.querySelectorAll("main button, main input, main select")]
        .filter((el) => (el as HTMLElement).offsetParent !== null)
        .filter((el) => !(el.getAttribute("aria-label") || (el as HTMLInputElement).labels?.length || (el.textContent ?? "").trim() || el.closest("label")))
        .map((el) => el.outerHTML.slice(0, 80)),
    );
    expect(unnamed, l.id).toEqual([]);
  }
  expect(errors).toEqual([]);
});
