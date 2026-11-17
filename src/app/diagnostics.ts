// What Kitab records about an unexpected failure: enough to match a report to the code (build, page, area, kind,
// message), nothing the learner typed or built. Logged to the console only; nothing is sent anywhere.

/** The commit this page was built from (set by vite.config.ts). */
export const BUILD: string = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_KITAB_BUILD ?? "dev";

/**
 * A lazy page chunk that no longer exists: Kitab was deployed while this tab was open, and the server answered the
 * old file name with the app's HTML. Only loading the new version helps; retrying the same import never does.
 */
export function isStaleChunk(error: unknown) {
  return error instanceof Error && /dynamically imported module|Importing a module script failed|Unable to preload CSS|module script.*MIME type/i.test(error.message);
}

export function diagnostics(error: Error, area: string, page = typeof location === "undefined" ? "" : location.pathname) {
  return { build: BUILD, page, area, kind: isStaleChunk(error) ? "stale-chunk" : "render", message: error.message.slice(0, 300) };
}
