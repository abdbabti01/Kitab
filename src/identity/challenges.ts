// Identity Practice challenges. Five kinds, each judged without a model:
// - classify: authored answers per item (authentication or authorization);
// - diagnose: the learner picks the step and the cause in a trace; the answer is read from the engine's run;
// - configure: the learner changes scenario settings; requirements are checked against the engine's run;
// - policy: the learner chooses an API's rules; the policy engine's audit must show no wrong decision;
// - decision: an acceptable choice with only supporting reasons (judgeDecision, as in System Design).
// Every challenge has variants; passing two different ones masters it. Pure: no React.
import { judgeDecision, type Decision } from "../architecture/concepts/types.ts";
import { audit, type Rule } from "./authz.ts";
import { firstFailure, outcomeOf, runScenario, stateAt, type Config, type FlowRun } from "./model.ts";
import { findScenario } from "./flows/index.ts";

type Base = { id: string; title: string; version: string; unit: string; situation: string; objective: string; hints: string[] };
export type Cause = { id: string; text: string; checks: string[] };
export type DiagnoseVariant = { id: string; story: string; scenario: string; config: Config };
export type Requirement = { label: string; test: (run: FlowRun) => boolean };

export type Challenge =
  | (Base & { kind: "classify"; variants: { id: string; items: { text: string; answer: "authn" | "authz" }[] }[] })
  | (Base & { kind: "diagnose"; variants: DiagnoseVariant[]; causes: Cause[]; answer?: (run: FlowRun) => { step: number; cause: string } })
  | (Base & { kind: "configure"; scenario: string; editable: string[]; variants: { id: string; story: string; start: Config; requirements: Requirement[] }[] })
  | (Base & { kind: "policy"; variants: { id: string; story: string; start: Rule[] }[] })
  | (Base & { kind: "decision"; variants: (Decision & { id: string })[] });

export const runOf = (scenario: string, config: Config) => runScenario(findScenario(scenario)!, config);

/** The engine's answer to a diagnose challenge: the step where the flow failed and the cause whose checks include it. */
export function diagnosis(challenge: Extract<Challenge, { kind: "diagnose" }>, run: FlowRun) {
  if (challenge.answer) return challenge.answer(run);
  const f = firstFailure(run)!;
  return { step: f.event.step, cause: challenge.causes.find((c) => c.checks.includes(f.check.id))!.id };
}

export type Submission =
  | { kind: "classify"; answers: ("authn" | "authz" | null)[] }
  | { kind: "diagnose"; step: number | null; cause: string | null }
  | { kind: "configure"; config: Config }
  | { kind: "policy"; rules: Rule[] }
  | { kind: "decision"; choice: number | null; reasons: number[] };

export type Judgement = { passed: boolean; feedback: string[] };

/** Judges a submission for one variant. Feedback explains every failure from the model's own results. */
export function judge(challenge: Challenge, variantId: string, s: Submission): Judgement {
  if (challenge.kind === "classify" && s.kind === "classify") {
    const v = challenge.variants.find((x) => x.id === variantId)!;
    const wrong = v.items.map((item, i) => ({ item, given: s.answers[i] })).filter(({ item, given }) => item.answer !== given);
    return { passed: wrong.length === 0, feedback: wrong.map(({ item, given }) => given === null ? `Not answered: “${item.text}”` : `“${item.text}” is an ${item.answer === "authn" ? "authentication" : "authorization"} problem.`) };
  }
  if (challenge.kind === "diagnose" && s.kind === "diagnose") {
    const v = challenge.variants.find((x) => x.id === variantId)!;
    const run = runOf(v.scenario, v.config);
    const want = diagnosis(challenge, run);
    const feedback: string[] = [];
    if (s.step !== want.step) feedback.push(s.step === null ? "Select the step where it went wrong." : `Step ${s.step + 1} isn't where it went wrong: look for the first step whose check failed, or where the flow changed course.`);
    if (s.cause !== want.cause) feedback.push(s.cause === null ? "Choose a cause." : "That cause doesn't match what the failing step checked. Open the step and read its checks.");
    return { passed: feedback.length === 0, feedback };
  }
  if (challenge.kind === "configure" && s.kind === "configure") {
    const v = challenge.variants.find((x) => x.id === variantId)!;
    const run = runOf(challenge.scenario, s.config);
    const failed = v.requirements.filter((r) => !r.test(run));
    return { passed: failed.length === 0, feedback: failed.map((r) => `Not met: ${r.label}.`) };
  }
  if (challenge.kind === "policy" && s.kind === "policy") {
    const result = audit(s.rules);
    const bad = result.rows.filter((r) => r.verdict !== "agrees");
    return { passed: bad.length === 0, feedback: bad.map((r) => `${r.label}: ${r.verdict === "too-permissive" ? "allowed, but it must be refused" : "refused, but it must be allowed"}.`) };
  }
  if (challenge.kind === "decision" && s.kind === "decision") {
    const d = challenge.variants.find((x) => x.id === variantId)!;
    if (s.choice === null) return { passed: false, feedback: ["Choose an option."] };
    const r = judgeDecision(d, s.choice, s.reasons);
    const feedback = [d.choices[s.choice].why];
    if (r.wrongReasons.length) feedback.push(`These reasons don't hold or don't support it: ${r.wrongReasons.map((i) => `“${d.reasons[i].text}”`).join(" ")}`);
    if (!r.enough) feedback.push(`Give at least ${d.minReasons} reasons that support the choice.`);
    return { passed: r.correct, feedback };
  }
  return { passed: false, feedback: ["This answer doesn't fit this challenge."] };
}

const ok = (run: FlowRun) => outcomeOf(run).ok;
const end = (run: FlowRun) => stateAt(run, run.events.length - 1);
const hasKey = (run: FlowRun, at: "app" | "app-b" | "idp", prefix: string) => Object.keys(end(run)[at] ?? {}).some((k) => k.startsWith(prefix));

export const identityChallenges: Challenge[] = [
  {
    kind: "classify", id: "authn-or-authz", title: "Authentication or authorization?", version: "1", unit: "fundamentals",
    situation: "A security team is triaging reports. Each one is either about proving who someone is (authentication) or about what an identified caller may do (authorization).",
    objective: "Sort every report correctly.",
    hints: ["Ask: did the system know who the caller was? If yes and it still went wrong, it's authorization.", "Passwords, MFA, sessions and tokens being forged or stolen are about identity; roles, ownership and tenants are about permission."],
    variants: [
      { id: "a", items: [
        { text: "A signed-in customer reads another customer's invoice by changing the id in the URL.", answer: "authz" },
        { text: "Attackers sign in to accounts with passwords leaked from another website.", answer: "authn" },
        { text: "A support agent can issue refunds of any size, though policy says 500 at most.", answer: "authz" },
        { text: "A phishing site relays users' one-time codes and takes over their sessions.", answer: "authn" },
        { text: "An admin from one customer company can see another company's users.", answer: "authz" },
      ] },
      { id: "b", items: [
        { text: "A session id is accepted from the URL, so an attacker plants one before the victim signs in.", answer: "authn" },
        { text: "A reporting app's read-only token is used to delete records.", answer: "authz" },
        { text: "An API accepts JWTs without verifying their signature.", answer: "authn" },
        { text: "Every employee can open the payroll admin pages after signing in.", answer: "authz" },
        { text: "Users stay signed in for a week after their account is disabled.", answer: "authn" },
      ] },
    ],
  },
  {
    kind: "diagnose", id: "expired-session", title: "Investigate a redirect after a session expires", version: "1", unit: "passwords-sessions",
    situation: "A user complains they were 'sent to the login page again'. Here is the trace from their browser.",
    objective: "Select the step that explains the redirect, and which session had ended.",
    hints: ["Find the step where an application or the identity provider looked up a session.", "If no password was asked for, the identity provider's session was still alive."],
    causes: [
      { id: "app", text: "The application's own session had expired; the identity provider's session was still valid.", checks: [] },
      { id: "idp", text: "The identity provider's session had expired, so it had to authenticate the user again.", checks: [] },
      { id: "logout", text: "The user had logged out of the identity provider.", checks: [] },
    ],
    answer: (run) => {
      const pwd = run.events.find((e) => e.title === "Enters password again");
      if (pwd) return { step: run.events.find((e) => e.checks?.some((c) => c.id === "idp-session"))!.step, cause: "idp" };
      return { step: run.events.find((e) => e.checks?.some((c) => c.id === "a-expired"))!.step, cause: "app" };
    },
    variants: [
      { id: "app-expired", story: "The user had the Portal open an hour ago and came back to it.", scenario: "sso", config: { after: "a-expires" } },
      { id: "idp-expired", story: "The user signed in to the Portal in the morning and opened Finance nine hours later.", scenario: "sso", config: { idpAtB: "expired" } },
    ],
  },
  {
    kind: "decision", id: "configure-oauth", title: "Configure OAuth correctly", version: "1", unit: "oauth",
    situation: "Four teams ask how their software should get tokens.", objective: "Choose the grant and client type, and the reasons that support it.",
    hints: ["Is a user present? Is there a browser? Can the software keep a secret?", "Implicit and password grants are not acceptable in new designs (RFC 9700)."],
    variants: [
      { id: "tv", title: "A streaming app on smart TVs", context: ["The TV has a remote control and no usable browser.", "Users have phones."], question: "How should the TV app get tokens?", minReasons: 2,
        choices: [{ text: "Device Authorization Grant (RFC 8628), public client.", acceptable: true, why: "Users approve on their phone; the TV polls." }, { text: "Resource Owner Password Credentials: type the password with the remote.", why: "Prohibited (RFC 9700 §2.4), and it blocks MFA." }, { text: "Client Credentials with a secret in the app.", why: "No user identity, and the secret can be extracted from every TV." }],
        reasons: [{ text: "The device can't run a sign-in page, but the user's phone can.", relevant: true }, { text: "A secret shipped on consumer devices can't stay secret.", relevant: true }, { text: "Polling is faster than redirects." }] },
      { id: "batch", title: "A nightly billing job", context: ["Runs on a server with no user.", "Reads orders from the Orders API."], question: "How should the job get tokens?", minReasons: 2,
        choices: [{ text: "Client Credentials, confidential client, scope orders.read.", acceptable: true, why: "The job authenticates as itself with least privilege." }, { text: "Authorization Code with an admin's account.", why: "Needs an interactive user and ties a job to a person." }, { text: "Device grant.", why: "There's no user to approve." }],
        reasons: [{ text: "No user is involved, so the client is the resource owner.", relevant: true }, { text: "A server can keep a credential secret.", relevant: true }, { text: "Client credentials tokens never expire." }] },
      { id: "web", title: "A company's server-rendered web app", context: ["Employees sign in; it calls internal APIs.", "It has a backend."], question: "Which setup?", minReasons: 2,
        choices: [{ text: "Authorization Code with PKCE, confidential client; tokens stay on the server behind a session cookie.", acceptable: true, why: "The backend-for-frontend pattern RFC 10017 recommends." }, { text: "Implicit grant, tokens in the URL fragment.", why: "Deprecated: tokens leak through URLs (RFC 9700 §2.1.2)." }, { text: "Authorization Code without PKCE or state.", why: "Leaves the callback open to CSRF and code injection." }],
        reasons: [{ text: "Tokens held on the server aren't exposed to browser script.", relevant: true }, { text: "PKCE protects the code even for confidential clients.", relevant: true }, { text: "Implicit is simpler, so it's safer." }] },
      { id: "mobile", title: "A native mobile app", context: ["iOS and Android apps for customers.", "Calls the company's APIs."], question: "Which setup?", minReasons: 2,
        choices: [{ text: "Authorization Code with PKCE in the system browser, public client.", acceptable: true, why: "RFC 8252: external user-agent, PKCE, no embedded secret." }, { text: "A client secret compiled into the app.", why: "Anyone can extract it from the app package." }, { text: "Collect the password in a native form and use the password grant.", why: "Prohibited, and it blocks MFA and passkeys." }],
        reasons: [{ text: "An app on users' phones is a public client.", relevant: true }, { text: "PKCE stops another app that intercepts the redirect from redeeming the code.", relevant: true }, { text: "Mobile apps can't make HTTP requests to token endpoints." }] },
    ],
  },
  {
    kind: "configure", id: "repair-pkce", title: "Repair a broken sign-in flow", version: "1", unit: "oauth-flows", scenario: "oidc-login", editable: ["client", "pkce", "redirect"],
    situation: "A team's sign-in is broken. Run the flow, find which check fails, and change the settings until the user signs in, without weakening security.",
    objective: "The flow completes, with PKCE wherever the client is public.",
    hints: ["Run it and open the failing step: its check names the rule.", "Public clients must use PKCE; redirect URIs must match exactly."],
    variants: [
      { id: "spa-no-pkce", story: "A browser-based app sends no PKCE.", start: { client: "spa", pkce: "off" }, requirements: [{ label: "The user is signed in", test: ok }, { label: "A public client uses PKCE", test: (r) => r.config.client !== "spa" || r.config.pkce === "S256" }] },
      { id: "slash", story: "The redirect URI in the request has an extra slash.", start: { redirect: "slash" }, requirements: [{ label: "The user is signed in", test: ok }] },
      { id: "both", story: "A browser-based app sends no PKCE, and its redirect URI points elsewhere.", start: { client: "spa", pkce: "off", redirect: "other" }, requirements: [{ label: "The user is signed in", test: ok }, { label: "A public client uses PKCE", test: (r) => r.config.client !== "spa" || r.config.pkce === "S256" }] },
    ],
  },
  {
    kind: "diagnose", id: "validate-id-token", title: "Validate an ID token", version: "1", unit: "oidc",
    situation: "Sign-in fails after the token exchange. The client logged the trace.", objective: "Select the step that rejected the sign-in and the reason.",
    hints: ["The failure is in the client's own validation of the ID token.", "Open that step's checks: which one failed?"],
    causes: [
      { id: "signature", text: "The signature didn't verify with a key from the provider's JWKS.", checks: ["idt-signature"] },
      { id: "issuer", text: "The issuer wasn't the expected one.", checks: ["idt-iss"] },
      { id: "audience", text: "The token was issued to another client (aud).", checks: ["idt-aud"] },
      { id: "expired", text: "The token had expired.", checks: ["idt-exp"] },
      { id: "nonce", text: "The nonce didn't match this sign-in request.", checks: ["idt-nonce"] },
    ],
    variants: [
      { id: "nonce", story: "Users on one office network intermittently fail to sign in.", scenario: "oidc-login", config: { fault: "nonce" } },
      { id: "aud", story: "A new deployment fails every sign-in.", scenario: "oidc-login", config: { fault: "idtoken-aud" } },
      { id: "exp", story: "Sign-ins fail from one server only.", scenario: "oidc-login", config: { fault: "idtoken-expired" } },
      { id: "key", story: "Sign-ins fail during an incident at the identity provider.", scenario: "oidc-login", config: { fault: "idtoken-key" } },
    ],
  },
  {
    kind: "diagnose", id: "token-rejected", title: "Why did the API reject the token?", version: "1", unit: "tokens",
    situation: "Users see errors when the app calls an API. The API's logs show the trace.", objective: "Select the step where the token was refused and the reason.",
    hints: ["Find the API's validation step.", "401 means the token isn't acceptable here; 403 means it is, but lacks permission."],
    causes: [
      { id: "audience", text: "The token was issued for another API.", checks: ["at-aud"] },
      { id: "scope", text: "The token lacks the required scope.", checks: ["at-scope"] },
      { id: "type", text: "It's an ID token, not an access token.", checks: ["at-type"] },
      { id: "kid", text: "The API doesn't know the signing key (kid).", checks: ["kid-token 2", "kid-token 1b"] },
    ],
    variants: [
      { id: "aud", story: "After a configuration change, every call fails.", scenario: "oidc-login", config: { fault: "api-aud" } },
      { id: "scope", story: "Reads fail for a newly registered client.", scenario: "oidc-login", config: { fault: "api-scope" } },
      { id: "type", story: "A developer 'simplified' the API client.", scenario: "oidc-login", config: { fault: "api-idtoken" } },
      { id: "kid", story: "Everything broke at the moment the identity provider rotated keys.", scenario: "key-rotation", config: { refresh: "never" } },
    ],
  },
  {
    kind: "configure", id: "sso-two-apps", title: "Set up SSO for two applications", version: "1", unit: "sso", scenario: "sso", editable: ["bMfa", "after", "backchannel", "bScopes"],
    situation: "The Portal and Finance trust the same identity provider. Configure them to meet the requirement.", objective: "Meet every requirement in the run.",
    hints: ["Check the State tab at the last step: which sessions remain?", "Ending the identity provider's session needs logout at the identity provider; telling Finance needs back-channel logout."],
    variants: [
      { id: "mfa", story: "Finance must require MFA, but users who signed in to the Portal must not type their password again.", start: {}, requirements: [{ label: "Finance verified that MFA was used", test: (r) => r.events.some((e) => e.checks?.some((c) => c.id === "b-acr" && c.ok)) }, { label: "No second password prompt", test: (r) => !r.events.some((e) => e.title === "Enters password again") }, { label: "Both applications are signed in", test: (r) => ok(r) && hasKey(r, "app", "Portal session") && hasKey(r, "app-b", "Finance session") }] },
      { id: "logout-everywhere", story: "When a user logs out everywhere from the Portal, Finance must end its session too.", start: { after: "logout-a" }, requirements: [{ label: "No identity provider session remains", test: (r) => !hasKey(r, "idp", "IdP session") }, { label: "No Finance session remains", test: (r) => !hasKey(r, "app-b", "Finance session") }, { label: "No Portal session remains", test: (r) => !hasKey(r, "app", "Portal session") }] },
      { id: "no-silent", story: "After logging out of the Portal, users must not be signed straight back in when they reopen it.", start: { after: "logout-a" }, requirements: [{ label: "No Portal session remains", test: (r) => !hasKey(r, "app", "Portal session") }, { label: "No identity provider session remains", test: (r) => !hasKey(r, "idp", "IdP session") }] },
    ],
  },
  {
    kind: "diagnose", id: "saml-failure", title: "Diagnose a SAML login failure", version: "1", unit: "saml",
    situation: "Users can't sign in to the Reports app through SAML. The SP logged the trace and the assertion.", objective: "Select the validation step and the rule the response broke.",
    hints: ["Open the SP's 'Validates the response and assertion' step.", "Open the assertion token in the POST: compare Audience, NotOnOrAfter, InResponseTo and the signature's Reference with what the SP expects."],
    causes: [
      { id: "signature", text: "The signature doesn't verify with the certificate in the SP's metadata (or is missing).", checks: ["signature"] },
      { id: "wrapping", text: "The signature covers a different element than the one being read.", checks: ["signed-element"] },
      { id: "audience", text: "The assertion is for another service provider.", checks: ["audience"] },
      { id: "time", text: "The assertion has expired.", checks: ["time"] },
      { id: "in-response-to", text: "It doesn't answer a request this SP sent.", checks: ["in-response-to"] },
      { id: "replay", text: "The same assertion was already used.", checks: ["replay"] },
    ],
    variants: [
      { id: "unsigned", story: "A newly configured identity provider connection fails every time.", scenario: "saml", config: { fault: "unsigned" } },
      { id: "audience", story: "After copying the configuration from the Payroll app, sign-in fails.", scenario: "saml", config: { fault: "audience" } },
      { id: "expired", story: "Only users of one slow proxy fail.", scenario: "saml", config: { fault: "expired" } },
      { id: "in-response-to", story: "Users who opened two sign-in tabs fail.", scenario: "saml", config: { fault: "in-response-to" } },
      { id: "wrapping", story: "The security team flagged a suspicious response.", scenario: "saml", config: { fault: "wrapping" } },
    ],
  },
  {
    kind: "policy", id: "fix-api-policy", title: "Fix an API authorization policy", version: "1", unit: "authorization",
    situation: "The orders API serves Acme and Globex. Choose the rules it enforces.", objective: "No unauthorized request allowed, and no legitimate request blocked, across every test request.",
    hints: ["Run the table: each wrong row names a request. What would have stopped it, or what blocked it?", "Deny by default: with no permission rule, nothing is allowed."],
    variants: [
      { id: "roles-only", story: "The API checks audience, scope and role, and nothing about which orders belong to whom.", start: ["audience", "scope", "role"] },
      { id: "admin-lock", story: "After an incident someone made the API admin-only, and customers can't see their orders.", start: ["role", "tenant", "conditions", "admin-only"] },
      { id: "nothing", story: "A new API with no rules yet.", start: [] },
    ],
  },
  {
    kind: "decision", id: "phishing-resistant", title: "Stop a phishing proxy", version: "1", unit: "mfa-passkeys",
    situation: "Staff are targeted by an adversary-in-the-middle phishing kit that relays everything typed into a look-alike site.", objective: "Choose the sign-in method that defeats it, with the reasons.",
    hints: ["Run the MFA scenario through the proxy with each factor.", "What does the browser bind a passkey to?"],
    variants: [
      { id: "proxy", title: "Choose a sign-in method", context: ["The phishing site is a proxy with a valid TLS certificate for idp-example.co.", "It relays passwords, codes and push approvals in real time."], question: "Which sign-in method stops it?", minReasons: 2,
        choices: [{ text: "Passkeys (WebAuthn).", acceptable: true, why: "The browser binds the ceremony to the real origin; the proxy can't use or relay it." }, { text: "Password plus TOTP codes.", why: "Codes are relayed within their time window." }, { text: "Password plus push with number matching.", why: "The proxy shows the number on its copy of the page; the user approves." }, { text: "Password plus SMS codes.", why: "Relayed like any code, and SIM-swappable." }],
        reasons: [{ text: "The browser refuses an rpId that doesn't match the page's origin.", relevant: true }, { text: "The signature covers the origin, which the real server checks.", relevant: true }, { text: "Passkeys are longer than codes." }, { text: "Users can't be fooled by a look-alike domain." }] },
    ],
  },
  {
    kind: "policy", id: "multi-tenant", title: "Secure a multi-tenant API", version: "1", unit: "enterprise",
    situation: "Acme and Globex share the orders API. Their admins must manage only their own company.", objective: "No cross-tenant or other unauthorized access, and no legitimate request blocked.",
    hints: ["Roles are per tenant: is anything comparing the order's tenant with the caller's?", "Customers inside one tenant still see only their own orders."],
    variants: [
      { id: "no-tenant", story: "Everything is checked except the tenant.", start: ["audience", "scope", "role", "ownership", "conditions"] },
      { id: "no-tenant-owner", story: "Only token and role checks are in place.", start: ["audience", "scope", "role", "conditions"] },
    ],
  },
  {
    kind: "decision", id: "enterprise-architecture", title: "Design an enterprise identity architecture", version: "1", unit: "enterprise",
    situation: "A SaaS company sells to enterprises and is designing its identity architecture.", objective: "Choose the design and the reasons that support it.",
    hints: ["Customers bring their own identity providers; some speak only SAML.", "Signing people in doesn't remove leavers: provisioning does."],
    variants: [
      { id: "saas", title: "Enterprise SaaS sign-in", context: ["Customers use Entra ID, Okta or others; some require SAML.", "Each customer's admins must manage only their own users.", "Customers require leavers to lose access the same day."], question: "Which architecture?", minReasons: 3,
        choices: [
          { text: "Support OIDC and SAML per customer tenant (often through a broker), map each trusted issuer to one tenant, SCIM provisioning, RBAC within the tenant, short sessions.", acceptable: true, why: "Standards each customer can use, strict tenant mapping, and deprovisioning." },
          { text: "One shared OIDC client that accepts any issuer from major providers, with JIT accounts.", why: "Any tenant at those providers could sign in; leavers are never removed." },
          { text: "Local passwords per customer user, synchronised nightly from their directories.", why: "Spreads passwords and bypasses their MFA policies." },
        ],
        reasons: [{ text: "Each trusted issuer maps to exactly one customer tenant.", relevant: true }, { text: "SCIM tells the app when people leave.", relevant: true }, { text: "Supporting SAML and OIDC lets every customer's IdP connect.", relevant: true }, { text: "JIT provisioning removes leavers automatically." }, { text: "Local passwords are simpler to secure." }] },
    ],
  },
  {
    kind: "diagnose", id: "incident-triage", title: "Triage identity incidents", version: "1", unit: "failures",
    situation: "The on-call engineer collected traces from five incident reports. Each shows one failure or successful attack.", objective: "Select the decisive step and name the failure.",
    hints: ["The first failed check is the decisive step. A red shield means an attacker succeeded.", "Read the check's detail: it names the rule."],
    causes: [
      { id: "refresh", text: "A stolen refresh token keeps working because it is never rotated.", checks: ["attacker-access"] },
      { id: "revocation", text: "A revoked token is still accepted from a cached introspection result.", checks: ["revocation"] },
      { id: "phishing", text: "A phishing proxy relayed a one-time code and kept the session.", checks: ["phished"] },
      { id: "csrf", text: "A callback that this browser never started (state mismatch).", checks: ["state"] },
      { id: "redirect", text: "An unregistered redirect URI.", checks: ["redirect-uri"] },
    ],
    variants: [
      { id: "refresh", story: "An account keeps getting new tokens from abroad after the user's laptop was compromised.", scenario: "refresh", config: { rotation: "off", theft: "after" } },
      { id: "revocation", story: "A user logged out, yet their old token still worked for a minute.", scenario: "introspection", config: { revoke: "yes", cache: "60" } },
      { id: "phishing", story: "A manager's account was taken over the day after they 'completed MFA'.", scenario: "mfa", config: { factor: "otp", site: "phish" } },
      { id: "csrf", story: "Sign-in failures spiked from links in a forum post.", scenario: "oidc-login", config: { fault: "state" } },
      { id: "redirect", story: "A partner reports that sign-in shows an error at the identity provider.", scenario: "oidc-login", config: { redirect: "other" } },
    ],
  },
];

export const findIdentityChallenge = (id: string) => identityChallenges.find((c) => c.id === id);
export const variantIds = (c: Challenge) => c.variants.map((v) => v.id);
/** The starting configuration of a configure variant, or rules of a policy variant: what the learner first sees. */
export const policyStart = (c: Extract<Challenge, { kind: "policy" }>, variant: string) => c.variants.find((v) => v.id === variant)!.start;
