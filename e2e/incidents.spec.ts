import { expect, test, type Page } from "@playwright/test";

// The Production Incident Simulator end to end: find an incident, investigate it with the observability views and
// diagnostics, record hypotheses with evidence, change the system, verify (in the simulation worker), complete it
// and write the postmortem. Each test starts with empty browser storage, so the first version of each incident opens.

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true }).click();
const notebook = (page: Page) => page.getByRole("complementary", { name: "Investigation notebook" });

async function runCheck(page: Page, title: string) {
  await tab(page, "Diagnose");
  const card = page.locator(".inc-diagnostics > li").filter({ hasText: title });
  await card.getByRole("button", { name: /^Run/ }).click();
  return card;
}
async function addFinding(page: Page, check: string, finding: string) {
  const card = await runCheck(page, check);
  const row = card.locator(".inc-findings li").filter({ hasText: finding });
  await row.getByRole("button", { name: "Evidence" }).click();
  await expect(row.getByRole("button", { name: "In evidence" })).toBeDisabled();
}
async function confirm(page: Page, hypothesis: RegExp, evidence: string[]) {
  const group = notebook(page).getByRole("group", { name: hypothesis });
  await group.getByLabel("Confirmed").check();
  await group.getByText(/Evidence for this decision/).click();
  for (const e of evidence) await group.getByLabel(e).check();
}
async function verify(page: Page, outcome: string | RegExp) {
  await tab(page, "Fix & verify");
  const button = page.getByRole("button", { name: "Apply and verify" });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  await button.click();
  await expect(page.locator(".inc-result h3")).toHaveText(outcome, { timeout: 30_000 });
}
async function noOverflow(page: Page, where: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${where} overflows horizontally`).toBeLessThanOrEqual(1);
}

test("database pool exhaustion, guided: symptom, trace, pool, hypothesis, fix, verify, postmortem", async ({ page }) => {
  await page.goto("/practice");
  await page.getByRole("link", { name: /Production Incident Simulator/ }).click();
  await expect(page).toHaveURL(/\/practice\/incidents$/);
  await expect(page.locator(".inc-grid > li")).toHaveCount(12);
  await page.getByRole("link", { name: /Checkout can't get database connections/ }).click();
  await expect(page.locator("#main h1")).toHaveText("Checkout can't get database connections");
  await expect(page.getByText("SIMULATED", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".inc-status")).toContainText(/% of requests failing/);
  await expect(page.getByRole("button", { name: "Guided" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "The system" })).toBeVisible();

  // Latency first: the p95 chart is drawn from the run and has a table view.
  await tab(page, "Metrics");
  await page.getByRole("button", { name: "Latency", exact: true }).click();
  await expect(page.getByRole("img", { name: /p95 latency over the run/ })).toBeVisible();
  await page.locator(".inc-chart").filter({ hasText: "p95 latency" }).getByText("Show as a table").click();
  await expect(page.locator(".inc-chart").filter({ hasText: "p95 latency" }).locator("table tbody tr").first()).toBeVisible();

  // A failed checkout's trace: time waiting for a connection; add it as evidence.
  await tab(page, "Traces");
  await page.getByLabel("Endpoint").selectOption("checkout");
  await page.locator(".inc-trace-list button").first().click();
  await expect(page.locator(".inc-spans")).toContainText("db.pool.acquire");
  await page.getByRole("button", { name: "Add as evidence" }).click();
  await expect(notebook(page).locator(".inc-evidence li")).toHaveCount(1);

  // Logs for that trace are correlated by trace ID.
  await page.getByRole("button", { name: "Logs for this trace" }).click();
  await expect(page.locator(".inc-log").first()).toBeVisible();
  const traceId = await page.getByLabel("Trace ID").inputValue();
  expect(traceId).toMatch(/^[0-9a-f]{32}$/);

  await addFinding(page, "Check database connection pool utilization", "Pool exhausted");
  await addFinding(page, "Inspect the slowest and failed request traces", "Connection held during the payment call");
  await addFinding(page, "Check database load and slow queries", "Database has headroom");
  await expect(notebook(page).locator(".inc-guide-steps .is-done")).toHaveCount(3);
  await confirm(page, /holds each database connection while it waits/, ["Connection held during the payment call"]);
  await notebook(page).getByRole("group", { name: /The database is overloaded/ }).getByLabel("Rejected").check();

  // A bigger pool helps today but not under stress, and leaves the cause.
  await tab(page, "Fix & verify");
  await page.getByLabel(/Connection pool size/).fill("20");
  await verify(page, "Mitigated, root cause still present");
  await expect(page.locator(".inc-criteria")).toContainText("Under stress: checkout error rate");
  await page.getByRole("button", { name: "Undo last" }).click();

  await page.getByRole("button", { name: "Deploy hotfix v61.1" }).click();
  await verify(page, "Service fully recovered");
  await expect(notebook(page).getByText(/Incident resolved/)).toBeVisible();
  await expect(page.locator(".inc-status")).toContainText("Resolved");

  // The verification run is a separate execution with its own views.
  await page.getByRole("button", { name: "See the verification run" }).click();
  await expect(page.getByLabel("Viewing")).toHaveValue("target");
  await tab(page, "Changes");
  await expect(page.locator(".inc-changes")).toContainText("Your changes: Deploy hotfix v61.1");

  await tab(page, "Postmortem");
  await expect(page.locator(".inc-postmortem")).toContainText("Simulator conclusion");
  await expect(page.locator(".inc-postmortem")).toContainText("Your hypothesis");
  const lessons = page.locator(".inc-pm-section").filter({ hasText: "Lessons learned" }).getByLabel("Your analysis");
  await lessons.fill("Never hold a connection across a network call.");
  await lessons.blur();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download as Markdown" }).click();
  expect((await download).suggestedFilename()).toBe("postmortem-db-pool-exhaustion.md");

  // Saved: a reload keeps the evidence, the notes and the resolution.
  await page.reload();
  await expect(page.locator(".inc-status")).toContainText("Resolved", { timeout: 30_000 });
  await tab(page, "Postmortem");
  await expect(page.locator(".inc-pm-section").filter({ hasText: "Lessons learned" }).getByLabel("Your analysis")).toHaveValue(/network call/);
  await page.goto("/practice/incidents");
  await expect(page.locator(".inc-grid > li").first().locator(".status-chip")).toHaveText("Resolved");
});

test("retry storm, independent: amplification found, retries tamed, duplicates prevented", async ({ page }) => {
  await page.goto("/practice/incidents/retry-storm");
  await page.getByRole("button", { name: "Independent" }).click();
  await expect(page.getByRole("heading", { name: "The system" })).toHaveCount(0);
  await expect(notebook(page).getByText("Questions to ask")).toHaveCount(0);
  await addFinding(page, "Measure retry amplification", "Retries multiply the load");
  await addFinding(page, "Measure retry amplification", "Customers charged twice");

  await tab(page, "Fix & verify");
  await page.getByLabel("Payment retries", { exact: true }).fill("1");
  await page.getByLabel("Payment retry backoff").selectOption("exponential-jitter");
  await verify(page, "Not safe");
  await expect(page.locator(".inc-criteria")).toContainText("No customer is charged twice");
  await page.getByLabel("Idempotency keys on charges").check();
  await verify(page, "Service fully recovered");
  await confirm(page, /Our immediate retries keep the provider overloaded/, ["Retries multiply the load"]);
  await expect(notebook(page).getByText(/Incident resolved/)).toBeVisible();
});

test("identity: 401 not 403, an unsafe shortcut refused, the key refresh fixed and verified", async ({ page }) => {
  await page.goto("/practice/incidents/api-auth-failure");
  await addFinding(page, "Break failures down by status and error code", "Authentication failures (401)");
  await addFinding(page, "Classify authentication and authorization failures", "Tokens signed with a key the API doesn't have");
  await addFinding(page, "Classify authentication and authorization failures", "Authentication fails (401), not authorization (403)");
  await notebook(page).getByRole("group", { name: /lack the orders.read scope/ }).getByLabel("Rejected").check();
  await confirm(page, /signed with a key the API doesn't have/, ["Tokens signed with a key the API doesn't have"]);

  await tab(page, "Fix & verify");
  await page.getByLabel("Verify signatures").uncheck();
  await verify(page, "Not safe");
  await expect(page.locator(".inc-criteria")).toContainText("Forged, algorithm-confused and other-API tokens are rejected");
  await page.getByRole("button", { name: "Undo last" }).click();
  await page.getByRole("button", { name: "Reload keys now" }).click();
  await verify(page, "Mitigated, root cause still present");
  await page.getByRole("button", { name: "Undo last" }).click();
  await page.getByLabel("JWKS refresh").selectOption("on-unknown-kid");
  await verify(page, "Service fully recovered");
  await expect(notebook(page).getByText(/Incident resolved/)).toBeVisible();
});

test("multi-factor: two causes and a symptom told apart, isolation verified while the provider is degraded", async ({ page }) => {
  await page.goto("/practice/incidents/multi-factor");
  await expect(page.getByRole("button", { name: "Guided" })).toHaveAttribute("aria-pressed", "true");
  await addFinding(page, "Check API thread and request-queue saturation", "Every API thread busy");
  await addFinding(page, "Check API thread and request-queue saturation", "Product pages fail too");
  await addFinding(page, "Review timeouts, retries, pools and health checks", "Long payment timeout");
  await addFinding(page, "Compare dependency latency and errors before and during", "Payment provider slower or failing");
  await confirm(page, /provider slowed down/, ["Payment provider slower or failing"]);
  await confirm(page, /v44's new SDK/, ["Long payment timeout"]);
  const threads = notebook(page).getByRole("group", { name: /stuck waiting on payments/ });
  await threads.getByLabel("Confirmed").check();

  await tab(page, "Fix & verify");
  await page.getByRole("button", { name: "Roll back to v43" }).click();
  await verify(page, "Not safe");
  await page.getByRole("button", { name: "Undo last" }).click();
  await page.getByLabel(/Payment call timeout/).fill("2000");
  await page.getByLabel("Payment retries", { exact: true }).fill("1");
  await page.getByLabel("Idempotency keys on charges").check();
  await page.getByLabel("Circuit breaker on payment calls").check();
  await verify(page, "Service fully recovered");
  await expect(page.locator(".inc-criteria")).toContainText("While payments are degraded: product-page error rate");
  await expect(notebook(page).getByText(/Incident resolved/)).toBeVisible();
});

test("every tab fits the screen and the workspace is keyboard operable", async ({ page }, info) => {
  const widths = info.project.name === "phone-390" ? [390, 320] : [page.viewportSize()!.width];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/practice/incidents");
    await noOverflow(page, `incident list at ${width}`);
    await page.goto("/practice/incidents/cache-stampede");
    await expect(page.locator(".inc-status")).toContainText(/% of requests failing/);
    for (const name of ["Overview", "Metrics", "Logs", "Traces", "Topology", "Changes", "Diagnose", "Fix & verify", "Postmortem"]) {
      await tab(page, name);
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      await noOverflow(page, `${name} at ${width}`);
    }
    await tab(page, "Traces");
    await page.getByLabel("Show").selectOption("slow");
    await page.locator(".inc-trace-list button").first().click();
    await noOverflow(page, `trace waterfall at ${width}`);
    await runCheck(page, "Check cache hit rate and concurrent misses");
    await noOverflow(page, `diagnostic result at ${width}`);
  }
  // Arrow keys move between tabs; the selected tab is the only one in the tab order.
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page.getByRole("tab", { name: "Overview", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Metrics", exact: true })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Metrics", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Postmortem", exact: true })).toBeFocused();
  await expect(page.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
});

test("an unknown incident shows a recoverable page; replay moves every view to an earlier moment", async ({ page }) => {
  await page.goto("/practice/incidents/no-such-incident");
  await expect(page.getByRole("heading", { name: "Not found" })).toBeVisible();
  await page.goto("/practice/incidents/dns-misconfiguration");
  await tab(page, "Topology");
  await expect(page.locator(".inc-node").filter({ hasText: "Browsers (RUM)" })).toContainText("Failing");
  await expect(page.locator(".inc-node").filter({ hasText: "DNS" })).toContainText("No telemetry");
  const slider = page.getByLabel(/^Up to/);
  await slider.fill("8000");
  await expect(page.locator("#topology-title")).toHaveText("Topology at 0:08");
  await expect(page.locator(".inc-node").filter({ hasText: "Browsers (RUM)" })).toContainText("Healthy");
  await tab(page, "Changes");
  await expect(page.getByText("No change recorded up to 0:08.")).toBeVisible();
});
