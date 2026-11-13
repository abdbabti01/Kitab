import type { Page } from "@playwright/test";

/** Moves the Journey to its last event, which shows the whole run in the track (as a learner who has watched it). */
export async function toLast(page: Page) {
  const last = page.getByRole("button", { name: "Last event", exact: true });
  if (await last.isEnabled()) await last.click();
}
/** Opens the track's list of every step shown so far (it stays open). */
export async function openSteps(page: Page) {
  const list = page.locator(".track-steps");
  if (!(await list.evaluate((d) => (d as HTMLDetailsElement).open))) await list.locator("summary").click();
  // The list is built when the details element reports that it opened (its toggle event), a moment after the click:
  // wait for it, or a slow machine reads an empty list (seen in CI).
  await list.locator(".steps-list").waitFor();
}
/** Plays to the end and opens the full exchange table under the track. */
export async function openExchange(page: Page) {
  await toLast(page);
  const open = page.getByRole("button", { name: "Open full exchange" });
  if (await open.isVisible()) await open.click();
}
