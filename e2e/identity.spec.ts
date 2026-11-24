import { expect, test, type Page } from "@playwright/test";
import { labById } from "../src/lab/catalog.ts";
import type { CodeLab } from "../src/lab/model.ts";

// The Identity, Authentication & Security track end to end: roadmap, lesson, Playground, guided experiment,
// challenge, real-crypto lab, Token Inspector, Authorization Playground, resume after reload, and the phone layout.

/** On narrow screens the run's views are tabs; on wide ones every view is visible. */
async function view(page: Page, name: "Sequence" | "Message" | "State") {
  const tab = page.getByRole("tab", { name });
  if (await tab.isVisible()) await tab.click();
}
const next = (page: Page) => page.getByRole("button", { name: "Next step" });

test("the track is discoverable from Home and the Learn tabs, and opens on its first unit", async ({ page }) => {
  await page.goto("/");
  const card = page.locator(".subject-card.is-identity");
  await expect(card.getByRole("heading")).toHaveText("Identity, authentication & security");
  await card.getByRole("link", { name: /Explore Identity/ }).click();
  await expect(page).toHaveURL(/\/learn\/identity$/);
  await expect(page.getByRole("navigation", { name: "Tracks and Library" }).getByRole("link", { name: "Identity & security" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".path-stages > li")).toHaveCount(12);
  await page.getByRole("link", { name: /Start: Identity fundamentals/ }).click();
  await expect(page.locator("#main h1")).toHaveText("Identity fundamentals");
});

test("a lesson: answer a check, see progress saved, and the walkthrough opens the Playground", async ({ page }) => {
  await page.goto("/learn/identity/fundamentals");
  const check = page.locator("#authn-authz form.concept-check");
  await check.getByLabel(/Authorization: the API didn't check/).check();
  await check.getByRole("button", { name: "Check my answer" }).click();
  await expect(check.getByRole("status")).toContainText("Right.");
  await expect(page.getByText("1 of 4 checks answered right").first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("1 of 4 checks answered right").first()).toBeVisible();
  await expect(page.getByRole("list", { name: /every message/ }).locator("li")).toHaveCount(24);
  await page.getByRole("link", { name: /open it in the Playground/ }).click();
  await expect(page).toHaveURL(/\/practice\/identity\?scenario=oidc-login.*from=/);
  await expect(page.getByRole("link", { name: /Back to your lesson/ })).toBeVisible();
});

test("the Playground: step through OIDC with PKCE, inspect the token exchange, break the verifier and repair it", async ({ page }) => {
  await page.goto("/practice/identity?scenario=oidc-login");
  await expect(page.locator("#main h1")).toHaveText("Identity Playground");
  await expect(page.getByText("Step 1 of 24")).toBeVisible();
  // Later steps aren't shown before they're reached.
  await expect(page.getByRole("list", { name: "Messages in this run" }).locator("li")).toHaveCount(1);
  for (let i = 0; i < 4; i++) await next(page).click();
  await expect(page.getByText("Step 5 of 24")).toBeVisible();
  await view(page, "Message");
  await expect(page.locator(".id-inspector h3")).toHaveText("GET /authorize");
  await expect(page.locator(".id-inspector")).toContainText("code_challenge_method");
  // Jump to the end and select the token request.
  await page.getByRole("button", { name: "Last step" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Completed." })).toBeVisible();
  await view(page, "Sequence");
  await page.getByRole("button", { name: /POST \/token \(code exchange\)/ }).click();
  await view(page, "Message");
  await expect(page.locator(".id-inspector")).toContainText("back channel");
  await expect(page.locator(".id-inspector")).toContainText("code_verifier");
  // Break it: the identity provider's real S256 check catches the wrong verifier.
  await page.getByLabel("Break something").selectOption("verifier");
  await page.getByRole("button", { name: "Last step" }).click();
  await expect(page.locator(".id-outcome")).toContainText("SHA-256(code_verifier) equals the stored code_challenge");
  await view(page, "Sequence");
  await expect(page.getByRole("button", { name: /Failed check: SHA-256/ })).toBeVisible();
  // Repair: the address describes the setup, and the flow completes again.
  await expect(page).toHaveURL(/fault=verifier/);
  await page.getByLabel("Break something").selectOption("none");
  await page.getByRole("button", { name: "Last step" }).click();
  await expect(page.locator(".id-outcome")).toContainText("Completed.");
});

test("single sign-on: after logging out of the Portal only, the IdP and Finance sessions remain", async ({ page }) => {
  await page.goto("/practice/identity?scenario=sso&after=logout-a");
  await page.getByRole("button", { name: "Last step" }).click();
  await view(page, "State");
  const state = page.locator(".id-state");
  await expect(state).toContainText("IdP session s-9f2e");
  await expect(state).toContainText("Finance session fb-27");
  await expect(state).toContainText("Portal session pa-12");
});

test("a guided experiment: predict, run, explain from the evidence", async ({ page }) => {
  await page.goto("/practice/identity?experiment=id-state");
  await expect(page.getByText("Commit a prediction to run the scenario.")).toBeVisible();
  await page.getByLabel("The client stops before redeeming the code.").check();
  await page.getByRole("button", { name: /prediction/i }).first().click();
  await expect(page.locator(".cycle")).toContainText("Your prediction matched the run", { timeout: 10_000 });
  await page.getByLabel(/state must equal the value/).check();
  await page.getByRole("button", { name: /reason|explain/i }).first().click();
  await expect(page.locator(".cycle")).toContainText("Your reason matches the evidence");
});

test("a challenge: diagnose an ID token failure from the trace, and resume after a reload", async ({ page }) => {
  await page.goto("/practice/identity/challenges/validate-id-token");
  await page.getByRole("button", { name: /Validates the ID token/ }).click();
  await expect(page.locator(".id-inspector h3")).toHaveText("Validates the ID token");
  await page.getByLabel("The nonce didn't match this sign-in request.").check();
  await page.getByRole("button", { name: "Submit my diagnosis" }).click();
  await expect(page.locator(".lab-feedback")).toContainText("Correct: the model agrees.");
  await expect(page.locator(".status-chip").first()).toHaveText("Completed");
  await page.reload();
  await expect(page.locator(".status-chip").first()).toHaveText("Completed");
  // A wrong cause in another version is refused with a reason.
  await page.getByRole("button", { name: "Try another version" }).or(page.getByRole("button", { name: "Switch to another version" })).first().click();
  await page.getByRole("button", { name: /Validates the ID token/ }).click();
  await page.getByLabel("The nonce didn't match this sign-in request.").check();
  await page.getByRole("button", { name: "Submit my diagnosis" }).click();
  await expect(page.locator(".lab-feedback")).toContainText("Not yet.");
});

for (const [id, tests] of [["pkce", 4], ["jwks-verify", 6], ["challenge-response", 4]] as const) {
  test(`a real-crypto lab (${id}) runs in the browser sandbox: the starter fails its tests, the solution passes`, async ({ page }) => {
    const lab = labById(id) as CodeLab;
    const status = page.locator(".eng-results [role=status]").first();
    await page.goto(`/lab/identity/${id}`);
    await page.getByRole("button", { name: "Check solution" }).click();
    await expect(status).toHaveText(new RegExp(`^\\d of ${tests} tests passed\\.$`), { timeout: 20_000 });
    await page.getByRole("textbox", { name: /^Code editor/ }).fill(lab.solution);
    await page.getByRole("button", { name: "Check solution" }).click();
    await expect(status).toHaveText(`All ${tests} tests passed.`, { timeout: 20_000 });
  });
}

test("the Token Inspector verifies for real, rejects a tampered token, and never renders claims as HTML", async ({ page }) => {
  await page.goto("/practice/identity/tokens");
  await expect(page.locator(".id-outcome")).toContainText("Valid: accept it.", { timeout: 15_000 });
  await page.getByRole("button", { name: /Payload edited after signing/ }).click();
  await expect(page.locator(".id-outcome")).toContainText("Stopped at: Signature verifies");
  await page.getByRole("button", { name: /Claims containing markup/ }).click();
  await expect(page.locator(".ti-json").nth(1)).toContainText('<img src=x onerror=');
  expect(await page.locator("main img").count()).toBe(0);
  // Editing a claim and re-signing with the issuer's key: the signature holds, the claim check fails.
  await page.getByRole("button", { name: /Valid access token/ }).click();
  const draft = page.getByLabel("Payload JSON");
  await draft.fill((await draft.inputValue()).replace("https://api.kitab.example", "https://hr.kitab.example"));
  await page.getByRole("button", { name: "Sign again with kitab-demo-1" }).click();
  await expect(page.locator(".id-outcome")).toContainText("Stopped at: aud contains this API");
});

test("the Authorization Playground: a cross-tenant admin is let through until tenant isolation is on", async ({ page }) => {
  await page.goto("/practice/identity/authorization");
  await page.getByLabel("Caller", { exact: true }).selectOption("dave");
  await page.getByLabel("Order", { exact: true }).selectOption("123");
  await expect(page.locator(".az-decision")).toContainText("Unauthorized access.");
  await page.getByLabel(/Same organization only/).check();
  await expect(page.locator(".az-decision").getByRole("status")).toContainText("Refused (404)");
  await page.getByRole("button", { name: "Use the secure policy" }).click();
  await expect(page.getByText("These rules match a secure policy on every request.")).toBeVisible();
});

test("the HTTP lab reaches the real teaching resource server", async ({ page }) => {
  await page.goto("/lab/identity/protected-api");
  await expect(page.locator(".eng-reference summary")).toHaveText("Synthetic lab tokens");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".eng-panel").filter({ hasText: "200" }).first()).toBeVisible({ timeout: 15_000 });
});

test("long values in a failed check never widen the page", async ({ page }) => {
  await page.goto("/practice/identity?scenario=oidc-login&fault=verifier");
  await page.getByRole("button", { name: "Last step" }).click();
  for (const name of ["Sequence", "Message", "State"] as const) {
    await view(page, name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  }
});
