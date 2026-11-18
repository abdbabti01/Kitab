import { expect, test, type Page } from "@playwright/test";
import { runSetup } from "../src/architecture/cycles.ts";
import { buildDataStructureSimulation } from "../src/visual-engine/data-structures/model.ts";

// Predict → run → observe → explain → change one thing, in all three subjects: the answer stays hidden until a
// prediction is committed, the result shown is the real engine's, and the attempt resumes where it was left.

const fresh = async (page: Page, path: string, seed: Record<string, string> = {}) => {
  await page.goto("/");
  await page.evaluate((s) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, seed);
  await page.goto(path);
};
const noSideScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const panel = (page: Page) => page.locator(".cycle");
async function predict(page: Page, choice: string | RegExp) {
  await page.getByRole("radio", { name: choice }).check();
  await page.getByRole("button", { name: "Test my prediction" }).click();
}
async function reason(page: Page, text: string | RegExp) {
  await page.getByRole("radio", { name: text }).check();
  await page.getByRole("button", { name: "Check my reasoning" }).click();
}

test("System Design: predict overload, read the real run, explain it, then test a longer queue", async ({ page }) => {
  const at200 = runSetup({ lesson: "fundamentals", variant: "base", rate: 200 }).summary;
  const queue = runSetup({ lesson: "fundamentals", variant: "base", rate: 200, change: "queue-500" }).summary;
  await fresh(page, "/learn/system-design/fundamentals");
  await expect(page.getByRole("button", { name: "Predict, then test" })).toHaveAttribute("aria-pressed", "true");
  // Before the prediction: the design and its settings, but no run, no result and no findings.
  await expect(panel(page)).toContainText("Starting configuration");
  await expect(page.locator(".clock")).toHaveCount(0);
  await expect(page.locator(".finding")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(String(at200.failed));
  await predict(page, "Slower answers, and some requests fail.");
  await expect(page.getByRole("heading", { name: "Your prediction matched the run." })).toBeFocused();
  // The evidence is the simulator's own numbers, and the run view plays that same run.
  await expect(panel(page).locator(".cycle-result .cycle-evidence").first()).toContainText(`${at200.failed} (${at200.failed} refused: queue full)`);
  await expect(page.locator(".clock")).toBeVisible();
  await expect(page.locator(".finding").filter({ hasText: "API server is a bottleneck" })).toBeVisible();
  await reason(page, "The network got slower with more traffic.");
  await expect(page.getByRole("heading", { name: "The evidence points to a different reason." })).toBeVisible();
  await expect(panel(page)).toContainText("every network hop takes a fixed time");
  await expect(panel(page)).toContainText("Hint for next time");
  // Change one thing: a longer queue. The run says it made things worse.
  await page.getByRole("radio", { name: /A longer queue/ }).check();
  await page.getByRole("button", { name: "Set up this change" }).click();
  await expect(panel(page)).toContainText("What the first run recorded");
  await predict(page, "Fewer fail");
  await expect(page.getByRole("heading", { name: "The run showed something different." })).toBeVisible();
  await expect(panel(page)).toContainText("A queue lets requests wait");
  const row = panel(page).getByRole("row", { name: /Failed requests/ });
  await expect(row).toContainText(String(at200.failed));
  await expect(row).toContainText(String(queue.failed));
  await reason(page, "It let more requests wait instead of adding capacity, so they waited longer than clients would and timed out.");
  await page.getByRole("button", { name: "Finish the experiment" }).click();
  await expect(page.getByRole("heading", { name: "Experiment complete" })).toBeVisible();
  // Leave and come back: the same place, and the lesson counts as done as an experiment run always has.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Experiment complete" })).toBeVisible();
  await expect(panel(page)).toContainText("Welcome back");
  await page.goto("/learn/system-design");
  await expect(page.getByRole("link", { name: /Clients, servers and databases/ }).locator(".status-chip")).toHaveText("Completed");
});

test("System Design: free exploration is one switch away and unchanged", async ({ page }) => {
  await fresh(page, "/learn/system-design/scalability");
  await page.getByRole("button", { name: "Explore freely" }).click();
  await expect(page.locator(".cycle")).toHaveCount(0);
  await page.getByLabel("Requests per second").selectOption("700");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByText(/What to notice:/)).toBeVisible();
  // The lesson without a guided experiment keeps the free one alone.
  await page.goto("/learn/system-design/design-projects");
  await expect(page.getByRole("button", { name: "Explore freely" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible();
});

test("Data Structures: the answer stays hidden until committed; evidence jumps to the real step; restart keeps other progress", async ({ page }) => {
  const frames = buildDataStructureSimulation({ kind: "array", operation: "insert", value: 9, index: 2, values: [4, 7, 12, 18] }).frames;
  const other = JSON.stringify({ version: 1, missions: {} });
  await fresh(page, "/practice/structures?experiment=ds-array-insert", { "kitab.progress.v1": other });
  await expect(page.getByRole("region", { name: "Mode" })).toContainText("Guided experiment");
  // Locked: the starting state only. No playback, no step count, no result.
  await expect(page.getByRole("button", { name: "Next step" })).toHaveCount(0);
  await expect(page.locator(".sp-result")).toHaveCount(0);
  await expect(page.locator("#step-title")).toHaveText(frames[0].title);
  await expect(page.locator("main")).not.toContainText(`of ${frames.length}`);
  await predict(page, "4, 9, 7, 12, 18");
  await expect(page.getByRole("heading", { name: "The run showed something different." })).toBeFocused();
  await expect(panel(page)).toContainText("Index 2 is the third slot");
  await expect(panel(page)).toContainText("Values after4, 7, 9, 12, 18");
  // "Show in the run" moves the scene to the step that recorded the shift.
  await panel(page).locator(".cycle-evidence div", { hasText: "Values moved" }).getByRole("button", { name: "Show in the run" }).click();
  await expect(page.locator("#step-title")).toHaveText(frames[1].title);
  await reason(page, "Each value from index 2 onward moved one slot right, starting from the end, and then 9 was written into the free slot.");
  await expect(page.getByRole("heading", { name: "That is the reason the evidence supports." })).toBeVisible();
  await page.getByRole("radio", { name: /A linked list instead/ }).check();
  await page.getByRole("button", { name: "Set up this change" }).click();
  await expect(page.locator(".sp-op")).toContainText("Linked list");
  await predict(page, "Fewer");
  await expect(page.getByRole("heading", { name: "Your prediction matched the run." })).toBeVisible();
  await expect(panel(page).getByRole("row", { name: /Values moved/ })).toContainText("20");
  await reason(page, "A linked list moves no values: it changes two references to fit the new node in.");
  await page.getByRole("button", { name: "Start again with a new prediction" }).click();
  await expect(page.getByRole("button", { name: "Test my prediction" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("kitab.progress.v1"))).toBe(other);
  // Leaving returns to free exploration with the experiment's starting setup.
  await page.getByRole("button", { name: "Leave and explore freely" }).click();
  await expect(page.getByRole("heading", { name: "Experiment", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next step" })).toBeEnabled();
});

test("Data Structures: keyboard only, from the unit's lesson link back to the lesson", async ({ page }) => {
  await fresh(page, "/concepts/recursion");
  await page.locator(".path-playground", { hasText: "Predict, then test" }).getByRole("link", { name: "Which call returns first?" }).click();
  await expect(page).toHaveURL(/experiment=ds-recursion-order&from=%2Fconcepts%2Frecursion/);
  const first = page.getByRole("radio", { name: "factorial(4): it was called first" });
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: "factorial(1): the base case" })).toBeChecked();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Your prediction matched the run." })).toBeFocused();
  await expect(panel(page)).toContainText("returned 24 to main()");
  await page.getByRole("link", { name: "Back to your lesson" }).click();
  await expect(page).toHaveURL(/\/concepts\/recursion$/);
});

test("Networking: the first frame goes to the gateway, shown on the real Journey; the learner's network is untouched", async ({ page }) => {
  const own = JSON.stringify({ name: "My own network", devices: [], links: [] });
  await fresh(page, "/practice/network?experiment=net-gateway-frame", { "kitab.network.workspace.v1": own });
  await expect(panel(page)).toContainText("192.168.1.10/24, gateway 192.168.1.1");
  // Send stays closed until the prediction is committed.
  await expect(page.getByRole("button", { name: /Send request and follow it/ }).first()).toBeDisabled();
  await predict(page, "The office server's MAC address");
  await expect(page.getByRole("heading", { name: "The run showed something different." })).toBeVisible();
  await expect(panel(page)).toContainText("The PC can only send a frame to a device on its own link");
  await expect(panel(page)).toContainText("(Router)");
  await expect(panel(page)).toContainText("192.168.2.20");
  await reason(page, /The server is outside the PC's subnet/);
  await page.getByRole("radio", { name: /Remove the PC's default gateway/ }).check();
  await page.getByRole("button", { name: "Set up this change" }).click();
  await predict(page, "The PC can't send it: it has no route to the server");
  await expect(page.getByRole("heading", { name: "Your prediction matched the run." })).toBeVisible();
  await expect(panel(page)).toContainText("Stopped at Your PC");
  expect(await page.evaluate(() => localStorage.getItem("kitab.network.workspace.v1"))).toBe(own);
  await page.getByRole("button", { name: "Leave and explore freely" }).click();
  await expect(page).toHaveURL(/\/practice\/network$/);
  await expect(page.locator(".cycle")).toHaveCount(0);
});

test("Networking: the guided experiments are listed in the Playground and from the unit", async ({ page }) => {
  await fresh(page, "/practice/network");
  await page.locator(".guided-list").getByRole("link", { name: "What does your PC send first?" }).click();
  await expect(page).toHaveURL(/experiment=net-arp-first/);
  await predict(page, /An ARP request/);
  await expect(page.getByRole("heading", { name: "Your prediction matched the run." })).toBeVisible();
  await reason(page, /knew the server's IP address but not its MAC/);
  await page.getByRole("radio", { name: /Send the same ping again/ }).check();
  await page.getByRole("button", { name: "Set up this change" }).click();
  await predict(page, "Fewer");
  await expect(panel(page).getByRole("row", { name: /ARP requests from the PC/ })).toContainText("10");
});

test("no horizontal scrolling in any guided experiment", async ({ page }) => {
  for (const path of ["/learn/system-design/storage-caching", "/practice/structures?experiment=ds-bst-shape", "/practice/network?experiment=net-dhcp-order"]) {
    await fresh(page, path);
    await expect(page.getByRole("button", { name: "Test my prediction" })).toBeVisible();
    expect(await noSideScroll(page), path).toBe(true);
    await page.locator(".cycle-option").first().click();
    await page.getByRole("button", { name: "Test my prediction" }).click();
    await expect(page.getByRole("button", { name: "Check my reasoning" })).toBeVisible();
    expect(await noSideScroll(page), `${path} after the run`).toBe(true);
  }
});
