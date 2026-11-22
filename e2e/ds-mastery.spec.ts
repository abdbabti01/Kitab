import { expect, test, type Page } from "@playwright/test";
import { buildDataStructureSimulation } from "../src/visual-engine/data-structures/model.ts";

// Data Structures Mastery: growth, memory view, language switching, new operations, choosing, and lessons.

const title = (page: Page) => page.locator("#step-title");
const next = (page: Page) => page.getByRole("button", { name: "Next step" });
const guide = (page: Page) => page.locator(".dsg");
async function toEnd(page: Page) {
  const slider = page.getByRole("slider", { name: "Step" });
  await slider.fill((await slider.getAttribute("max"))!);
}
const storage = (page: Page) => page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([k]) => k !== "kitab.code-language.v1")));

test("a full array grows step by step; the memory view follows; Previous restores the old block exactly", async ({ page }) => {
  const sim = buildDataStructureSimulation({ kind: "array", operation: "insert", value: 7, index: 4, values: [8, 3, 12, 1], capacity: 4 });
  await page.goto("/practice/structures?structure=array&op=insert&value=7&index=4&values=8,3,12,1&capacity=4");
  await expect(page.getByLabel("Capacity (slots)")).toHaveValue("4");
  await expect(page.locator(".ds-spare")).toHaveCount(0);
  await next(page).click();
  await expect(title(page)).toHaveText("The block is full");
  await expect(guide(page).locator(".dsg-changes")).toContainText("Nothing in memory changed");
  await next(page).click();
  await expect(title(page)).toHaveText(sim.frames[2].title);
  await expect(page.locator(".ds-old-block")).toContainText("the array still refers to it");
  await expect(page.locator(".ds-spare li")).toHaveCount(8);
  await next(page).click();
  await expect(guide(page).locator(".dsg-changes")).toContainText("[0] at 0x2000: spare → 8");
  await expect(guide(page).locator("tr.is-changed")).toHaveCount(1);
  const switchAt = sim.frames.findIndex((f) => f.action === "WRITE REFERENCE");
  await page.getByRole("slider", { name: "Step" }).fill(String(switchAt));
  await expect(page.locator(".ds-old-block")).toHaveClass(/is-unreachable/);
  await expect(guide(page).locator(".dsg-changes")).toContainText("array (reference to its block): 0x1000 → 0x2000");
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(page.locator(".ds-old-block")).not.toHaveClass(/is-unreachable/);
  await toEnd(page);
  await expect(page.locator(".sp-result")).toContainText("after growing the capacity to 8");
  await expect(page.locator(".ds-array > li")).toHaveCount(5);
  await expect(page.locator(".ds-spare li")).toHaveCount(3);
  // Chaining keeps the grown capacity.
  await page.getByRole("button", { name: "Start the next operation from this result" }).click();
  await expect(page.getByLabel("Capacity (slots)")).toHaveValue("8");
  await expect(page).toHaveURL(/capacity=8/);
});

test("switching tab and language never restarts the run, and the language is remembered", async ({ page }) => {
  await page.goto("/practice/structures?structure=linked-list&op=delete&value=12&index=0");
  for (let i = 0; i < 3; i++) await next(page).click();
  const step = await title(page).textContent();
  await guide(page).getByRole("tab", { name: "Code" }).click();
  await guide(page).getByRole("button", { name: "Python" }).click();
  await expect(guide(page).locator(".dsg-code").first()).toContainText("deque");
  await expect(guide(page).getByText("Teaching implementation")).toBeVisible();
  await expect(title(page)).toHaveText(step!);
  await page.reload();
  await expect(title(page)).toHaveText(buildDataStructureSimulation({ kind: "linked-list", operation: "delete", value: 12, index: 0 }).frames[0].title);
  await guide(page).getByRole("tab", { name: "Code" }).click();
  await expect(guide(page).getByRole("button", { name: "Python" })).toHaveAttribute("aria-pressed", "true");
  // Runtime facts follow the language too.
  await guide(page).getByRole("tab", { name: "Memory" }).click();
  await expect(guide(page)).toContainText("What Python actually stores");
});

test("a corrupted or unknown language preference falls back to C# without being erased", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kitab.code-language.v1", "{not json"));
  await page.goto("/practice/structures?structure=stack&op=push&value=7&index=0");
  await guide(page).getByRole("tab", { name: "Code" }).click();
  await expect(guide(page).getByRole("button", { name: "C#" })).toHaveAttribute("aria-pressed", "true");
  await expect(guide(page).locator(".dsg-code").first()).toContainText("new Stack<string>()");
  expect(await page.evaluate(() => localStorage.getItem("kitab.code-language.v1"))).toBe("{not json");
});

test("the memory view highlights exactly the pointer write of a linked-list delete", async ({ page }) => {
  const sim = buildDataStructureSimulation({ kind: "linked-list", operation: "delete", value: 12, index: 0 });
  await page.goto("/practice/structures?structure=linked-list&op=delete&value=12&index=0");
  await page.getByRole("slider", { name: "Step" }).fill(String(sim.frames.findIndex((f) => f.action === "WRITE POINTER")));
  await expect(guide(page).locator("tr.is-changed")).toHaveCount(2);
  await expect(guide(page).locator(".dsg-changes")).toContainText("next: 0x1070 → 0x10A0");
});

test("BST delete and graph DFS run from the controls with the engine's own results", async ({ page }) => {
  await page.goto("/practice/structures");
  await page.getByRole("button", { name: "Binary search tree", exact: true }).click();
  await page.getByRole("combobox", { name: /^Operation/ }).selectOption("delete");
  await page.getByLabel("Value", { exact: true }).fill("8");
  await expect(page).toHaveURL(/op=delete&value=8/);
  await toEnd(page);
  await expect(page.locator(".sp-result")).toContainText("Removed 8 (two children: replaced by successor 10)");
  await expect(page.locator(".ds-tree-node")).toHaveCount(6);
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  await page.getByRole("combobox", { name: /^Operation/ }).selectOption("dfs");
  await page.getByLabel("Target vertex").fill("12");
  await toEnd(page);
  await expect(page.locator(".sp-result")).toContainText("1 → 3 → 6 → 10 → 8 → 12");
  await expect(page.locator(".ds-graph")).toContainText("DFS stack (bottom → top)");
});

test("choosing a structure: feedback names the reason and other justified choices; nothing is recorded", async ({ page }) => {
  await page.goto("/practice/structures?structure=recursion&fn=factorial&n=4&base=1&limit=8");
  const before = await storage(page);
  await guide(page).getByRole("tab", { name: "Choose" }).click();
  await expect(guide(page).getByLabel("Scenario")).toHaveValue("folders");
  await expect(guide(page).getByRole("button", { name: "Check my choice" })).toBeDisabled();
  await guide(page).getByLabel("Recursive function").check();
  await guide(page).getByRole("button", { name: "Check my choice" }).click();
  await expect(guide(page).getByRole("status")).toContainText("Workable, with a cost");
  await expect(guide(page).getByRole("status")).toContainText("Also a good fit: Loop with an explicit stack");
  expect(await storage(page)).toEqual(before);
});

test("guide tabs work from the keyboard and reference only the rendered panel", async ({ page }) => {
  await page.goto("/practice/structures?structure=queue&op=dequeue&value=0&index=0");
  const memory = guide(page).getByRole("tab", { name: "Memory" });
  await memory.focus();
  for (const name of ["What & why", "Code", "Cost", "Choose", "Memory"]) {
    await page.keyboard.press("ArrowRight");
    const tab = guide(page).getByRole("tab", { name, exact: true });
    await expect(tab).toBeFocused();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(guide(page).getByRole("tabpanel")).toHaveAttribute("aria-labelledby", (await tab.getAttribute("id"))!);
  }
  await page.keyboard.press("End");
  await expect(guide(page).getByRole("tab", { name: "Choose" })).toBeFocused();
});

test("a data-structures lesson goes deeper without recording anything, and switches between its structures", async ({ page }) => {
  await page.goto("/concepts/trees");
  const before = await storage(page);
  await expect(page.getByRole("heading", { name: "Go deeper" })).toBeVisible();
  await expect(guide(page)).toContainText("What is it?");
  await page.getByRole("group", { name: "Structure" }).getByRole("button", { name: "Graphs" }).click();
  await expect(guide(page).getByRole("heading", { name: "Graphs" })).toBeVisible();
  await guide(page).getByRole("tab", { name: "Cost" }).click();
  await expect(guide(page)).toContainText("O(V + E)");
  expect(await storage(page)).toEqual(before);
  // Lessons outside data structures have no guide.
  await page.goto("/concepts/database-indexes");
  await expect(page.getByRole("heading", { name: "Go deeper" })).toHaveCount(0);
});

test("no horizontal page overflow with the guide open on any tab", async ({ page }) => {
  await page.goto("/practice/structures?structure=hash-table&op=insert&value=22&index=0");
  for (const name of ["Memory", "What & why", "Code", "Cost", "Choose"]) {
    await guide(page).getByRole("tab", { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});

test("before a guided prediction, the guide reveals nothing about the run", async ({ page }) => {
  await page.goto("/practice/structures?experiment=ds-array-insert");
  await expect(page.getByRole("button", { name: "Test my prediction" })).toBeVisible();
  await expect(guide(page)).toContainText("The memory model");
  await expect(guide(page)).not.toContainText("This step in memory");
  await guide(page).getByRole("tab", { name: "Cost" }).click();
  await expect(guide(page)).not.toContainText("This run, counted by the engine");
});
