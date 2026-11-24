// Guided experiments for the Identity track, on the shared predict → test → explain cycle (src/learning/cycle.ts).
// Each runs the real protocol or policy engine; every outcome, reason and explanation is read from that run (which
// check failed, which session exists, what the API decided). Pure: no React.
import type { Choice, Cycle, Evidence } from "../learning/cycle.ts";
import { firstFailure, outcomeOf, runScenario, stateAt, type FlowRun } from "./model.ts";
import { findScenario } from "./flows/index.ts";
import { evaluate, describe, securePolicy, type AccessRequest, type Decision, type Rule } from "./authz.ts";

export type FlowSetup = { scenario: string; config: Record<string, string> };
const runFlow = (s: FlowSetup) => runScenario(findScenario(s.scenario)!, s.config);
const failed = (r: FlowRun) => firstFailure(r)?.check.id ?? "none";

/** The evidence every flow experiment shows: the outcome, where it stopped and why, and the last messages. */
function flowEvidence(r: FlowRun): Evidence[] {
  const out = outcomeOf(r);
  const f = firstFailure(r);
  const list: Evidence[] = [{ label: "Result", value: out.ok ? "Completed: every check passed" : out.summary, at: out.at ?? r.events.length - 1 }];
  if (f) list.push({ label: "The check that failed", value: `${f.check.label}: ${f.check.detail}${f.check.rule ? ` (${f.check.rule})` : ""}`, at: f.event.step });
  const last = r.events.at(-1)!;
  list.push({ label: "Last message", value: `Step ${last.step + 1}: ${last.title}`, at: last.step });
  list.push({ label: "Messages exchanged", value: String(r.events.length) });
  return list;
}
const flowStart = (s: FlowSetup): Evidence[] => {
  const scenario = findScenario(s.scenario)!;
  return [{ label: "Scenario", value: scenario.title }, ...scenario.controls.filter((c) => s.config[c.id] !== undefined).map((c) => ({ label: c.label, value: c.options.find((o) => o.value === s.config[c.id])?.label ?? s.config[c.id] }))];
};
/** The API's answer, read from the last message: 401, 403, or 200 when it served the request. */
const apiStatus = (r: FlowRun) => { const s = r.events.at(-1)!.status; return s === 401 ? "401" : s === 403 ? "403" : "200"; };
const reasonFrom = (map: Record<string, string>, fallback: string) => (r: FlowRun) => map[failed(r)] ?? fallback;

type FlowCycle = Cycle<FlowSetup, FlowRun>;
const flowCycle = (c: Omit<FlowCycle, "version" | "subject" | "run" | "evidence" | "readings" | "start">): FlowCycle => ({ ...c, version: 1, subject: "identity", run: runFlow, evidence: flowEvidence, readings: [], start: flowStart });

const redirectChoices: Choice[] = [
  { id: "works", text: "Sign-in works: the URIs are close enough.", miss: "Authorization servers compare redirect URIs as exact strings (RFC 9700 §2.1)." },
  { id: "error-redirect", text: "The identity provider redirects to the URI with an error.", miss: "It must not redirect to an unregistered URI at all; that would hand information to whoever owns it." },
  { id: "error-page", text: "The identity provider shows an error itself and never redirects." },
];
const outcomeRedirect = (r: FlowRun) => (failed(r) === "redirect-uri" ? "error-page" : outcomeOf(r).ok ? "works" : "error-redirect");
const redirectReasons: Choice[] = [
  { id: "exact", text: "Redirect URIs are compared by exact string match, and an unregistered one is never redirected to." },
  { id: "prefix", text: "Only the start of the URI is compared, so anything under the registered path is accepted.", miss: "Prefix matching is exactly what RFC 9700 forbids: it lets attackers receive codes." },
  { id: "registered", text: "The URI is registered, so every check passes." },
];

export const identityCycles: Cycle<any, any>[] = [
  flowCycle({
    id: "id-redirect", unit: "oauth-flows", title: "A redirect URI with one extra slash",
    concept: "Authorization servers compare redirect_uri with the registered value exactly, and never redirect to an unregistered one.",
    scenario: "The app registered https://app.example/callback but sends https://app.example/callback/ in its authorization request.",
    question: "What does the identity provider do with a redirect URI that differs by one character?",
    watch: "The identity provider's 'Validates the authorization request' step and what it sends back.",
    terms: ["oauth", "pkce"], hint: "Look at the check about redirect_uri, then at whether any 302 from the identity provider follows.",
    limits: "Real providers differ in error page wording and in how they treat loopback ports for native apps (allowed to vary by RFC 8252).",
    base: { id: "base", label: "One extra slash", setup: { scenario: "oidc-login", config: { redirect: "slash" } }, question: "The redirect URI has an extra trailing slash. What happens?", choices: redirectChoices, outcome: outcomeRedirect, reasons: redirectReasons, reason: (r) => (failed(r) === "redirect-uri" ? "exact" : "registered"), explain: (r) => `${firstFailure(r)?.check.detail ?? ""} The identity provider stops at step ${(firstFailure(r)?.event.step ?? 0) + 1} and shows its own error page: delivering even an error to an unregistered URI would leak to whoever controls it.` },
    variations: [
      { id: "attacker", label: "An attacker's URI", change: "redirect_uri is https://attacker.example/callback", setup: { scenario: "oidc-login", config: { redirect: "other" } }, question: "Now the redirect URI points to another site. What happens?", choices: redirectChoices, outcome: outcomeRedirect, reasons: redirectReasons, reason: (r) => (failed(r) === "redirect-uri" ? "exact" : "registered"), explain: (r) => `Same rule, same result: ${firstFailure(r)?.check.detail ?? ""} This is why exact matching matters: with prefix or pattern matching, codes could be delivered to an attacker.` },
      { id: "exact", label: "The registered URI", change: "redirect_uri is exactly the registered value", setup: { scenario: "oidc-login", config: { redirect: "exact" } }, question: "With the exact registered URI, what happens?", choices: redirectChoices, outcome: outcomeRedirect, reasons: redirectReasons, reason: (r) => (failed(r) === "redirect-uri" ? "exact" : "registered"), explain: (r) => `Every check passed and the flow completed in ${r.events.length} messages.` },
    ],
  }),
  flowCycle({
    id: "id-state", unit: "oauth-flows", title: "A callback this browser never asked for",
    concept: "state binds the authorization response to the browser that started the request, which stops login CSRF.",
    scenario: "An attacker plants their own authorization callback in the victim's browser. Its state isn't the one the victim's app stored.",
    question: "Where does the flow stop when state doesn't match?",
    watch: "The client's 'Checks state and issuer' step, and whether any token request follows.",
    terms: ["oauth", "csrf"], hint: "Find the first failed check and look at what the client sends next.",
    limits: "The model shows the client's check; it doesn't model how the attacker obtained a code for their own account.",
    base: { id: "base", label: "Mismatched state", setup: { scenario: "oidc-login", config: { fault: "state" } }, question: "The callback carries a state the app never issued. What happens?",
      choices: [
        { id: "signed-in", text: "The user is signed in; state is optional.", miss: "The client compares state before doing anything with the code." },
        { id: "before-token", text: "The client stops before redeeming the code." },
        { id: "token-fails", text: "The token endpoint refuses the code.", miss: "The client never gets that far: it rejects the callback first." },
      ],
      outcome: (r) => (failed(r) === "state" ? "before-token" : failed(r) === "pkce" || failed(r) === "code" ? "token-fails" : "signed-in"),
      reasons: [
        { id: "csrf", text: "state must equal the value this browser's pre-login record holds; otherwise the callback wasn't started here." },
        { id: "pkce", text: "The PKCE verifier doesn't hash to the challenge." },
        { id: "nonce", text: "The ID token's nonce is wrong." },
      ],
      reason: reasonFrom({ state: "csrf", pkce: "pkce", "idt-nonce": "nonce" }, "csrf"),
      explain: (r) => `${firstFailure(r)!.check.detail} No POST /token appears in the trace: the code is discarded. Without this check the victim would be signed in to the attacker's account (login CSRF).` },
    variations: [
      { id: "verifier", label: "Wrong verifier instead", change: "state is correct, but the code_verifier sent to the token endpoint is wrong", setup: { scenario: "oidc-login", config: { fault: "verifier" } }, question: "Now state matches but the verifier is wrong. Where does it stop?",
        choices: [
          { id: "signed-in", text: "The user is signed in." },
          { id: "before-token", text: "The client stops before redeeming the code." },
          { id: "token-fails", text: "The token endpoint refuses the code." },
        ],
        outcome: (r) => (failed(r) === "state" ? "before-token" : failed(r) === "pkce" ? "token-fails" : "signed-in"),
        reasons: [
          { id: "csrf", text: "state didn't match." },
          { id: "pkce", text: "SHA-256 of the verifier doesn't equal the code_challenge the identity provider stored." },
          { id: "nonce", text: "The ID token's nonce is wrong." },
        ],
        reason: reasonFrom({ state: "csrf", pkce: "pkce", "idt-nonce": "nonce" }, "pkce"),
        explain: (r) => `${firstFailure(r)!.check.detail} The identity provider computed SHA-256 of what it received and compared. A stolen code is useless without the real verifier.` },
    ],
  }),
  flowCycle({
    id: "id-signature", unit: "tokens", title: "An ID token signed with an unknown key",
    concept: "A token's claims mean nothing until its signature verifies with a key the verifier already trusts.",
    scenario: "The ID token's claims are all correct, but it was signed with a key the identity provider never published.",
    question: "Does a token with correct claims but an untrusted signature sign the user in?",
    watch: "The client's 'Validates the ID token' step.",
    terms: ["jwt", "oidc"], hint: "Which check comes first in the client's validation, and did it pass?",
    limits: "Signatures here are tracked by key id; the Token Inspector verifies real signatures.",
    base: { id: "base", label: "Unknown signing key", setup: { scenario: "oidc-login", config: { fault: "idtoken-key" } }, question: "The claims are right, the key is unknown. What happens?",
      choices: [
        { id: "accepted", text: "Signed in: the claims are correct.", miss: "Anyone can write correct-looking claims; the signature is what proves who wrote them." },
        { id: "rejected", text: "Sign-in fails at ID token validation." },
        { id: "api", text: "Sign-in works, but the API refuses later.", miss: "The client validates the ID token before creating any session." },
      ],
      outcome: (r) => (failed(r).startsWith("idt-") ? "rejected" : failed(r).startsWith("at-") ? "api" : "accepted"),
      reasons: [
        { id: "signature", text: "The signature didn't verify with any key in the provider's JWKS." },
        { id: "audience", text: "The token was issued to another client." },
        { id: "expired", text: "The token had expired." },
      ],
      reason: reasonFrom({ "idt-signature": "signature", "idt-aud": "audience", "idt-exp": "expired" }, "signature"),
      explain: (r) => `${firstFailure(r)!.check.detail} Decoding the token would show perfectly normal claims; only verification reveals the forgery.` },
    variations: [
      { id: "aud", label: "Right key, wrong audience", change: "the token is properly signed but issued to another client", setup: { scenario: "oidc-login", config: { fault: "idtoken-aud" } }, question: "Now the signature is valid but aud names another client. What happens?",
        choices: [{ id: "accepted", text: "Signed in: the signature is valid." }, { id: "rejected", text: "Sign-in fails at ID token validation." }, { id: "api", text: "Sign-in works, but the API refuses later." }],
        outcome: (r) => (failed(r).startsWith("idt-") ? "rejected" : "accepted"),
        reasons: [{ id: "signature", text: "The signature didn't verify." }, { id: "audience", text: "The token was issued to another client, so it isn't this client's proof of sign-in." }, { id: "expired", text: "The token had expired." }],
        reason: reasonFrom({ "idt-signature": "signature", "idt-aud": "audience", "idt-exp": "expired" }, "audience"),
        explain: (r) => `${firstFailure(r)!.check.detail} A genuine signature proves who issued a token, not whom it was issued to.` },
    ],
  }),
  flowCycle({
    id: "id-audience", unit: "authorization", title: "A valid token at the wrong API",
    concept: "Resource servers accept only tokens issued for them (aud) that carry the needed scope, and say which failed: 401 or 403.",
    scenario: "The app calls the Orders API with an access token the identity provider issued for the HR API.",
    question: "What does the Orders API answer?",
    watch: "The API's 'Validates the access token, then authorizes' step and its response status.",
    terms: ["audience", "scope"], hint: "Is the problem the token itself, or what the token permits?",
    limits: "Status codes follow RFC 6750 §3.1; some APIs return 404 to hide resources, which this scenario doesn't.",
    base: { id: "base", label: "Token for another API", setup: { scenario: "oidc-login", config: { fault: "api-aud" } }, question: "The access token's audience is the HR API. What does the Orders API answer?",
      choices: [
        { id: "200", text: "200: it's a valid token from the trusted issuer.", miss: "Same issuer isn't enough: aud must name this API (RFC 9700 §2.3)." },
        { id: "401", text: "401 invalid_token." },
        { id: "403", text: "403 insufficient_scope.", miss: "403 means the token is acceptable but lacks permission. A token for another API isn't acceptable here at all." },
      ],
      outcome: apiStatus,
      reasons: [
        { id: "aud", text: "aud names another API, so the token isn't valid here." },
        { id: "scope", text: "The token is for this API but lacks orders.read." },
        { id: "type", text: "It's an ID token, not an access token." },
      ],
      reason: reasonFrom({ "at-aud": "aud", "at-scope": "scope", "at-type": "type" }, "aud"),
      explain: (r) => `${firstFailure(r)!.check.detail} The API answers ${r.events.at(-1)!.status} with WWW-Authenticate: ${r.events.at(-1)!.headers?.[0]?.[1] ?? ""}.` },
    variations: [
      { id: "scope", label: "Right API, missing scope", change: "the token is for the Orders API but lacks orders.read", setup: { scenario: "oidc-login", config: { fault: "api-scope" } }, question: "Now the token is for this API but lacks orders.read. What does it answer?",
        choices: [{ id: "200", text: "200." }, { id: "401", text: "401 invalid_token." }, { id: "403", text: "403 insufficient_scope." }],
        outcome: apiStatus,
        reasons: [{ id: "aud", text: "aud names another API." }, { id: "scope", text: "The token is valid here but doesn't permit this operation." }, { id: "type", text: "It's an ID token." }],
        reason: reasonFrom({ "at-aud": "aud", "at-scope": "scope", "at-type": "type" }, "scope"),
        explain: (r) => `${firstFailure(r)!.check.detail} 403 with error="insufficient_scope": the caller is known, the permission is missing.` },
      { id: "idtoken", label: "The ID token instead", change: "the client sends its ID token to the API", setup: { scenario: "oidc-login", config: { fault: "api-idtoken" } }, question: "The client sends the ID token. What does the API answer?",
        choices: [{ id: "200", text: "200: it identifies the user." }, { id: "401", text: "401 invalid_token." }, { id: "403", text: "403 insufficient_scope." }],
        outcome: apiStatus,
        reasons: [{ id: "aud", text: "aud names another API." }, { id: "scope", text: "It lacks a scope." }, { id: "type", text: "An ID token is addressed to the client, not to APIs." }],
        reason: reasonFrom({ "at-aud": "aud", "at-scope": "scope", "at-type": "type" }, "type"),
        explain: (r) => `${firstFailure(r)!.check.detail} APIs must accept only access tokens issued for them.` },
    ],
  }),
  flowCycle({
    id: "id-sso-session", unit: "sso", title: "Can Application B reuse Application A's session?",
    concept: "Each application has its own session; single sign-on comes from the identity provider's session.",
    scenario: "Alice signed in to the Portal ten minutes ago. Now she opens Finance, another application trusting the same identity provider.",
    question: "How does Finance sign her in?",
    watch: "Which cookies the browser sends to Finance, then to the identity provider.",
    terms: ["sso", "session"], hint: "Look at the 'Looks up a Finance session' check, then the identity provider's session check.",
    limits: "Modern browsers' cookie and tracking protections can affect silent sign-in in iframes; this scenario uses full-page redirects, which they don't block.",
    base: { id: "base", label: "IdP session valid", setup: { scenario: "sso", config: {} }, question: "Finance is opened while the identity provider's session is valid. What happens?",
      choices: [
        { id: "reuse", text: "Finance reads the Portal's session cookie and signs her in directly.", miss: "Cookies are scoped to their site: portal.example's cookie is never sent to finance.example." },
        { id: "silent", text: "Finance redirects to the identity provider, which signs her in without a password." },
        { id: "password", text: "She must type her password again." },
      ],
      outcome: (r) => (r.events.some((e) => e.title === "Enters password again") ? "password" : stateAt(r, r.events.length - 1)["app-b"] ? "silent" : "reuse"),
      reasons: [
        { id: "idp-session", text: "The browser sends the identity provider's own cookie to the identity provider, which recognises its session." },
        { id: "shared-cookie", text: "The two applications share one cookie." },
        { id: "expired", text: "The identity provider's session had expired." },
      ],
      reason: (r) => (r.events.some((e) => e.title === "Enters password again") ? "expired" : "idp-session"),
      explain: (r) => `Finance found no session of its own and started a sign-in. The identity provider's session check: ${r.events.find((e) => e.checks?.some((c) => c.id === "idp-session"))!.checks!.find((c) => c.id === "idp-session")!.detail} Finance then created its own session: three sessions now exist.` },
    variations: [
      { id: "expired", label: "IdP session expired", change: "Finance is opened nine hours later, after the identity provider's 8-hour session ended", setup: { scenario: "sso", config: { idpAtB: "expired" } }, question: "Nine hours later, what happens when Finance is opened?",
        choices: [{ id: "reuse", text: "Finance reuses the Portal's session." }, { id: "silent", text: "Signed in without a password." }, { id: "password", text: "She must authenticate again." }],
        outcome: (r) => (r.events.some((e) => e.title === "Enters password again") ? "password" : "silent"),
        reasons: [{ id: "idp-session", text: "The identity provider recognised its session." }, { id: "shared-cookie", text: "The applications share a cookie." }, { id: "expired", text: "The identity provider's session expired, so it must authenticate her before issuing a code." }],
        reason: (r) => (r.events.some((e) => e.title === "Enters password again") ? "expired" : "idp-session"),
        explain: () => "SSO lasts as long as the identity provider's session. When it ends, the next application to ask gets a password prompt; the Portal's own session is irrelevant to Finance." },
    ],
  }),
  flowCycle({
    id: "id-key-rotation", unit: "tokens", title: "The identity provider rotates its signing key",
    concept: "Verifiers find signing keys by kid in a cached JWKS, and must refetch (rate-limited) when they meet a new kid.",
    scenario: "The identity provider publishes a new key, then starts signing with it. The Orders API cached the key set at startup.",
    question: "Do tokens signed with the new key work at the API?",
    watch: "The API's kid lookup for token 2.",
    terms: ["jwt"], hint: "Is the new kid in the API's cache, and does the API ever fetch the JWKS again?",
    limits: "HTTP caching headers on the JWKS response aren't modelled.",
    base: { id: "base", label: "API never refetches", setup: { scenario: "key-rotation", config: { refresh: "never" } }, question: "The API pinned the keys at startup. What happens to tokens signed with the new key?",
      choices: [
        { id: "ok", text: "They work: the identity provider published the key.", miss: "Publishing helps only verifiers that fetch the JWKS again." },
        { id: "rejected", text: "They're rejected: the API doesn't know the new kid." },
        { id: "old-rejected", text: "New tokens work, but tokens signed with the old key fail." },
      ],
      outcome: (r) => (failed(r) === "kid-token 2" ? "rejected" : failed(r) === "kid-token 1b" ? "old-rejected" : "ok"),
      reasons: [
        { id: "pinned", text: "The API's key set never changes, so the new kid is unknown." },
        { id: "removed", text: "The old key was removed while its tokens were still valid." },
        { id: "refetch", text: "The API refetched the JWKS and found the key." },
      ],
      reason: reasonFrom({ "kid-token 2": "pinned", "kid-token 1b": "removed" }, "refetch"),
      explain: (r) => firstFailure(r) ? `${firstFailure(r)!.check.detail} Every user gets 401 until the API restarts.` : "Every token verified." },
    variations: [
      { id: "refetch", label: "Refetch on unknown kid", change: "the API refetches the JWKS (at most once a minute) when it meets an unknown kid", setup: { scenario: "key-rotation", config: { refresh: "refetch" } }, question: "With refetching, what happens?",
        choices: [{ id: "ok", text: "Every token works." }, { id: "rejected", text: "New-key tokens are rejected." }, { id: "old-rejected", text: "Old-key tokens fail." }],
        outcome: (r) => (failed(r) === "kid-token 2" ? "rejected" : failed(r) === "kid-token 1b" ? "old-rejected" : "ok"),
        reasons: [{ id: "pinned", text: "The key set never changes." }, { id: "removed", text: "The old key was removed early." }, { id: "refetch", text: "The unknown kid triggered one JWKS fetch, which returned both keys." }],
        reason: reasonFrom({ "kid-token 2": "pinned", "kid-token 1b": "removed" }, "refetch"),
        explain: () => "Graceful rotation: the new key was published before use and the old one kept until its tokens expired, so one refetch is enough." },
      { id: "abrupt", label: "Abrupt rollover", change: "the identity provider removes the old key the moment it switches", setup: { scenario: "key-rotation", config: { refresh: "refetch", rollover: "abrupt" } }, question: "The identity provider removes the old key immediately. What happens?",
        choices: [{ id: "ok", text: "Every token works." }, { id: "rejected", text: "New-key tokens are rejected." }, { id: "old-rejected", text: "Tokens signed with the old key, still unexpired, fail." }],
        outcome: (r) => (failed(r) === "kid-token 2" ? "rejected" : failed(r) === "kid-token 1b" ? "old-rejected" : "ok"),
        reasons: [{ id: "pinned", text: "The key set never changes." }, { id: "removed", text: "The old key left the JWKS while tokens it signed were still valid." }, { id: "refetch", text: "Refetching found every key." }],
        reason: reasonFrom({ "kid-token 2": "pinned", "kid-token 1b": "removed" }, "refetch"),
        explain: (r) => `${firstFailure(r)?.check.detail ?? ""} Keep the old key published until every token it signed has expired.` },
    ],
  }),
  flowCycle({
    id: "id-refresh-reuse", unit: "oauth-flows", title: "A stolen refresh token is used after rotation",
    concept: "With rotation, each refresh token works once; a second use reveals a copy and the server revokes the family.",
    scenario: "An attacker copied refresh token RT-1. The app refreshes normally (getting RT-2); then the attacker tries RT-1.",
    question: "What happens when the attacker uses RT-1?",
    watch: "The authorization server's 'Checks the refresh token' step for the attacker.",
    terms: ["oauth"], hint: "Was RT-1 used before the attacker presented it?",
    limits: "The model follows one common reuse-detection policy (revoke the family); servers vary, and some allow a short grace period for lost responses.",
    base: { id: "base", label: "Rotation on", setup: { scenario: "refresh", config: { theft: "after" } }, question: "Rotation is on. The attacker presents RT-1 after the app used it. What happens?",
      choices: [
        { id: "attacker-wins", text: "The attacker gets fresh tokens.", miss: "With rotation, RT-1 was spent when the app used it." },
        { id: "family-revoked", text: "Refused, and every token in the family is revoked." },
        { id: "only-attacker", text: "Refused, and nothing else changes.", miss: "The server can't tell which party is legitimate, so it revokes the family." },
      ],
      outcome: (r) => (outcomeOf(r).check?.kind === "security" ? "attacker-wins" : failed(r) === "rt-attacker" ? "family-revoked" : "only-attacker"),
      reasons: [
        { id: "reuse", text: "RT-1 had already been used, which proves two parties hold it." },
        { id: "expired", text: "RT-1 had expired." },
        { id: "no-rotation", text: "Without rotation nothing ties the token to its first user." },
      ],
      reason: (r) => (outcomeOf(r).check?.kind === "security" ? "no-rotation" : "reuse"),
      explain: (r) => `${firstFailure(r)!.check.detail} The app's next refresh fails too, and the user signs in again: an inconvenience that cuts the attacker off.` },
    variations: [
      { id: "off", label: "Rotation off", change: "refresh tokens are not rotated", setup: { scenario: "refresh", config: { theft: "after", rotation: "off" } }, question: "Without rotation, what happens when the attacker presents RT-1?",
        choices: [{ id: "attacker-wins", text: "The attacker gets fresh tokens." }, { id: "family-revoked", text: "Refused, family revoked." }, { id: "only-attacker", text: "Refused." }],
        outcome: (r) => (outcomeOf(r).check?.kind === "security" ? "attacker-wins" : "family-revoked"),
        reasons: [{ id: "reuse", text: "Reuse was detected." }, { id: "expired", text: "RT-1 had expired." }, { id: "no-rotation", text: "RT-1 stays valid after each use, so nothing reveals the copy." }],
        reason: (r) => (outcomeOf(r).check?.kind === "security" ? "no-rotation" : "reuse"),
        explain: () => "RFC 9700 §2.2.2: refresh tokens for public clients must be rotated or sender-constrained for exactly this reason." },
    ],
  }),
];

// ---- Authorization experiments (the policy engine) ----
export type AuthzSetup = { request: AccessRequest; rules: Rule[] };
const authzStart = (s: AuthzSetup): Evidence[] => [
  { label: "Request", value: `${s.request.subject} → ${describe(s.request)}` },
  { label: "Credential", value: s.request.credential },
  { label: "Rules the API enforces", value: s.rules.join(", ") || "none" },
];
const authzEvidence = (d: Decision): Evidence[] => [
  { label: "Decision", value: `${d.allow ? "Allowed" : "Refused"} (${d.status}): ${d.reason}` },
  ...d.steps.map((s) => ({ label: s.question, value: `${s.result === "pass" ? "Yes" : s.result === "fail" ? "No" : "Not checked"}: ${s.detail}` })),
];
const withoutTenant = securePolicy.filter((r) => r !== "tenant");
const tenantChoices: Choice[] = [
  { id: "allowed", text: "Allowed: Dave is an admin, and admins may read orders." },
  { id: "refused", text: "Refused: the order belongs to another organisation." },
];
identityCycles.push({
  id: "id-tenant", version: 1, subject: "identity", unit: "authorization", title: "An admin from another tenant",
  concept: "Roles are per tenant: tenant isolation must be checked on every request, separately from roles.",
  scenario: "Dave is an admin at Globex. He requests GET /api/orders/123, an order belonging to Acme. The API checks audience, scope, role and ownership, but not the tenant.",
  question: "Can an authenticated admin read another tenant's order?",
  watch: "Each step of the API's decision, especially the tenant step.",
  terms: ["tenant", "rbac"], hint: "Which rule would compare the order's tenant with Dave's?",
  limits: "One API and fixed data; real multi-tenant systems also scope caches, search and storage by tenant.",
  start: authzStart,
  base: { id: "base", label: "No tenant check", setup: { request: { subject: "dave", action: "read", order: "123", credential: "valid" }, rules: withoutTenant }, question: "Without a tenant check, what does the API decide?", choices: tenantChoices,
    outcome: (d: Decision) => (d.allow ? "allowed" : "refused"),
    reasons: [{ id: "role-only", text: "Every enforced rule passed: the role grants reading, and nothing compares tenants." }, { id: "tenant", text: "The tenant check refused it." }],
    reason: (d: Decision) => (d.allow ? "role-only" : "tenant"),
    explain: (d: Decision) => `${d.allow ? "Allowed" : "Refused"}: ${d.steps.map((s) => `${s.question} ${s.result}`).join("; ")}. An admin role at Globex says nothing about Acme's data: this is cross-tenant access.` },
  variations: [
    { id: "tenant", label: "With tenant isolation", change: "the API also requires the order's tenant to equal the caller's", setup: { request: { subject: "dave", action: "read", order: "123", credential: "valid" }, rules: securePolicy }, question: "With the tenant check on, what does the API decide?", choices: tenantChoices,
      outcome: (d: Decision) => (d.allow ? "allowed" : "refused"),
      reasons: [{ id: "role-only", text: "The role grants reading." }, { id: "tenant", text: "The order's tenant (acme) isn't Dave's (globex)." }],
      reason: (d: Decision) => (d.allow ? "role-only" : "tenant"),
      explain: (d: Decision) => `${d.reason} Reporting it as not found avoids confirming the order exists.` },
  ],
  run: (s: AuthzSetup) => evaluate(s.request, s.rules),
  evidence: authzEvidence,
  readings: [],
});

export const findIdentityCycle = (id: string | null) => identityCycles.find((c) => c.id === id);
