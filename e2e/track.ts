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
/**
 * Presses Send in the form and waits for what Send does to the page: the diagram glides up into view (a smooth
 * scroll) when the form is beside or below it. A click made while the page is still gliding can land on whatever
 * has moved under the pointer (seen in CI), so wait until the page has stopped scrolling with the diagram in view.
 */
export async function send(page: Page) {
  await page.getByRole("button", { name: "Send request", exact: true }).click();
  await page.waitForFunction(
    () =>
      new Promise<boolean>((done) => {
        const top = () => document.querySelector(".journey-stage")!.getBoundingClientRect().top;
        const at = [scrollY, top()];
        // Still for three frames, with the top of the diagram on screen.
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => done(scrollY === at[0] && top() === at[1] && top() >= -1 && top() < innerHeight))));
      }),
    undefined,
    { polling: 50 },
  );
}
