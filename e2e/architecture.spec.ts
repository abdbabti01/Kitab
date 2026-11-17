import { expect, test, type Page } from "@playwright/test";
import { systemDesignPath } from "../src/learning/tracks.ts";

// The System Design track: Architecture Playground editing, saving, loading and playback, a challenge, a lesson
// experiment, keyboard use and narrow screens (every project width).

const nodes = (page: Page) => page.locator("[data-node]");
const add = (page: Page, name: string) => page.getByRole("navigation", { name: "Add a component" }).getByRole("button", { name: `Add ${name}`, exact: true }).click();

async function fresh(page: Page, template = "blank") {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/practice/architecture?template=${template}`);
  await expect(page.getByRole("heading", { name: "Architecture Playground" })).toBeVisible();
}

/** Every control a learner can operate has a name. */
async function unnamedControls(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("main button, main input, main select, main textarea, main [role=button]")]
      .filter((el) => (el as HTMLElement).offsetParent !== null || el.closest("svg"))
      .filter((el) => {
        const labelled = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (el as HTMLInputElement).labels?.length || el.getAttribute("title");
        return !labelled && !(el.textContent ?? "").trim() && (el as HTMLInputElement).type !== "hidden" && (el as HTMLInputElement).type !== "file";
      })
      .map((el) => el.outerHTML.slice(0, 80)),
  );
}

test("build a design from the palette, connect by keyboard-friendly controls, undo and redo", async ({ page }) => {
  await fresh(page);
  await add(page, "Client");
  await add(page, "API server");
  await add(page, "SQL database");
  await expect(nodes(page)).toHaveCount(3);
  // The new SQL database is selected; connect the API to it from the API's inspector.
  await page.locator("[data-node=api-1]").focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Connect to").selectOption("sql-1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.locator("[data-node=client-1]").focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Connect to").selectOption("api-1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.locator(".arch-edge")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Run simulation" })).toBeEnabled();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".arch-edge")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Run simulation" })).toBeDisabled();
  await expect(page.getByText(/Fix one problem first/)).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.locator(".arch-edge")).toHaveCount(2);
  // A connection the rules refuse is never offered: a client can't reach a database.
  await page.locator("[data-node=client-1]").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Connect to").locator("option", { hasText: "SQL database" })).toHaveCount(0);
});

test("keyboard: components move with arrow keys, delete with Delete, and the list view mirrors the diagram", async ({ page }) => {
  await fresh(page, "three-tier");
  const api = page.locator("[data-node=api-1]");
  const before = await api.getAttribute("transform");
  await api.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(api).not.toHaveAttribute("transform", before!);
  // Each key press is one undo step.
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(api).toHaveAttribute("transform", before!);
  await api.focus();
  await page.keyboard.press("Delete");
  await expect(nodes(page)).toHaveCount(2);
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.locator(".design-list > li")).toHaveCount(2);
  await page.locator(".design-list").getByRole("button", { name: /Users/ }).click();
  await expect(page.getByRole("heading", { name: "Users", level: 2 })).toBeVisible();
  expect(await unnamedControls(page)).toEqual([]);
});

test("designs are saved as you work, survive a reload, and can be renamed, duplicated and deleted", async ({ page }) => {
  await fresh(page, "cached-api");
  const name = page.getByLabel("Design name");
  await name.fill("Shop catalogue");
  await expect(page.getByText("Saved on this device")).toBeVisible();
  const url = page.url();
  await page.reload();
  await expect(page.getByLabel("Design name")).toHaveValue("Shop catalogue");
  await expect(nodes(page)).toHaveCount(4);
  await page.getByRole("button", { name: "Duplicate this design" }).click();
  await expect(page.getByLabel("Design name")).toHaveValue("Shop catalogue (copy)");
  expect(page.url()).not.toBe(url);
  await page.getByRole("button", { name: "Designs", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Your designs" });
  await expect(dialog.locator(".design-rows li")).toHaveCount(2);
  page.once("dialog", (d) => d.accept());
  await dialog.getByRole("button", { name: "Delete Shop catalogue (copy)" }).click();
  // Deleting the open design opens the next one.
  await expect(page.getByLabel("Design name")).toHaveValue("Shop catalogue");
  await page.getByRole("button", { name: "Designs", exact: true }).click();
  await expect(dialog.locator(".design-rows li")).toHaveCount(1);
  // The deleted design stays deleted: nothing saves it again on the way out.
  await page.reload();
  await page.getByRole("button", { name: "Designs", exact: true }).click();
  await expect(dialog.locator(".design-rows li")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close" }).click();
  // Reopening by address works; an unknown address says so.
  await page.goto(url);
  await expect(page.getByLabel("Design name")).toHaveValue("Shop catalogue");
  await page.goto("/practice/architecture?design=d-missing");
  await expect(page.getByText("That design isn't saved in this browser.")).toBeVisible();
});

test("importing a malformed file explains why and changes nothing", async ({ page }) => {
  await fresh(page, "three-tier");
  await page.locator("input[type=file]").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "kitab.architecture", version: 9 })) });
  await expect(page.getByText(/Couldn't import “bad.json”: This design was saved by a newer version of Kitab/).first()).toBeVisible();
  await expect(nodes(page)).toHaveCount(3);
  await page.locator("input[type=file]").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from("{oops") });
  await expect(page.getByText(/isn't valid JSON/).first()).toBeVisible();
});

test("a run plays back: step through events, follow one request, seek, and read the findings", async ({ page }) => {
  await fresh(page, "three-tier");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await expect(page.getByText(/event 0 of/)).toBeVisible();
  await page.getByRole("button", { name: "Step forward one event" }).click();
  await expect(page.locator(".current-event")).toContainText("Users sends request #1: a read of item");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Step forward one event" }).click();
  await expect(page.getByText(/event 5 of/)).toBeVisible();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("button", { name: "Follow #1" }).first().click();
  await expect(page.getByRole("heading", { name: "Request #1, every step" })).toBeVisible();
  await expect(page.locator(".event-list li").last()).toContainText("request #1 succeeds after 107 ms");
  await page.getByRole("button", { name: "Skip to the end" }).click();
  await expect(page.getByText(/^100% of 500 requests succeeded$/)).toBeVisible();
  // The inspector reads the same fold: the API server's state at the end.
  await page.locator("[data-node=api-1]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".live-state")).toContainText("Started");
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  // Editing the design marks the run as out of date.
  await page.getByLabel("Requests at once").fill("4");
  await expect(page.getByText("The design changed after this run.")).toBeVisible();
});

test("a planned failure shows in the timeline and the findings", async ({ page }) => {
  await fresh(page, "load-balanced");
  await page.locator("[data-node=api-1]").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Plan a failure of API server" }).click();
  await page.getByText("Traffic and failures").click();
  await expect(page.getByLabel("API server fails at (seconds)")).toHaveValue("2");
  // Down until 6 s: the load balancer checks every 2 s, so it notices at 4 s.
  await page.getByLabel("API server recovers at (seconds)").fill("6");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await page.getByRole("button", { name: "Skip to the end" }).click();
  await expect(page.locator(".event-list")).toContainText("finds API server down and stops sending to it");
  await expect(page.getByText("API server failed from 2 s to 6 s")).toBeVisible();
});

test("a challenge: the starter fails its checks, a cache passes, and progress shows on the roadmap", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/practice/architecture/challenges/cache-read-heavy");
  await page.getByRole("button", { name: "Check my design" }).click();
  await expect(page.getByRole("heading", { name: "2 of 4 requirements met" })).toBeFocused();
  // Fixed settings can't be changed.
  await page.locator("[data-node=sql-1]").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Queries at once")).toBeDisabled();
  await add(page, "Cache");
  await page.locator("[data-node=api-1]").focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Connect to").selectOption("cache-1");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Check my design" }).click();
  await expect(page.getByRole("heading", { name: "Every requirement is met" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Other valid designs, and their trade-offs" })).toBeVisible();
  // The coach answers even without the AI service: the reviewed hint.
  await page.getByLabel("Your question").fill("What should I try next?");
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.locator(".coach-reply")).toBeVisible();
  // The working design is kept.
  await page.reload();
  await expect(page.locator("[data-node=cache-1]")).toHaveCount(1);
  await page.goto("/learn/system-design#unit-storage-caching");
  await expect(page.locator("#unit-storage-caching .status-chip")).toContainText(["Completed"]);
});

test("a challenge keeps an edit made just before the page is left", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/practice/architecture/challenges/cache-read-heavy");
  await expect(nodes(page)).toHaveCount(3);
  await add(page, "Cache");
  await expect(nodes(page)).toHaveCount(4);
  // Leave at once, well inside the autosave's 400 ms wait.
  await page.reload();
  await expect(nodes(page)).toHaveCount(4);
  await add(page, "Message queue");
  await page.goto("/learn/system-design");
  await page.goBack();
  await expect(page.locator("[data-node=queue-1]")).toHaveCount(1);
});

// Production crashed here with "Cannot read properties of undefined (reading 'busyArea')": the rerun's first render
// paired the new design (with its database selected) with the first run's fold, which had no database.
test("a challenge can be run again after adding a component, with that component selected", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/practice/architecture/challenges/simple-web-app");
  const connect = async (from: string, to: string) => {
    await page.locator(`[data-node=${from}]`).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("Connect to").selectOption(to);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
  };
  await add(page, "API server");
  await connect("client-1", "api-1");
  await page.getByRole("button", { name: "Run simulation" }).click();
  await page.getByRole("button", { name: "Skip to the end" }).click();
  await add(page, "SQL database");
  await connect("api-1", "sql-1");
  await page.locator("[data-node=sql-1]").focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Run again" }).click();
  await expect(page.locator(".clock")).toContainText("event 0 of");
  await page.getByRole("button", { name: "Skip to the end" }).click();
  await expect(page.getByText("This view hit an error")).toHaveCount(0);
  await expect(page.locator(".arch-inspector .live-state")).toContainText("Busy so far");
});

test("a challenge says so when this browser refuses to save the design, and keeps the design on screen", async ({ page }) => {
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "kitab.architecture.progress.v1") throw new DOMException("full", "QuotaExceededError");
      return set.call(this, key, value);
    };
  });
  await page.goto("/practice/architecture/challenges/simple-web-app");
  await add(page, "API server");
  await expect(page.getByRole("alert").filter({ hasText: "couldn't be saved in this browser" })).toBeVisible();
  await expect(page.locator("[data-node=api-1]")).toHaveCount(1);
});

test("a challenge shows its fixed settings on a component added in the editor, as its runs use them", async ({ page }) => {
  await page.goto("/practice/architecture/challenges/scale-behind-lb");
  await add(page, "SQL database");
  // The SQL database the challenge fixes at 40 queries at once; the editor's default is 10.
  await expect(page.getByLabel("Queries at once")).toHaveValue("40");
  await expect(page.getByLabel("Queries at once")).toBeDisabled();
});

test("a lesson experiment runs in the simulator and counts the lesson as done", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.goto("/learn/system-design/fundamentals");
  await expect(page.getByRole("heading", { name: "Clients, servers and databases", level: 1 })).toBeVisible();
  await page.getByLabel("Requests per second").selectOption("250");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/What to notice:/)).toBeVisible();
  await expect(page.locator(".finding").filter({ hasText: "API server is a bottleneck" })).toBeVisible();
  await page.goto("/learn/system-design");
  await expect(page.getByRole("link", { name: /Clients, servers and databases/ }).locator(".status-chip")).toHaveText("Completed");
});

// A rerun with fewer events (lower rate) or other components (another design) than the run being played back
// once crashed the lesson: playback paired the new run with the old run's cursor and fold.
test("a lesson experiment can be run again at a lower rate or with another design after playing to the end", async ({ page }) => {
  for (const [lesson, field, first, then] of [
    ["fundamentals", "Requests per second", "250", "20"],
    ["storage-caching", "Design", "uniform", "none"],
  ]) {
    await page.goto(`/learn/system-design/${lesson}`);
    await page.getByLabel(field).selectOption(first);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await page.getByRole("button", { name: "Skip to the end" }).click();
    await page.getByLabel(field).selectOption(then);
    await page.getByRole("button", { name: "Run again" }).click();
    await expect(page.locator(".clock")).toContainText("event 0 of");
    await expect(page.getByText("This view hit an error")).toHaveCount(0);
    await page.getByRole("button", { name: "Step forward one event" }).click();
    await expect(page.locator(".clock")).toContainText("event 1 of");
    await page.getByRole("button", { name: "Skip to the end" }).click();
    await expect(page.getByText(/What to notice:/)).toBeVisible();
  }
});

test("the track appears with the others, and the Network Playground is unchanged", async ({ page }) => {
  await page.goto("/learn/system-design");
  await expect(page.getByRole("heading", { name: "System design & architecture", level: 1 })).toBeVisible();
  await expect(page.locator(".path-stages > li")).toHaveCount(systemDesignPath.length);
  await page.goto("/practice?track=system-design");
  // Every design challenge and every lab; the six original challenges are still there.
  await expect(page.locator(".mission-card")).toHaveCount(systemDesignPath.flatMap((s) => s.practise).length);
  await expect(page.locator(".mission-card .kind-design")).toHaveCount(6);
  await page.goto("/practice/network");
  await expect(page.getByRole("heading", { name: /Playground/, level: 1 })).toBeVisible();
  await expect(page.locator(".arch-workspace")).toHaveCount(0);
});

test("no horizontal scrolling on the playground, a challenge or a lesson", async ({ page }) => {
  await fresh(page, "load-balanced");
  await page.getByRole("button", { name: "Run simulation" }).click();
  for (const path of [null, "/practice/architecture/challenges/url-shortener", "/learn/system-design/scalability"]) {
    if (path) await page.goto(path);
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll, path ?? "playground").toBeLessThanOrEqual(client);
  }
});
