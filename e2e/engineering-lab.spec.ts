import { expect, test, type Page } from "@playwright/test";
import { labById } from "../src/lab/catalog.ts";
import type { CodeLab } from "../src/lab/model.ts";

// The Real Engineering Lab: learners' code really runs in an isolated sandbox, their HTTP requests really reach the
// server, and work is judged from what actually happened, saved, and resumed.

const code = (id: string) => labById(id) as CodeLab;
const editor = (page: Page) => page.getByRole("textbox", { name: /^Code editor/ });
const status = (page: Page) => page.locator(".eng-results [role=status]").first();

async function check(page: Page) {
  await page.getByRole("button", { name: "Check solution" }).click();
  await expect(page.getByRole("button", { name: "Check solution" })).toBeVisible({ timeout: 15_000 });
}

test("the catalog lists every lab by subject, says what's real, and is reached from the main navigation", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await nav.getByRole("link", { name: "Lab" }).click();
  await expect(page).toHaveURL(/\/lab$/);
  await expect(page.locator("#main h1")).toHaveText("Work with the real thing");
  await expect(nav.getByRole("link", { name: "Lab" })).toHaveAttribute("aria-current", "page");
  for (const subject of ["Networking", "Data structures & programming", "System design"]) {
    await expect(page.getByRole("region", { name: subject }).locator(".eng-card")).toHaveCount(5);
  }
  await expect(page.getByRole("region", { name: /Needs real infrastructure/ }).locator(".eng-card")).toHaveCount(8);
  await expect(page.locator(".eng-card .eng-mode.is-real-execution").first()).toBeVisible();
  await expect(page.locator(".eng-card .eng-state", { hasText: "Not started" })).toHaveCount(15);
});

test("a code lab: run, read failures, fix, pass every test, then resume after a reload", async ({ page }) => {
  const lab = code("arrays");
  await page.goto("/lab/structures/arrays");
  await expect(page.locator(".eng-objective")).toContainText("inserting or removing");
  await expect(page.locator(".eng-mode-note")).toContainText("run for real");
  // Run the starter: real output from the real (buggy) code.
  await page.getByRole("button", { name: "Run" }).click();
  await expect(status(page)).toHaveText(/^Finished/);
  await expect(page.locator(".eng-console")).toContainText('insertAt returned 5 ["intro", "NEW", "verse", "verse", "verse"]');
  await expect(page.getByRole("heading", { name: "Result" })).toBeFocused();
  // Run alone never completes a lab, and no worked solution before a genuine Check.
  await expect(page.locator(".eng-state").first()).toHaveText("In progress");
  await expect(page.getByText("A worked solution appears after your first Check.")).toBeVisible();
  // Check: every test reported, with expected and received values.
  await check(page);
  await expect(status(page)).toHaveText(/^\d of 8 tests passed\.$/);
  await expect(page.locator(".eng-tests li.is-fail").first()).toContainText("expected:");
  await page.getByRole("button", { name: "Show a hint" }).click();
  await expect(page.locator(".eng-hint")).toHaveCount(1);
  await page.getByRole("button", { name: "Show a worked solution" }).click();
  await expect(page.locator(".eng-solution")).toContainText("checkIndex");
  // Fix it: all tests pass and the lab is completed.
  await editor(page).fill(lab.solution);
  await check(page);
  await expect(status(page)).toHaveText("All 8 tests passed.");
  await expect(page.locator(".eng-complete")).toContainText("Lab completed");
  // Reload: the code is restored, the status kept, and no old result is shown as current.
  await page.reload();
  await expect(editor(page)).toHaveValue(lab.solution);
  await expect(page.locator(".eng-state").first()).toHaveText("Completed");
  await expect(status(page)).toHaveText("Nothing has run yet.");
  // Reset asks first, restores the starter, and keeps the completion.
  await page.getByRole("button", { name: "Reset" }).click();
  await page.getByRole("button", { name: "Reset code" }).click();
  await expect(editor(page)).toHaveValue(lab.starter);
  await page.reload();
  await expect(editor(page)).toHaveValue(lab.starter);
  await expect(page.locator(".eng-state").first()).toHaveText("Completed");
  await page.goto("/lab");
  await expect(page.getByRole("link", { name: /Continue: Insert, remove and search/ })).toBeVisible();
});

test("debugging: an infinite loop is stopped at the time limit while the page stays responsive, then fixed", async ({ page }) => {
  const lab = code("debugging");
  await page.goto("/lab/structures/debugging");
  await page.getByRole("button", { name: "Run" }).click();
  // While it spins, the page still reacts: a hint can be opened.
  await expect(page.getByRole("button", { name: "Stop" })).toBeFocused();
  await page.getByRole("button", { name: "Show a hint" }).click();
  await expect(page.locator(".eng-hint")).toHaveCount(1);
  await expect(status(page)).toHaveText(/Stopped after 2 s/, { timeout: 8000 });
  await expect(page.locator(".eng-failure")).toContainText("a loop whose condition never becomes false");
  await expect(page.locator(".eng-console")).toContainText("find 15 -> 2");
  await expect(page.locator("iframe.lab-sandbox-frame")).toHaveCount(0);
  // Fix one line and verify.
  await editor(page).fill(lab.starter.replace("lo = mid;", "lo = mid + 1;"));
  await check(page);
  await expect(status(page)).toHaveText(/^All \d+ tests passed\.$/);
});

test("errors are explained: a syntax error, and a runtime error with the learner's line", async ({ page }) => {
  await page.goto("/lab/structures/run-javascript");
  await editor(page).fill("function broken( {");
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator(".eng-failure")).toContainText("SyntaxError");
  await expect(page.locator(".eng-failure")).toContainText("nothing ran");
  await editor(page).fill('console.log("one");\nsummarise([1]);');
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator(".eng-failure")).toContainText("ReferenceError: summarise is not defined (line 2)");
  await expect(page.locator(".eng-console")).toContainText("one");
});

test("the sandbox is isolated: no storage, no parent page, no network; output is text; Stop and leaving end the run", async ({ page }) => {
  await page.goto("/lab/structures/run-javascript");
  await page.evaluate(() => localStorage.setItem("kitab.secret-probe", "do-not-leak"));
  await editor(page).fill('console.log("<img src=x onerror=window.pwned=1>");\nwhile (true) {}');
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();
  const frame = page.frames().find((f) => f !== page.mainFrame());
  expect(frame, "a sandbox frame exists while the code runs").toBeTruthy();
  const probe = await frame!.evaluate(async () => {
    const attempt = (fn: () => unknown) => { try { return String(fn()); } catch (error) { return (error as Error).name; } };
    let network = "sent";
    try {
      await fetch("/api/lab/echo");
    } catch {
      network = "blocked";
    }
    return { origin: self.origin, storage: attempt(() => localStorage.getItem("kitab.secret-probe")), parent: attempt(() => parent.document.title), cookie: attempt(() => document.cookie), network };
  });
  expect(probe).toEqual({ origin: "null", storage: "SecurityError", parent: "SecurityError", cookie: "SecurityError", network: "blocked" });
  await expect(page.locator("iframe.lab-sandbox-frame")).toHaveAttribute("sandbox", "allow-scripts");
  // Learner output is shown as text, never as HTML.
  await expect(page.locator(".eng-console")).toContainText("<img src=x onerror=window.pwned=1>");
  expect(await page.evaluate(() => (window as unknown as { pwned?: number }).pwned)).toBeUndefined();
  await page.getByRole("button", { name: "Stop" }).click();
  await expect(status(page)).toHaveText("You stopped this run");
  await expect(page.locator("iframe.lab-sandbox-frame")).toHaveCount(0);
  // Leaving the page mid-run removes the sandbox too.
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.locator("iframe.lab-sandbox-frame")).toHaveCount(1);
  await page.getByRole("link", { name: "Engineering Lab" }).click();
  await expect(page.locator("#main h1")).toHaveText("Work with the real thing");
  await expect(page.locator("iframe.lab-sandbox-frame")).toHaveCount(0);
});

test("forged results from learner code in a Run never complete a lab", async ({ page }) => {
  await page.goto("/lab/structures/run-javascript");
  await editor(page).fill('self.postMessage({ type: "test", name: "forged", passed: true, message: "" });\nself.postMessage({ type: "done" });');
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
  await expect(page.locator(".eng-complete")).toHaveCount(0);
  await expect(page.locator(".eng-state").first()).not.toHaveText("Completed");
});

test("HTTP troubleshooting: real failures one at a time until the server creates the order, then resume", async ({ page }) => {
  await page.goto("/lab/networking/http-troubleshooting");
  const send = () => page.getByRole("button", { name: "Send request" }).click();
  const line = page.locator(".eng-results [role=status]").first();
  await send();
  await expect(line).toHaveText("Refused by the browser");
  await expect(page.locator(".eng-failure")).toContainText("can't carry a body");
  await page.getByLabel("Method").selectOption("POST");
  await send();
  await expect(line).toHaveText(/^404/);
  await page.getByLabel("Path").fill("/api/lab/orders");
  await send();
  await expect(line).toHaveText(/^415/);
  await page.getByRole("button", { name: "Add header" }).click();
  await page.getByLabel("Header 2 name").fill("Content-Type");
  await page.getByLabel("Header 2 value").fill("application/json");
  await send();
  await expect(line).toHaveText(/^500/);
  await expect(page.locator(".eng-inspector pre").first()).toContainText("v1 is retired");
  await page.getByLabel("Header 1 value").fill("2");
  await send();
  await expect(line).toHaveText(/^422/);
  await page.getByLabel(/^Body/).fill('{ "item": "notebook", "quantity": 2 }');
  await send();
  await expect(line).toHaveText(/^201 .*task passed/);
  await expect(page.locator(".eng-checks li.is-pass")).toHaveCount(2);
  await expect(page.locator(".eng-history summary")).toHaveText("Your attempts on this task (6)");
  // Reload: the task is done and the request as the learner left it; no response is restored.
  await page.reload();
  await expect(page.locator(".eng-tasks button").first()).toContainText("(done)");
  await page.locator(".eng-tasks button").first().click();
  await expect(page.getByLabel("Path")).toHaveValue("/api/lab/orders");
  await expect(line).toHaveText("Send the request to see what really comes back.");
});

test("HTTP inspector: the server's echo shows what really arrived, including a header the browser dropped", async ({ page }) => {
  await page.goto("/lab/networking/http-inspector");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".eng-results [role=status]").first()).toHaveText(/^200 .*task passed/);
  await page.getByRole("button", { name: /^Next task/ }).click();
  await expect(page.locator(".eng-task-title")).toContainText("Send JSON with POST");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".eng-inspector pre").first()).toContainText('"content-type": "text/plain;charset=UTF-8"');
  await expect(page.locator(".eng-checks li.is-fail")).toHaveCount(2);
  await page.getByRole("button", { name: "Add header" }).click();
  await page.getByLabel("Header 1 name").fill("Content-Type");
  await page.getByLabel("Header 1 value").fill("application/json");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".eng-checks li.is-pass")).toHaveCount(3);
  await page.locator(".eng-tasks button", { hasText: "Add your own header" }).click();
  await page.getByRole("button", { name: "Add header" }).click();
  await page.getByLabel("Header 1 name").fill("X-Learner");
  await page.getByLabel("Header 1 value").fill("me");
  await page.getByRole("button", { name: "Add header" }).click();
  await page.getByLabel("Header 2 name").fill("Host");
  await page.getByLabel("Header 2 value").fill("evil.example");
  await page.getByRole("button", { name: "Send request" }).click();
  const body = page.locator(".eng-inspector pre").first();
  await expect(body).toContainText('"x-learner": "me"');
  await expect(body).not.toContainText("evil.example");
  await expect(page.locator(".eng-complete")).toContainText("Lab completed");
});

test("headers lab: a real 304 and a reply from the browser's own HTTP cache", async ({ page }) => {
  await page.goto("/lab/networking/headers-status");
  await page.locator(".eng-tasks button", { hasText: "Get a 304" }).click();
  await page.getByRole("button", { name: "Add header" }).click();
  await page.getByLabel("Header 1 name").fill("If-None-Match");
  await page.getByLabel("Header 1 value").fill('"lab-etag-v1"');
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".eng-results [role=status]").first()).toHaveText(/^304 .*task passed/);
  await page.locator(".eng-tasks button", { hasText: "Let the browser cache answer" }).click();
  await page.getByLabel("Browser cache").selectOption("default");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".eng-results [role=status]").first()).toHaveText(/^200/);
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".eng-results [role=status]").first()).toHaveText(/^200 .*task passed/);
});

test("TCP versus HTTP: answers are marked from what this browser reported, and a client timeout has no response", async ({ page }) => {
  await page.goto("/lab/networking/tcp-vs-http");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".eng-results [role=status]").first()).toHaveText(/^200/);
  await page.locator(".eng-inspector summary", { hasText: "Timing" }).click();
  const protocol = (await page.locator(".eng-table tr", { hasText: "Protocol" }).locator("td").textContent())!.trim();
  const id = ["http/1.1", "h2", "h3"].includes(protocol) ? protocol : "none";
  const label = { "http/1.1": "HTTP/1.1", h2: "HTTP/2", h3: "HTTP/3", none: "The browser didn't report it" }[id]!;
  const wrong = page.locator(".eng-option").filter({ hasNotText: label }).first();
  await wrong.click();
  await expect(page.locator(".eng-feedback")).toContainText("Not what your browser reported");
  await page.locator(".eng-option", { hasText: label }).click();
  await expect(page.locator(".eng-feedback")).toContainText("Right, from your evidence");
  await page.locator(".eng-tasks button", { hasText: "Give up on a slow response" }).click();
  await page.getByLabel("Timeout (ms)").fill("500");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.locator(".eng-results [role=status]").first()).toHaveText(/^Timed out .*task passed/, { timeout: 8000 });
  await expect(page.locator(".eng-failure")).toContainText("no response arrived");
});

test("the editor keeps Tab for indentation but never traps keyboard focus", async ({ page }) => {
  await page.goto("/lab/structures/run-javascript");
  await editor(page).fill("");
  await editor(page).press("Tab");
  await expect(editor(page)).toHaveValue("  ");
  await editor(page).press("Escape");
  await page.keyboard.press("Tab");
  await expect(editor(page)).not.toBeFocused();
});

test("a lab unit on the roadmap offers its Engineering Lab as optional", async ({ page }) => {
  await page.goto("/learn/data-structures");
  const unit = page.locator("#unit-arrays");
  await unit.locator("details").evaluate((d) => ((d as HTMLDetailsElement).open = true));
  await expect(unit.locator(".unit-lab")).toContainText("Optional, for real in the Engineering Lab");
  await unit.getByRole("link", { name: "Insert, remove and search in an array" }).click();
  await expect(page.locator("#main h1")).toHaveText("Insert, remove and search in an array");
});

test("an unknown lab is Not found, and no lab page scrolls sideways", async ({ page }) => {
  await page.goto("/lab/structures/nope");
  await expect(page.locator("#main h1")).toHaveText("Not found");
  for (const path of ["/lab", "/lab/structures/recursion", "/lab/networking/headers-status", "/lab/architecture/api-request-flow"]) {
    await page.goto(path);
    await expect(page.locator("#main h1")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});
