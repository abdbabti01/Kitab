import { expect, test } from "@playwright/test";

// Recovery paths that must work in production, not only in the happy path.

// After a deploy, an open tab's lazy page chunks no longer exist and the server answers their old names with the
// app's HTML. Retrying the import can't help; the learner is told to reload, and the site header stays usable.
test("a page chunk missing after a deploy offers a reload instead of a dead end", async ({ page }) => {
  await page.route(/ChallengePage(-[\w-]+)?\.(tsx|js)/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Kitab</title>" }));
  await page.goto("/practice/architecture/challenges/simple-web-app");
  await expect(page.getByRole("heading", { name: "Kitab has been updated" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reload Kitab" })).toBeVisible();
  await expect(page.getByText("This view hit an error")).toHaveCount(0);
  await expect(page.locator("header").first()).toBeVisible();
  await page.unroute(/ChallengePage(-[\w-]+)?\.(tsx|js)/);
  await page.getByRole("button", { name: "Reload Kitab" }).click();
  await expect(page.getByRole("heading", { name: "Design a simple web application" })).toBeVisible();
});
