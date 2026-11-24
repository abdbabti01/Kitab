// Identity & security labs. Code labs run the learner's JavaScript for real in the sandbox (Web Crypto included,
// where the lab says so); the HTTP lab sends real requests to Kitab's teaching resource server
// (worker/identity-lab.ts), which verifies pre-signed synthetic tokens. No real credentials, identity providers or
// tenants are involved; every user, key and token is synthetic.
import { draft, header, status, type CodeLab, type ComputerStep, type HttpLab, type Observation } from "../model.ts";
import { LAB_TOKENS } from "../../identity/lab-fixtures.ts";

const steps: ComputerStep[] = [
  { title: "Your code runs in a fresh sandbox", detail: "An isolated frame with no network and no access to Kitab's data, with a Web Worker inside it.", observed: false },
  { title: "Your functions are compiled and run", detail: "This browser's JavaScript engine runs your code; the tests call your functions with synthetic inputs.", observed: true },
  { title: "Every verdict comes from your code's real output", detail: "The tests compare what your functions returned or threw, and say what they expected.", observed: true },
];
const cryptoSteps: ComputerStep[] = [
  ...steps.slice(0, 2),
  { title: "Real cryptography", detail: "crypto.subtle (Web Crypto) computes SHA-256 hashes and creates and verifies ECDSA signatures in this browser. Keys are generated per run and discarded.", observed: true },
  steps[2],
];
const id = (stage: string) => ({ track: "identity" as const, stage });

const bearer = (token: string) => [{ name: "Authorization", value: `Bearer ${token}` }];
const check = (o: Observation) => header(o.response?.headers, "x-lab-check");

export const identityLabs: (CodeLab | HttpLab)[] = [
  {
    kind: "code", id: "auth-request", version: 1, subject: "identity",
    title: "Build a correct authorization request",
    summary: "Construct an OAuth 2.0 / OpenID Connect authorization URL with every required parameter, correctly encoded.",
    difficulty: "beginner", minutes: 15, modes: ["real-execution"],
    modeNote: "Your function really runs and the tests parse the URL it returns with the browser's URL parser. Nothing is sent to an identity provider.",
    objective: "Know every parameter of an Authorization Code + PKCE request, what it is for, and why values must be URL-encoded and secrets left out.",
    problem: "A team's sign-in link breaks whenever the redirect URI has a query string, the scope has spaces, or PKCE is turned on. It also leaks the client secret into browser history.",
    build: "Fix buildAuthorizationUrl(endpoint, request) so it uses URL and URLSearchParams, includes response_type=code and code_challenge_method=S256, and never includes a client secret.",
    canChange: "Everything in authorize.js.", tools: "Run prints the URL your function builds. Check parses it and inspects each parameter.",
    verify: "Run the starter and look at the printed URL: the scope's spaces and the redirect URI aren't encoded, and the secret is there.",
    success: "All tests pass: every required parameter present once, values decoded back exactly, method S256, no client_secret.",
    computer: steps, configs: [], terms: ["oauth", "pkce", "scope"],
    related: [{ label: "Learn: Authorization Code with PKCE", path: "/learn/identity/oauth-flows#auth-code-pkce", kind: "learn" }, { label: "Playground: see the request travel", path: "/practice/identity?scenario=oidc-login", kind: "playground" }],
    stages: [id("oauth"), id("oauth-flows")],
    file: "authorize.js",
    starter: `// buildAuthorizationUrl(endpoint, request) returns the URL the browser is redirected to.
// request: { clientId, redirectUri, scope, state, nonce, codeChallenge, clientSecret? }
function buildAuthorizationUrl(endpoint, request) {
  return endpoint + "?client_id=" + request.clientId + "&redirect_uri=" + request.redirectUri +
    "&scope=" + request.scope + "&state=" + request.state + "&code_challenge=" + request.codeChallenge +
    "&client_secret=" + request.clientSecret;
}

console.log(buildAuthorizationUrl("https://idp.example/authorize", {
  clientId: "app-web", redirectUri: "https://app.example/callback?from=menu", scope: "openid profile orders.read",
  state: "af0ifjsldkj", nonce: "n-0S6_WzA2Mj", codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", clientSecret: "synthetic-secret",
}));
`,
    solution: `function buildAuthorizationUrl(endpoint, request) {
  const url = new URL(endpoint);
  // URLSearchParams encodes every value; the secret is deliberately left out: it never goes through the browser.
  const params = {
    response_type: "code",
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    scope: request.scope,
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
  };
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

console.log(buildAuthorizationUrl("https://idp.example/authorize", {
  clientId: "app-web", redirectUri: "https://app.example/callback?from=menu", scope: "openid profile orders.read",
  state: "af0ifjsldkj", nonce: "n-0S6_WzA2Mj", codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", clientSecret: "synthetic-secret",
}));
`,
    exports: ["buildAuthorizationUrl"],
    tests: `
const request = { clientId: "app-web", redirectUri: "https://app.example/callback?from=menu&x=1", scope: "openid profile orders.read", state: "st&=?#", nonce: "n-1", codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", clientSecret: "synthetic-secret" };
const parsed = () => new URL(lab.buildAuthorizationUrl("https://idp.example/authorize", request));
test("it is a URL at the authorization endpoint", () => {
  const url = parsed();
  assert.equal(url.origin + url.pathname, "https://idp.example/authorize", "endpoint");
});
test("response_type is code, and PKCE uses S256", () => {
  const p = parsed().searchParams;
  assert.equal(p.get("response_type"), "code", "response_type");
  assert.equal(p.get("code_challenge"), request.codeChallenge, "code_challenge");
  assert.equal(p.get("code_challenge_method"), "S256", "code_challenge_method");
});
test("values survive encoding exactly (spaces, ?, &, =, #)", () => {
  const p = parsed().searchParams;
  assert.equal(p.get("redirect_uri"), request.redirectUri, "redirect_uri decoded back");
  assert.equal(p.get("scope"), request.scope, "scope decoded back");
  assert.equal(p.get("state"), request.state, "state decoded back");
  assert.equal(p.get("nonce"), request.nonce, "nonce");
  assert.equal(p.get("client_id"), "app-web", "client_id");
});
test("each parameter appears once, and the client secret never appears", () => {
  const p = parsed().searchParams;
  for (const name of new Set(p.keys())) assert.equal(p.getAll(name).length, 1, name + " appears once");
  assert.equal(p.get("client_secret"), null, "client_secret must not be in a front-channel URL");
  assert.ok(!parsed().toString().includes("synthetic-secret"), "the secret's value appears nowhere in the URL");
});
`,
    timeoutMs: 3000,
    hints: ["new URL(endpoint) then url.searchParams.set(name, value) encodes values for you.", "Add response_type=code and code_challenge_method=S256.", "Leave clientSecret out entirely: it belongs only in the back-channel token request of a confidential client."],
  },
  {
    kind: "code", id: "pkce", version: 1, subject: "identity",
    title: "Generate a PKCE verifier and challenge with Web Crypto",
    summary: "Create a high-entropy code_verifier and its S256 code_challenge using the browser's real cryptography, and match RFC 7636's test vector.",
    difficulty: "beginner", minutes: 15, modes: ["real-execution"],
    modeNote: "Your code calls this browser's real crypto.getRandomValues and crypto.subtle.digest('SHA-256'). The tests check your output against RFC 7636 Appendix B.",
    objective: "Generate unpredictable verifiers, compute BASE64URL(SHA-256(verifier)) exactly as RFC 7636 §4.2 defines it, and see why standard base64 and Math.random are wrong.",
    problem: "A single-page app's sign-in fails with invalid_grant at the token endpoint, and a review found its verifiers are generated with Math.random.",
    build: "Fix createVerifier() to use crypto.getRandomValues and base64url, and challengeFor(verifier) to hash with crypto.subtle.digest and encode as base64url without padding.",
    canChange: "Everything in pkce.js.", tools: "Run prints a pair. Check compares your challenge with RFC 7636's example and checks the verifier's length and alphabet.",
    verify: "Run the starter: its challenge contains +, / or = characters, which the authorization server's base64url computation never produces.",
    success: "All tests pass, including the RFC 7636 Appendix B vector.",
    computer: cryptoSteps, configs: [], terms: ["pkce"],
    related: [{ label: "Learn: Authorization Code with PKCE", path: "/learn/identity/oauth-flows#auth-code-pkce", kind: "learn" }, { label: "Experiment: a wrong verifier", path: "/practice/identity?experiment=id-state", kind: "playground" }],
    stages: [id("oauth-flows")],
    file: "pkce.js",
    starter: `// createVerifier(): a random code_verifier, 43-128 characters of A-Z a-z 0-9 - . _ ~
// challengeFor(verifier): BASE64URL(SHA-256(verifier)), no padding (RFC 7636 4.2)
async function createVerifier() {
  return Math.random().toString(36).slice(2).repeat(5);
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

const verifier = await createVerifier();
console.log("verifier:", verifier);
console.log("challenge:", await challengeFor(verifier));
`,
    solution: `function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
}

async function createVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits from the OS's secure generator
  return base64url(bytes); // 43 characters
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

const verifier = await createVerifier();
console.log("verifier:", verifier);
console.log("challenge:", await challengeFor(verifier));
`,
    exports: ["createVerifier", "challengeFor"],
    tests: `
test("RFC 7636 Appendix B: the example verifier gives the example challenge", async () => {
  assert.equal(await lab.challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM", "challengeFor(RFC example)");
});
test("a verifier has 43 to 128 unreserved characters", async () => {
  const v = await lab.createVerifier();
  assert.ok(typeof v === "string" && v.length >= 43 && v.length <= 128, "length " + (v && v.length));
  assert.ok(/^[A-Za-z0-9._~-]+$/.test(v), "only A-Z a-z 0-9 - . _ ~ allowed: " + v);
});
test("verifiers are unpredictable: 20 in a row are all different", async () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) seen.add(await lab.createVerifier());
  assert.equal(seen.size, 20, "distinct verifiers");
});
test("a challenge is base64url without padding: 43 characters, no + / =", async () => {
  const c = await lab.challengeFor(await lab.createVerifier());
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(c), "challenge " + c);
});
`,
    timeoutMs: 4000,
    hints: ["crypto.getRandomValues(new Uint8Array(32)) gives 32 secure random bytes.", "base64url: base64, then + → -, / → _, and drop trailing =.", "The challenge hashes the verifier's characters, not the random bytes."],
  },
  {
    kind: "code", id: "callback", version: 1, subject: "identity",
    title: "Validate an authorization callback",
    summary: "Accept an authorization response only when it answers this browser's own request: check error, state, issuer and single use.",
    difficulty: "intermediate", minutes: 20, modes: ["real-execution"],
    modeNote: "Your function really runs against synthetic callback URLs built by the tests. No identity provider is contacted.",
    objective: "Reject forged callbacks (login CSRF), mix-up attacks and replays before any code is redeemed.",
    problem: "An app signs users into the wrong account when they click a crafted link, because its callback handler redeems any code it receives.",
    build: "Fix handleCallback(callbackUrl, pending) to return the code only if there is no error parameter, state equals pending.state exactly, iss equals pending.issuer, and the pending request hasn't been used; mark it used.",
    canChange: "Everything in callback.js.", tools: "Run tries a forged callback. Check tries good, forged, replayed and error callbacks.",
    verify: "Run the starter: it returns the attacker's code.",
    success: "All tests pass: only a fresh callback with matching state and issuer yields a code, exactly once.",
    computer: steps, configs: [], terms: ["oauth", "csrf"],
    related: [{ label: "Learn: state, PKCE and nonce", path: "/learn/identity/oauth-flows#state-pkce-nonce", kind: "learn" }, { label: "Experiment: a callback this browser never asked for", path: "/practice/identity?experiment=id-state", kind: "playground" }],
    stages: [id("oauth-flows"), id("oidc")],
    file: "callback.js",
    starter: `// handleCallback(callbackUrl, pending) returns the authorization code, or throws an Error.
// pending: { state, issuer, used } is what this browser stored when it started sign-in.
function handleCallback(callbackUrl, pending) {
  const params = new URL(callbackUrl).searchParams;
  return params.get("code");
}

const pending = { state: "af0ifjsldkj", issuer: "https://idp.example", used: false };
console.log(handleCallback("https://app.example/callback?code=ATTACKER&state=not-yours&iss=https%3A%2F%2Fidp.example", pending));
`,
    solution: `function handleCallback(callbackUrl, pending) {
  const params = new URL(callbackUrl).searchParams;
  if (params.has("error")) throw new Error("authorization failed: " + params.get("error"));
  if (!pending || pending.used) throw new Error("no pending sign-in (or it was already used)");
  const state = params.get("state");
  if (!state || state !== pending.state) throw new Error("state mismatch");
  if (params.get("iss") !== pending.issuer) throw new Error("unexpected issuer");
  const code = params.get("code");
  if (!code) throw new Error("no code");
  pending.used = true;
  return code;
}

const pending = { state: "af0ifjsldkj", issuer: "https://idp.example", used: false };
try {
  console.log(handleCallback("https://app.example/callback?code=ATTACKER&state=not-yours&iss=https%3A%2F%2Fidp.example", pending));
} catch (e) { console.log("refused:", e.message); }
`,
    exports: ["handleCallback"],
    tests: `
const fresh = () => ({ state: "af0ifjsldkj", issuer: "https://idp.example", used: false });
const url = (q) => "https://app.example/callback?" + new URLSearchParams(q).toString();
test("a matching callback returns its code", () => {
  assert.equal(lab.handleCallback(url({ code: "c-1", state: "af0ifjsldkj", iss: "https://idp.example" }), fresh()), "c-1", "code");
});
test("a different or missing state is refused (login CSRF)", () => {
  assert.throws(() => lab.handleCallback(url({ code: "c-1", state: "attacker", iss: "https://idp.example" }), fresh()), undefined, "wrong state");
  assert.throws(() => lab.handleCallback(url({ code: "c-1", iss: "https://idp.example" }), fresh()), undefined, "missing state");
  assert.throws(() => lab.handleCallback(url({ code: "c-1", state: "af0ifjsldkj ", iss: "https://idp.example" }), fresh()), undefined, "state with a trailing space");
});
test("a response from another issuer is refused (mix-up)", () => {
  assert.throws(() => lab.handleCallback(url({ code: "c-1", state: "af0ifjsldkj", iss: "https://evil.example" }), fresh()), undefined, "wrong iss");
});
test("an error response is refused, even with a valid state", () => {
  assert.throws(() => lab.handleCallback(url({ error: "access_denied", state: "af0ifjsldkj", iss: "https://idp.example" }), fresh()), undefined, "error=access_denied");
});
test("a pending sign-in works once: a replayed callback is refused", () => {
  const p = fresh();
  lab.handleCallback(url({ code: "c-1", state: "af0ifjsldkj", iss: "https://idp.example" }), p);
  assert.throws(() => lab.handleCallback(url({ code: "c-1", state: "af0ifjsldkj", iss: "https://idp.example" }), p), undefined, "second use");
});
`,
    timeoutMs: 3000,
    hints: ["Check error first, then whether this pending request is still unused.", "Compare state with ===; a missing state must fail too.", "Set pending.used = true just before returning the code."],
  },
  {
    kind: "code", id: "redirect-uri", version: 1, subject: "identity",
    title: "Diagnose a broken redirect URI check",
    summary: "An authorization server's redirect URI check uses startsWith. Find what it lets through, then implement RFC 9700's exact matching with RFC 8252's loopback exception.",
    difficulty: "intermediate", minutes: 20, modes: ["real-execution"],
    modeNote: "Your matching function really runs against synthetic URIs. No authorization server is involved.",
    objective: "See how prefix matching delivers codes to attackers, and implement exact string matching, allowing only the port to vary for loopback redirect URIs of native apps.",
    problem: "Security testing showed that codes can be sent to https://app.example/callback.attacker.example/ and https://app.example/callback/../open-redirect.",
    build: "Fix isAllowedRedirect(registered, requested): exact string match; additionally, if a registered URI is http://127.0.0.1 or http://[::1] with some port, the same URI with any port is allowed.",
    canChange: "Everything in redirect.js.", tools: "Run prints which test URIs the check allows. Check tests exact, near-miss and loopback cases.",
    verify: "Run the starter: the attacker URIs are allowed.",
    success: "All tests pass: only exact matches, plus loopback with any port.",
    computer: steps, configs: [], terms: ["oauth"],
    related: [{ label: "Learn: redirect URI validation", path: "/learn/identity/oauth-flows#redirect-validation", kind: "learn" }, { label: "Experiment: one extra slash", path: "/practice/identity?experiment=id-redirect", kind: "playground" }],
    stages: [id("oauth-flows"), id("failures")],
    file: "redirect.js",
    starter: `// isAllowedRedirect(registered, requested): may the authorization server redirect to requested?
// registered is the client's list of registered redirect URIs.
function isAllowedRedirect(registered, requested) {
  return registered.some((uri) => requested.startsWith(uri));
}

const registered = ["https://app.example/callback"];
for (const uri of ["https://app.example/callback", "https://app.example/callback.attacker.example/", "https://app.example/callback/../open"]) {
  console.log(isAllowedRedirect(registered, uri) ? "allowed " : "refused ", uri);
}
`,
    solution: `const LOOPBACK = /^http:\\/\\/(127\\.0\\.0\\.1|\\[::1\\]):(\\d{1,5})(\\/.*)?$/;

function isAllowedRedirect(registered, requested) {
  return registered.some((uri) => {
    if (uri === requested) return true; // RFC 9700 2.1: exact string matching
    // RFC 8252 7.3: for loopback redirect URIs of native apps, only the port may differ.
    const a = LOOPBACK.exec(uri), b = LOOPBACK.exec(requested);
    return !!a && !!b && a[1] === b[1] && (a[3] || "") === (b[3] || "");
  });
}

const registered = ["https://app.example/callback"];
for (const uri of ["https://app.example/callback", "https://app.example/callback.attacker.example/", "https://app.example/callback/../open"]) {
  console.log(isAllowedRedirect(registered, uri) ? "allowed " : "refused ", uri);
}
`,
    exports: ["isAllowedRedirect"],
    tests: `
const reg = ["https://app.example/callback", "http://127.0.0.1:8400/native-cb"];
test("the exact registered URI is allowed", () => {
  assert.equal(lab.isAllowedRedirect(reg, "https://app.example/callback"), true, "exact");
});
test("prefix tricks are refused", () => {
  for (const uri of ["https://app.example/callback.attacker.example/", "https://app.example/callback/../open", "https://app.example/callback?next=https://attacker.example", "https://app.example/callbackx"]) {
    assert.equal(lab.isAllowedRedirect(reg, uri), false, uri);
  }
});
test("near misses are refused: a trailing slash, another scheme, case, another host", () => {
  for (const uri of ["https://app.example/callback/", "http://app.example/callback", "https://APP.example/callback", "https://app.example.attacker.example/callback"]) {
    assert.equal(lab.isAllowedRedirect(reg, uri), false, uri);
  }
});
test("loopback for native apps: any port, same address and path", () => {
  assert.equal(lab.isAllowedRedirect(reg, "http://127.0.0.1:51004/native-cb"), true, "another port");
  assert.equal(lab.isAllowedRedirect(reg, "http://127.0.0.1:51004/other"), false, "another path");
  assert.equal(lab.isAllowedRedirect(reg, "http://localhost:51004/native-cb"), false, "localhost isn't the registered loopback address");
  assert.equal(lab.isAllowedRedirect(["https://app.example/callback"], "http://127.0.0.1:51004/native-cb"), false, "no loopback registered");
});
`,
    timeoutMs: 3000,
    hints: ["Start with uri === requested.", "Then handle the loopback case with a regular expression capturing the address, port and path.", "Compare address and path; ignore the port."],
  },
  {
    kind: "code", id: "jwt-claims", version: 1, subject: "identity",
    title: "Decode a JWT and validate its claims",
    summary: "Decode base64url JWT segments correctly, then check iss, aud, exp, nbf and required claims, with clock skew.",
    difficulty: "intermediate", minutes: 25, modes: ["real-execution"],
    modeNote: "Your code really decodes and checks synthetic tokens. This lab checks claims only; signature verification is the next lab, and the tests remind you that decoding proves nothing on its own.",
    objective: "Decode JWT payloads (base64url, UTF-8) and validate every time and audience claim the way a careful library does.",
    problem: "An API accepts tokens for other APIs, tokens that expired an hour ago, and crashes on names with accented characters.",
    build: "Fix decodePayload(token) (base64url, UTF-8) and validateClaims(payload, expected) so it returns the names of the checks that fail: iss, aud, exp, nbf, or the missing claim's name.",
    canChange: "Everything in claims.js.", tools: "Run decodes a sample. Check runs tokens with wrong issuers, audiences (string and array), times and missing claims.",
    verify: "Run the starter on the sample token: decoding throws on base64url characters.",
    success: "All tests pass: correct decoding and exactly the failing checks named.",
    computer: steps, configs: [], terms: ["jwt", "claim", "audience"],
    related: [{ label: "Learn: decoding is not validating", path: "/learn/identity/tokens#decode-vs-validate", kind: "learn" }, { label: "Token Inspector", path: "/practice/identity/tokens", kind: "playground" }],
    stages: [id("oidc"), id("tokens")],
    file: "claims.js",
    starter: `// decodePayload(token): the payload object of a compact JWT (header.payload.signature).
// validateClaims(payload, { issuer, audience, now, skew, required }) returns an array naming each failed check:
//   "iss", "aud", "exp", "nbf", or the name of a required claim that is missing. [] means every check passed.
function decodePayload(token) {
  return JSON.parse(atob(token.split(".")[1]));
}

function validateClaims(payload, expected) {
  const failed = [];
  if (payload.iss !== expected.issuer) failed.push("iss");
  if (payload.aud !== expected.audience) failed.push("aud");
  if (payload.exp < expected.now) failed.push("exp");
  return failed;
}

const sample = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLT4_IiwibmFtZSI6IkrDqXLDtG1lIn0.c2ln";
console.log(decodePayload(sample));
`,
    solution: `function decodePayload(token) {
  const part = token.split(".")[1];
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)); // UTF-8, not Latin-1
}

function validateClaims(payload, expected) {
  const failed = [];
  if (payload.iss !== expected.issuer) failed.push("iss");
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(expected.audience)) failed.push("aud");
  if (typeof payload.exp !== "number" || expected.now >= payload.exp + expected.skew) failed.push("exp");
  if (typeof payload.nbf === "number" && expected.now < payload.nbf - expected.skew) failed.push("nbf");
  for (const claim of expected.required || []) if (payload[claim] === undefined) failed.push(claim);
  return failed;
}

const sample = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLT4_IiwibmFtZSI6IkrDqXLDtG1lIn0.c2ln";
console.log(decodePayload(sample));
`,
    exports: ["decodePayload", "validateClaims"],
    tests: `
const enc = (obj) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj)))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const tok = (payload) => enc({ alg: "RS256" }) + "." + enc(payload) + ".c2ln";
const expected = { issuer: "https://idp.example", audience: "https://api.example", now: 1800000000, skew: 60, required: ["sub"] };
const good = { iss: "https://idp.example", aud: "https://api.example", sub: "u1", exp: 1800000300, nbf: 1799999990 };
test("decodes base64url and UTF-8 (a name with accents, a ? and > in the subject)", () => {
  const p = lab.decodePayload(tok({ sub: "user->?", name: "Jérôme" }));
  assert.equal(p, { sub: "user->?", name: "Jérôme" }, "decoded payload");
});
test("a good payload passes every check", () => {
  assert.equal(lab.validateClaims(good, expected), [], "failed checks");
});
test("audience: exact match, string or array", () => {
  assert.equal(lab.validateClaims({ ...good, aud: ["https://other.example", "https://api.example"] }, expected), [], "array containing the API");
  assert.equal(lab.validateClaims({ ...good, aud: "https://hr.example" }, expected), ["aud"], "another API");
  assert.equal(lab.validateClaims({ ...good, aud: ["https://hr.example"] }, expected), ["aud"], "array without the API");
});
test("time: exp and nbf with skew", () => {
  assert.equal(lab.validateClaims({ ...good, exp: 1799999970 }, expected), [], "expired 30 s ago: inside the 60 s skew");
  assert.equal(lab.validateClaims({ ...good, exp: 1799999900 }, expected), ["exp"], "expired 100 s ago");
  assert.equal(lab.validateClaims({ ...good, nbf: 1800000600 }, expected), ["nbf"], "not valid for 10 more minutes");
  assert.equal(lab.validateClaims({ ...good, exp: undefined }, expected), ["exp"], "no exp at all");
});
test("issuer and required claims", () => {
  assert.equal(lab.validateClaims({ ...good, iss: "https://idp.example.attacker.example" }, expected), ["iss"], "issuer");
  assert.equal(lab.validateClaims({ ...good, sub: undefined }, expected), ["sub"], "missing sub");
});
`,
    timeoutMs: 3000,
    hints: ["base64url uses - and _ and drops padding: swap them back and re-pad before atob.", "atob returns bytes as characters; turn them into a Uint8Array and decode with TextDecoder for UTF-8.", "aud can be a string or an array; normalise to an array and use includes on the array.", "Accept until now >= exp + skew; reject while now < nbf - skew."],
  },
  {
    kind: "code", id: "jwks-verify", version: 1, subject: "identity",
    title: "Select a key from a JWKS and verify a signature",
    summary: "Verify ES256-signed JWTs for real with Web Crypto: pick the key by kid from a JWKS, enforce the algorithm allowlist, and verify the signature.",
    difficulty: "advanced", minutes: 30, modes: ["real-execution"],
    modeNote: "Real cryptography: the tests generate an ECDSA P-256 key pair in this browser, sign tokens with it, and your code verifies them with crypto.subtle. Keys exist only for the run.",
    objective: "Verify JWT signatures correctly: kid lookup in the trusted set, alg allowlist (no none, no HS256 confusion), key/alg agreement, signature over header.payload.",
    problem: "An API's verifier returns true for any token whose kid it knows. Attackers forge tokens by editing the payload.",
    build: "Fix verifyJwt(token, jwks, allowedAlgs) to return true only when the header's alg is allowed, a key with that kid exists and has the same alg, and crypto.subtle.verify accepts the signature.",
    canChange: "Everything in verify.js.", tools: "Run checks one forged token. Check runs genuine, tampered, re-signed, unknown-kid, alg:none and HS256 tokens.",
    verify: "Run the starter: the forged token is accepted.",
    success: "All tests pass: only the genuine token verifies.",
    computer: cryptoSteps,
    configs: [{
      name: "jwks_uri", what: "The URL where an issuer publishes the public keys that verify its signatures, as a JSON Web Key Set.",
      why: "Verifiers find the right key by kid, and pick up new keys when the issuer rotates them, without redeploying.",
      where: "In the issuer's discovery document (/.well-known/openid-configuration), read by your JWT library or framework.",
      who: "Published by the identity provider; consumed by every client and API that verifies its tokens.",
      change: "You don't: configure your library with the issuer (Authority / issuer-uri) and it reads jwks_uri.",
      verify: "Fetch the discovery document and the JWKS (the HTTP lab does this) and compare kid values with a token's header.",
      effect: "A verifier that never refreshes its cached JWKS rejects tokens signed with a new key; one that fetches keys from URLs inside tokens trusts attackers.",
      kitab: "Real: your code verifies with Web Crypto. The JWKS in the tests is generated per run.",
    }],
    terms: ["jwt"],
    related: [{ label: "Learn: JWS, keys and rotation", path: "/learn/identity/tokens#jws-jwe-keys", kind: "learn" }, { label: "Token Inspector", path: "/practice/identity/tokens", kind: "playground" }],
    stages: [id("tokens")],
    file: "verify.js",
    starter: `// verifyJwt(token, jwks, allowedAlgs) -> Promise<boolean>
// jwks: { keys: [ { kty, crv, x, y, kid, alg, use } ] }  allowedAlgs: e.g. ["ES256"]
function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function verifyJwt(token, jwks, allowedAlgs) {
  const [h] = token.split(".");
  const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
  return jwks.keys.some((k) => k.kid === header.kid); // knows the key... but never checks the signature!
}

const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
const forged = enc({ alg: "ES256", kid: "k1" }) + "." + enc({ sub: "admin" }) + ".AAAA";
console.log("forged token accepted:", await verifyJwt(forged, { keys: [{ kid: "k1", alg: "ES256", kty: "EC" }] }, ["ES256"]));
`,
    solution: `function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const PARAMS = { ES256: { import: { name: "ECDSA", namedCurve: "P-256" }, verify: { name: "ECDSA", hash: "SHA-256" } } };

async function verifyJwt(token, jwks, allowedAlgs) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[0])));
    if (!allowedAlgs.includes(header.alg) || !PARAMS[header.alg]) return false; // no "none", no HS256
    const jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk || jwk.alg !== header.alg) return false;
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, PARAMS[header.alg].import, false, ["verify"]);
    return await crypto.subtle.verify(PARAMS[header.alg].verify, key, b64urlToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  } catch {
    return false; // anything malformed is simply not verified
  }
}

const enc = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\\+/g, "-").replace(/\\//g, "_");
const forged = enc({ alg: "ES256", kid: "k1" }) + "." + enc({ sub: "admin" }) + ".AAAA";
console.log("forged token accepted:", await verifyJwt(forged, { keys: [{ kid: "k1", alg: "ES256", kty: "EC" }] }, ["ES256"]));
`,
    exports: ["verifyJwt"],
    tests: `
const enc = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
const json = (o) => enc(new TextEncoder().encode(JSON.stringify(o)));
async function keyPair(kid) {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, jwk: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid, alg: "ES256", use: "sig" } };
}
async function sign(header, payload, privateKey) {
  const input = json(header) + "." + json(payload);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(input)));
  return input + "." + enc(sig);
}
const ctx = (async () => {
  const issuer = await keyPair("k1"), attacker = await keyPair("k1");
  const payload = { iss: "https://idp.example", sub: "alice", scope: "orders.read" };
  const genuine = await sign({ alg: "ES256", kid: "k1" }, payload, issuer.privateKey);
  return { jwks: { keys: [issuer.jwk] }, genuine, payload, issuer, attacker };
})();
test("a genuine token verifies", async () => {
  const { jwks, genuine } = await ctx;
  assert.equal(await lab.verifyJwt(genuine, jwks, ["ES256"]), true, "genuine");
});
test("a payload edited after signing fails", async () => {
  const { jwks, genuine, payload } = await ctx;
  const [h, , s] = genuine.split(".");
  assert.equal(await lab.verifyJwt(h + "." + json({ ...payload, scope: "orders.read orders.delete" }) + "." + s, jwks, ["ES256"]), false, "tampered");
});
test("another key, even with the trusted kid, fails", async () => {
  const { jwks, payload, attacker } = await ctx;
  assert.equal(await lab.verifyJwt(await sign({ alg: "ES256", kid: "k1" }, payload, attacker.privateKey), jwks, ["ES256"]), false, "signed by the attacker");
});
test("an unknown kid fails", async () => {
  const { jwks, payload, issuer } = await ctx;
  assert.equal(await lab.verifyJwt(await sign({ alg: "ES256", kid: "k9" }, payload, issuer.privateKey), jwks, ["ES256"]), false, "kid k9");
});
test("alg none and HS256 are refused (algorithm confusion)", async () => {
  const { jwks, payload } = await ctx;
  assert.equal(await lab.verifyJwt(json({ alg: "none", kid: "k1" }) + "." + json(payload) + ".", jwks, ["ES256"]), false, "alg none");
  assert.equal(await lab.verifyJwt(json({ alg: "HS256", kid: "k1" }) + "." + json(payload) + "." + enc(new Uint8Array(32)), jwks, ["ES256"]), false, "alg HS256");
});
test("garbage is false, not an exception", async () => {
  const { jwks } = await ctx;
  assert.equal(await lab.verifyJwt("not-a-token", jwks, ["ES256"]), false, "garbage");
});
`,
    timeoutMs: 6000,
    hints: ["Check alg against allowedAlgs before anything else.", "Find the key by kid and make sure its alg matches the header's.", "crypto.subtle.importKey('jwk', {...}, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']), then crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signatureBytes, bytesOf(header + '.' + payload)).", "Wrap everything in try/catch and return false on any error."],
  },
  {
    kind: "code", id: "audience-bug", version: 1, subject: "identity",
    title: "Debug an audience check",
    summary: "An API's audience check uses includes() on a string. Find the tokens it wrongly accepts and fix it.",
    difficulty: "beginner", minutes: 10, modes: ["real-execution"],
    modeNote: "Your function really runs against synthetic aud values. No tokens are verified here: this is the one comparison.",
    objective: "Compare security identifiers exactly, and handle aud as a string or an array, as RFC 7519 §4.1.3 allows.",
    problem: "A staging token with aud https://api.example.staging works in production, because 'https://api.example.staging'.includes('https://api.example') is true.",
    build: "Fix acceptsAudience(aud, expected): exact equality for a string, exact membership for an array, false for anything else.",
    canChange: "Everything in audience.js.", tools: "Run prints the starter's verdicts. Check tries strings, arrays, near misses and odd values.",
    verify: "Run the starter: the staging audience is accepted.",
    success: "All tests pass: exact matches only, for strings and arrays, and odd values refused without crashing.",
    computer: steps, configs: [], terms: ["audience"],
    related: [{ label: "Learn: weak token validation", path: "/learn/identity/failures#weak-validation", kind: "learn" }, { label: "Experiment: a valid token at the wrong API", path: "/practice/identity?experiment=id-audience", kind: "playground" }],
    stages: [id("tokens"), id("failures")],
    file: "audience.js",
    starter: `// acceptsAudience(aud, expected): does a token whose aud claim is aud belong to the API expected?
function acceptsAudience(aud, expected) {
  return aud.includes(expected);
}

for (const aud of ["https://api.example", "https://api.example.staging", ["https://hr.example", "https://api.example"]]) {
  console.log(JSON.stringify(aud), "->", acceptsAudience(aud, "https://api.example"));
}
`,
    solution: `function acceptsAudience(aud, expected) {
  if (typeof aud === "string") return aud === expected;
  if (Array.isArray(aud)) return aud.some((value) => value === expected);
  return false;
}

for (const aud of ["https://api.example", "https://api.example.staging", ["https://hr.example", "https://api.example"]]) {
  console.log(JSON.stringify(aud), "->", acceptsAudience(aud, "https://api.example"));
}
`,
    exports: ["acceptsAudience"],
    tests: `
const API = "https://api.example";
test("the exact audience, as a string or in an array", () => {
  assert.equal(lab.acceptsAudience(API, API), true, "string");
  assert.equal(lab.acceptsAudience(["https://hr.example", API], API), true, "array");
});
test("substring audiences are refused", () => {
  assert.equal(lab.acceptsAudience("https://api.example.staging", API), false, "longer string");
  assert.equal(lab.acceptsAudience("https://api.exam", API), false, "shorter string");
});
test("an array element must match exactly too", () => {
  assert.equal(lab.acceptsAudience(["https://api.example.staging"], API), false, "array with a near miss");
  assert.equal(lab.acceptsAudience([], API), false, "empty array");
});
test("missing or odd values are refused, not crashed on", () => {
  assert.equal(lab.acceptsAudience(undefined, API), false, "undefined");
  assert.equal(lab.acceptsAudience(42, API), false, "number");
  assert.equal(lab.acceptsAudience({ aud: API }, API), false, "object");
});
`,
    timeoutMs: 3000,
    hints: ["String.prototype.includes is a substring test.", "Array.isArray tells the two shapes apart; compare with ===."],
  },
  {
    kind: "code", id: "scope-authz", version: 1, subject: "identity",
    title: "Build a scope-based API authorization decision",
    summary: "Return the right status and WWW-Authenticate header for missing, misdirected and under-scoped tokens, as RFC 6750 specifies.",
    difficulty: "intermediate", minutes: 20, modes: ["real-execution"],
    modeNote: "Your decision function really runs on synthetic, already-validated claims. Signature validation is a separate step (see the JWKS lab).",
    objective: "Tell 401 (no acceptable credential) from 403 (credential fine, permission missing), and say why in the WWW-Authenticate header.",
    problem: "An API answers 200 to any request with any token, and 500 when the header is missing.",
    build: "Fix authorize(claims, method): 401 with 'Bearer' when claims is null; 401 with error=\"invalid_token\" when aud isn't https://api.example; 403 with error=\"insufficient_scope\" and the needed scope when it's missing (GET needs orders.read, anything else orders.write); otherwise 200.",
    canChange: "Everything in authorize.js.", tools: "Run prints decisions for a few requests. Check covers each case.",
    verify: "Run the starter: every request gets 200.",
    success: "All tests pass: the right status and header for each case.",
    computer: steps, configs: [], terms: ["scope", "audience"],
    related: [{ label: "Learn: roles, permissions, scopes and claims", path: "/learn/identity/authorization#vocabulary", kind: "learn" }, { label: "Authorization Playground", path: "/practice/identity/authorization", kind: "playground" }],
    stages: [id("authorization")],
    file: "authorize.js",
    starter: `// authorize(claims, method) -> { status, wwwAuthenticate? }
// claims: the validated token's claims, or null when no token was sent. The API is https://api.example.
function authorize(claims, method) {
  return { status: 200 };
}

console.log(authorize(null, "GET"));
console.log(authorize({ aud: "https://api.example", scope: "orders.read" }, "DELETE"));
`,
    solution: `const API = "https://api.example";

function authorize(claims, method) {
  if (!claims) return { status: 401, wwwAuthenticate: "Bearer" };
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(API)) return { status: 401, wwwAuthenticate: 'Bearer error="invalid_token"' };
  const needed = method === "GET" ? "orders.read" : "orders.write";
  const scopes = typeof claims.scope === "string" ? claims.scope.split(" ") : [];
  if (!scopes.includes(needed)) return { status: 403, wwwAuthenticate: 'Bearer error="insufficient_scope", scope="' + needed + '"' };
  return { status: 200 };
}

console.log(authorize(null, "GET"));
console.log(authorize({ aud: "https://api.example", scope: "orders.read" }, "DELETE"));
`,
    exports: ["authorize"],
    tests: `
const A = "https://api.example";
test("no token: 401 with a Bearer challenge", () => {
  assert.equal(lab.authorize(null, "GET"), { status: 401, wwwAuthenticate: "Bearer" }, "no token");
});
test("a token for another API: 401 invalid_token", () => {
  assert.equal(lab.authorize({ aud: "https://hr.example", scope: "orders.read" }, "GET"), { status: 401, wwwAuthenticate: 'Bearer error="invalid_token"' }, "wrong aud");
});
test("a token without the needed scope: 403 insufficient_scope naming the scope", () => {
  assert.equal(lab.authorize({ aud: A, scope: "orders.read" }, "DELETE"), { status: 403, wwwAuthenticate: 'Bearer error="insufficient_scope", scope="orders.write"' }, "DELETE with read scope");
  assert.equal(lab.authorize({ aud: A, scope: "orders.readwrite" }, "GET"), { status: 403, wwwAuthenticate: 'Bearer error="insufficient_scope", scope="orders.read"' }, "a scope that merely contains the text");
  assert.equal(lab.authorize({ aud: A }, "GET"), { status: 403, wwwAuthenticate: 'Bearer error="insufficient_scope", scope="orders.read"' }, "no scope claim");
});
test("the right scope: 200", () => {
  assert.equal(lab.authorize({ aud: [A], scope: "openid orders.read" }, "GET"), { status: 200 }, "GET");
  assert.equal(lab.authorize({ aud: A, scope: "orders.write" }, "POST"), { status: 200 }, "POST");
});
`,
    timeoutMs: 3000,
    hints: ["Order matters: no token, then wrong audience, then scope.", "Split the scope string on spaces and look for the exact scope."],
  },
  {
    kind: "code", id: "policy", version: 1, subject: "identity",
    title: "Write a role, attribute and tenant policy",
    summary: "Implement the orders policy from the Authorization Playground in code: deny by default, tenant isolation, ownership, roles and refund limits.",
    difficulty: "intermediate", minutes: 25, modes: ["real-execution"],
    modeNote: "Your policy function really runs against the same synthetic users and orders as the Authorization Playground; the tests are its request suite.",
    objective: "Turn RBAC, ownership (ReBAC) and ABAC rules into one deny-by-default function that never leaks across tenants.",
    problem: "The current policy checks only roles: customers read each other's orders and a Globex admin reads Acme's.",
    build: "Fix canAccess(user, action, order): same tenant always; customers read only their own orders; support read any and refund open orders up to 500; finance managers read and refund any open order; admins read, refund and delete; everything else denied.",
    canChange: "Everything in policy.js.", tools: "Run prints a few decisions. Check runs the full request suite.",
    verify: "Run the starter: Alice can read Frank's order.",
    success: "All tests pass: no unauthorized access, no legitimate access blocked.",
    computer: steps, configs: [], terms: ["rbac", "tenant"],
    related: [{ label: "Learn: RBAC, ABAC, policies and relationships", path: "/learn/identity/authorization#models", kind: "learn" }, { label: "Authorization Playground", path: "/practice/identity/authorization", kind: "playground" }],
    stages: [id("authorization")],
    file: "policy.js",
    starter: `// canAccess(user, action, order) -> boolean. Deny by default.
// user: { id, tenant, role: "customer"|"support"|"manager"|"admin", department }
// order: { id, tenant, owner, amount, status: "open"|"shipped" }   action: "read"|"refund"|"delete"
const permissions = { customer: ["read"], support: ["read", "refund"], manager: ["read", "refund"], admin: ["read", "refund", "delete"] };

function canAccess(user, action, order) {
  return permissions[user.role].includes(action);
}

const alice = { id: "alice", tenant: "acme", role: "customer" };
console.log("alice reads frank's order:", canAccess(alice, "read", { id: "124", tenant: "acme", owner: "frank", amount: 900, status: "open" }));
`,
    solution: `const permissions = { customer: ["read"], support: ["read", "refund"], manager: ["read", "refund"], admin: ["read", "refund", "delete"] };

function canAccess(user, action, order) {
  if (!user || !order || user.tenant !== order.tenant) return false;         // tenant isolation, whatever the role
  if (!(permissions[user.role] || []).includes(action)) return false;          // RBAC; unknown roles get nothing
  if (user.role === "customer" && order.owner !== user.id) return false;       // ownership
  if (action === "refund") {                                                   // ABAC
    if (order.status !== "open") return false;
    if (user.role === "support") return order.amount <= 500;
    if (user.role === "manager") return user.department === "finance";
    return user.role === "admin";
  }
  return true;
}

const alice = { id: "alice", tenant: "acme", role: "customer" };
console.log("alice reads frank's order:", canAccess(alice, "read", { id: "124", tenant: "acme", owner: "frank", amount: 900, status: "open" }));
`,
    exports: ["canAccess"],
    tests: `
const U = { alice: { id: "alice", tenant: "acme", role: "customer" }, bob: { id: "bob", tenant: "acme", role: "support", department: "support" }, carol: { id: "carol", tenant: "acme", role: "manager", department: "finance" }, mia: { id: "mia", tenant: "acme", role: "manager", department: "sales" }, erin: { id: "erin", tenant: "acme", role: "admin" }, dave: { id: "dave", tenant: "globex", role: "admin" }, eve: { id: "eve", tenant: "acme", role: "intern" } };
const O = { o123: { id: "123", tenant: "acme", owner: "alice", amount: 120, status: "open" }, o124: { id: "124", tenant: "acme", owner: "frank", amount: 900, status: "open" }, o125: { id: "125", tenant: "acme", owner: "alice", amount: 60, status: "shipped" } };
test("customers: their own orders only, read only", () => {
  assert.equal(lab.canAccess(U.alice, "read", O.o123), true, "alice reads 123");
  assert.equal(lab.canAccess(U.alice, "read", O.o124), false, "alice reads frank's 124");
  assert.equal(lab.canAccess(U.alice, "refund", O.o123), false, "alice refunds 123");
});
test("refund conditions: open orders, support up to 500, finance managers any amount", () => {
  assert.equal(lab.canAccess(U.bob, "refund", O.o123), true, "bob refunds 120");
  assert.equal(lab.canAccess(U.bob, "refund", O.o124), false, "bob refunds 900");
  assert.equal(lab.canAccess(U.carol, "refund", O.o124), true, "carol (finance) refunds 900");
  assert.equal(lab.canAccess(U.mia, "refund", O.o123), false, "mia (sales manager) refunds");
  assert.equal(lab.canAccess(U.bob, "refund", O.o125), false, "refund of a shipped order");
});
test("tenant isolation beats roles", () => {
  assert.equal(lab.canAccess(U.dave, "read", O.o123), false, "Globex admin reads an Acme order");
  assert.equal(lab.canAccess(U.dave, "delete", O.o124), false, "Globex admin deletes an Acme order");
});
test("deletes: admins only; unknown roles: nothing", () => {
  assert.equal(lab.canAccess(U.erin, "delete", O.o124), true, "erin deletes");
  assert.equal(lab.canAccess(U.bob, "delete", O.o124), false, "bob deletes");
  assert.equal(lab.canAccess(U.eve, "read", O.o123), false, "an unknown role reads");
});
`,
    timeoutMs: 3000,
    hints: ["Check the tenant first and return false: no role crosses tenants.", "Unknown roles must not throw: (permissions[role] || []).", "Write the refund rule as its own block after the generic checks."],
  },
  {
    kind: "code", id: "refresh-single-flight", version: 1, subject: "identity",
    title: "Refresh tokens without a stampede",
    summary: "Coordinate token refresh in a client: renew shortly before expiry, let concurrent callers share one refresh, and always use the newest rotated refresh token.",
    difficulty: "advanced", minutes: 30, modes: ["real-execution"],
    modeNote: "Your client really runs with real promises and timers. The token endpoint is a scripted stand-in the tests control (it rotates refresh tokens and rejects reused ones), and the clock is injected.",
    objective: "Avoid refresh stampedes and refresh-token reuse: one refresh at a time, renewal ahead of expiry, rotation handled, failures not cached forever.",
    problem: "When an access token expires, ten parallel API calls each refresh it. With rotation on, nine of those refreshes reuse a spent refresh token, the server detects reuse and revokes the session.",
    build: "Fix createTokenClient({ refresh, now, tokens }) so getAccessToken() returns the current token while it has more than 30 s left, otherwise performs exactly one refresh(refreshToken) shared by all callers, stores the rotated tokens, and lets a later call retry after a failure.",
    canChange: "Everything in tokens.js.", tools: "Run simulates ten parallel calls at expiry. Check counts refresh calls and the refresh tokens they used.",
    verify: "Run the starter: ten refreshes, nine with a spent refresh token.",
    success: "All tests pass: one refresh per expiry, newest refresh token used, failures surface and can be retried.",
    computer: steps, configs: [], terms: ["oauth"],
    related: [{ label: "Learn: refresh, rotation, revocation and introspection", path: "/learn/identity/oauth-flows#refresh-lifecycle", kind: "learn" }, { label: "Experiment: a stolen refresh token", path: "/practice/identity?experiment=id-refresh-reuse", kind: "playground" }],
    stages: [id("oauth-flows")],
    file: "tokens.js",
    starter: `// createTokenClient({ refresh, now, tokens })
//   tokens: { accessToken, refreshToken, expiresAt }      (expiresAt and now() are in seconds)
//   refresh(refreshToken) -> Promise<{ accessToken, refreshToken, expiresIn }>  (rotates the refresh token)
//   returns { getAccessToken(): Promise<string> }
function createTokenClient({ refresh, now, tokens }) {
  let current = { ...tokens };
  return {
    async getAccessToken() {
      if (now() < current.expiresAt) return current.accessToken;
      const next = await refresh(current.refreshToken);
      current = { accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: now() + next.expiresIn };
      return current.accessToken;
    },
  };
}

let calls = 0, t = 1000;
const used = new Set();
const refresh = async (rt) => { calls++; await sleep(20); if (used.has(rt)) throw new Error("reused " + rt); used.add(rt); return { accessToken: "at-" + calls, refreshToken: "rt-" + calls, expiresIn: 300 }; };
const client = createTokenClient({ refresh, now: () => t, tokens: { accessToken: "at-0", refreshToken: "rt-0", expiresAt: 1000 } });
const results = await Promise.allSettled(Array.from({ length: 10 }, () => client.getAccessToken()));
console.log("refresh calls:", calls, "failed:", results.filter((r) => r.status === "rejected").length);
`,
    solution: `function createTokenClient({ refresh, now, tokens }) {
  let current = { ...tokens };
  let inFlight = null; // the one refresh everyone waits for
  return {
    async getAccessToken() {
      if (now() < current.expiresAt - 30) return current.accessToken;
      if (!inFlight) {
        inFlight = refresh(current.refreshToken)
          .then((next) => {
            current = { accessToken: next.accessToken, refreshToken: next.refreshToken, expiresAt: now() + next.expiresIn };
            return current.accessToken;
          })
          .finally(() => { inFlight = null; }); // success or failure, the next caller starts fresh
      }
      return inFlight;
    },
  };
}

let calls = 0, t = 1000;
const used = new Set();
const refresh = async (rt) => { calls++; await sleep(20); if (used.has(rt)) throw new Error("reused " + rt); used.add(rt); return { accessToken: "at-" + calls, refreshToken: "rt-" + calls, expiresIn: 300 }; };
const client = createTokenClient({ refresh, now: () => t, tokens: { accessToken: "at-0", refreshToken: "rt-0", expiresAt: 1000 } });
const results = await Promise.allSettled(Array.from({ length: 10 }, () => client.getAccessToken()));
console.log("refresh calls:", calls, "failed:", results.filter((r) => r.status === "rejected").length);
`,
    exports: ["createTokenClient"],
    tests: `
function server() {
  const s = { calls: [], used: new Set(), fail: false };
  s.refresh = async (rt) => {
    s.calls.push(rt);
    await sleep(15);
    if (s.fail) { s.fail = false; throw new Error("temporarily unavailable"); }
    if (s.used.has(rt)) throw new Error("refresh token reused: " + rt);
    s.used.add(rt);
    const n = s.calls.length;
    return { accessToken: "at-" + n, refreshToken: "rt-" + n, expiresIn: 300 };
  };
  return s;
}
test("a token with plenty of time left is returned without refreshing", async () => {
  const s = server(); let t = 1000;
  const c = lab.createTokenClient({ refresh: s.refresh, now: () => t, tokens: { accessToken: "at-0", refreshToken: "rt-0", expiresAt: 1200 } });
  assert.equal(await c.getAccessToken(), "at-0", "token");
  assert.equal(s.calls.length, 0, "refresh calls");
});
test("ten concurrent callers at expiry share one refresh", async () => {
  const s = server(); let t = 1000;
  const c = lab.createTokenClient({ refresh: s.refresh, now: () => t, tokens: { accessToken: "at-0", refreshToken: "rt-0", expiresAt: 1000 } });
  const tokens = await Promise.all(Array.from({ length: 10 }, () => c.getAccessToken()));
  assert.equal(s.calls.length, 1, "refresh calls");
  assert.equal(new Set(tokens).size, 1, "every caller got the same new token");
});
test("renews ahead of expiry, and uses the rotated refresh token next time", async () => {
  const s = server(); let t = 1000;
  const c = lab.createTokenClient({ refresh: s.refresh, now: () => t, tokens: { accessToken: "at-0", refreshToken: "rt-0", expiresAt: 1020 } });
  await c.getAccessToken();
  assert.equal(s.calls, ["rt-0"], "renewed with 20 s left");
  t += 290;
  await c.getAccessToken();
  assert.equal(s.calls, ["rt-0", "rt-1"], "second refresh used the rotated token");
});
test("a failed refresh rejects its waiters, and the next call tries again", async () => {
  const s = server(); let t = 1000; s.fail = true;
  const c = lab.createTokenClient({ refresh: s.refresh, now: () => t, tokens: { accessToken: "at-0", refreshToken: "rt-0", expiresAt: 1000 } });
  const first = await Promise.allSettled([c.getAccessToken(), c.getAccessToken()]);
  assert.equal(first.map((r) => r.status), ["rejected", "rejected"], "both waiters see the failure");
  assert.equal(s.calls.length, 1, "one attempt for both");
  assert.equal(await c.getAccessToken(), "at-2", "the next call refreshes again");
});
`,
    timeoutMs: 5000,
    hints: ["Keep the pending refresh promise in a variable; callers that arrive while it exists await the same promise.", "Clear it in finally, so a failure isn't remembered forever.", "Renew when now() >= expiresAt - 30."],
  },
  {
    kind: "code", id: "cookie-vs-bearer", version: 1, subject: "identity",
    title: "Session cookies and safe token handling",
    summary: "Build a session cookie with the right attributes, expire it at logout, and redact credentials before anything is logged.",
    difficulty: "beginner", minutes: 20, modes: ["real-execution"],
    modeNote: "Your functions really run and the tests parse the Set-Cookie strings and log lines they produce. No browser cookie is set.",
    objective: "Write the Set-Cookie attributes that protect a session (Secure, HttpOnly, SameSite, __Host-, lifetimes), and keep bearer tokens and cookies out of logs.",
    problem: "A security review found session cookies readable from JavaScript and sent over HTTP, logout that leaves the cookie in place, and access tokens in the request log.",
    build: "Fix sessionCookie(id, maxAgeSeconds), logoutCookie() and redactForLog(headers).",
    canChange: "Everything in cookies.js.", tools: "Run prints the cookie and a log line. Check parses them.",
    verify: "Run the starter: the cookie has no Secure or HttpOnly, and the log line contains the token.",
    success: "All tests pass: a well-formed session cookie, a working logout cookie and clean logs.",
    computer: steps,
    configs: [{
      name: "Session cookie attributes", what: "Flags on Set-Cookie that tell the browser how to store and send the session identifier.",
      why: "They decide whether script can read it (HttpOnly), whether it travels over plain HTTP (Secure), whether other sites' requests carry it (SameSite) and which hosts can set it (__Host-).",
      where: "Your framework's session or cookie authentication options: ASP.NET Core CookieAuthenticationOptions.Cookie, Spring server.servlet.session.cookie.*, Django SESSION_COOKIE_*.",
      who: "The application's developers.", change: "In the framework configuration; redeploy.",
      verify: "Look at the Set-Cookie header in the browser's network tools after signing in.",
      effect: "A missing HttpOnly lets an XSS steal sessions; missing Secure leaks them on HTTP; SameSite=None without need exposes them to CSRF.",
      kitab: "Real: your strings are parsed by the tests. No browser stores them.",
    }],
    terms: ["session", "csrf"],
    related: [{ label: "Learn: sessions and session cookies", path: "/learn/identity/passwords-sessions#session-cookies", kind: "learn" }, { label: "Learn: token leakage and replay", path: "/learn/identity/failures#token-leakage", kind: "learn" }],
    stages: [id("passwords-sessions"), id("failures")],
    file: "cookies.js",
    starter: `// sessionCookie(id, maxAgeSeconds): the Set-Cookie value for a new session.
// logoutCookie(): the Set-Cookie value that removes it.
// redactForLog(headers): a copy of a headers object safe to log (credentials hidden).
function sessionCookie(id, maxAgeSeconds) {
  return "session=" + id + "; Path=/";
}

function logoutCookie() {
  return "session=; Path=/";
}

function redactForLog(headers) {
  return headers;
}

console.log("Set-Cookie:", sessionCookie("k8Fh2", 3600));
console.log("log:", JSON.stringify(redactForLog({ Authorization: "Bearer eyJhbGciOi.synthetic", Accept: "application/json" })));
`,
    solution: `const NAME = "__Host-session"; // __Host-: Secure, Path=/ and no Domain are required by the browser

function sessionCookie(id, maxAgeSeconds) {
  return NAME + "=" + id + "; Path=/; Max-Age=" + maxAgeSeconds + "; Secure; HttpOnly; SameSite=Lax";
}

function logoutCookie() {
  return NAME + "=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax";
}

const SECRET = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie", "x-api-key"]);
function redactForLog(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!SECRET.has(name.toLowerCase())) out[name] = value;
    else if (/^bearer /i.test(value)) out[name] = "Bearer [redacted]";
    else out[name] = "[redacted]";
  }
  return out;
}

console.log("Set-Cookie:", sessionCookie("k8Fh2", 3600));
console.log("log:", JSON.stringify(redactForLog({ Authorization: "Bearer eyJhbGciOi.synthetic", Accept: "application/json" })));
`,
    exports: ["sessionCookie", "logoutCookie", "redactForLog"],
    tests: `
function parse(cookie) {
  const [pair, ...rest] = cookie.split(";").map((s) => s.trim());
  const attrs = {};
  for (const a of rest) { const [k, v] = a.split("="); attrs[k.toLowerCase()] = v === undefined ? true : v; }
  return { name: pair.split("=")[0], value: pair.slice(pair.indexOf("=") + 1), attrs };
}
test("the session cookie is Secure, HttpOnly, SameSite=Lax, __Host- prefixed, Path=/ and has no Domain", () => {
  const c = parse(lab.sessionCookie("k8Fh2", 3600));
  assert.ok(c.name.startsWith("__Host-"), "name " + c.name);
  assert.equal(c.value, "k8Fh2", "value");
  assert.equal([c.attrs.secure, c.attrs.httponly, c.attrs.path, (c.attrs.samesite || "").toLowerCase()], [true, true, "/", "lax"], "Secure, HttpOnly, Path, SameSite");
  assert.equal(c.attrs.domain, undefined, "no Domain attribute");
});
test("it has a lifetime", () => {
  const c = parse(lab.sessionCookie("k8Fh2", 1800));
  assert.equal(c.attrs["max-age"], "1800", "Max-Age");
});
test("logout removes the same cookie", () => {
  const set = parse(lab.sessionCookie("k8Fh2", 3600)), gone = parse(lab.logoutCookie());
  assert.equal(gone.name, set.name, "same name");
  assert.ok(gone.attrs["max-age"] === "0" || /1970/.test(gone.attrs.expires || ""), "Max-Age=0 or an expiry in the past");
  assert.equal(gone.attrs.path, "/", "same Path");
});
test("logs never contain bearer tokens or cookies, whatever their case", () => {
  const out = lab.redactForLog({ authorization: "Bearer eyJ.synthetic.sig", COOKIE: "__Host-session=k8Fh2", Accept: "application/json", "X-Api-Key": "k-1" });
  const text = JSON.stringify(out);
  assert.ok(!/eyJ|k8Fh2|k-1/.test(text), "no secret value in " + text);
  assert.equal(out.Accept, "application/json", "other headers kept");
});
`,
    timeoutMs: 3000,
    hints: ["Each attribute is '; Name' or '; Name=value' after the name=value pair.", "__Host- cookies must have Secure and Path=/ and no Domain.", "Compare header names in lower case."],
  },
  {
    kind: "code", id: "challenge-response", version: 1, subject: "identity",
    title: "Passkey-style challenge-response, for real",
    summary: "Verify a signed challenge the way a WebAuthn relying party does: the signature, the challenge (once), and the origin.",
    difficulty: "advanced", minutes: 30, modes: ["real-execution"],
    modeNote: "Real cryptography with a stand-in authenticator: the tests generate a P-256 key pair in this browser and sign client data with it, as an authenticator would. It is not WebAuthn itself (no authenticator, no CBOR) and never creates a passkey.",
    objective: "See why passkeys resist replay and phishing: each assertion signs a fresh, single-use challenge together with the origin the browser saw.",
    problem: "A relying party's verifier checks only that the challenge matches. A response captured on a phishing site, or replayed, is accepted.",
    build: "Fix verifyAssertion(assertion, expected) to return true only if the signature verifies with the stored public key, the client data's type is 'webauthn.get', its challenge is one we issued and haven't used (then mark it used), and its origin is exactly expected.origin.",
    canChange: "Everything in assertion.js.", tools: "Run tries a phished response. Check runs genuine, replayed, phished, tampered and wrong-type responses.",
    verify: "Run the starter: the phished response is accepted.",
    success: "All tests pass: only a fresh, correctly signed assertion from the expected origin is accepted.",
    computer: cryptoSteps, configs: [], terms: ["passkey"],
    related: [{ label: "Learn: WebAuthn ceremonies", path: "/learn/identity/mfa-passkeys#webauthn", kind: "learn" }, { label: "Playground: MFA and a phishing proxy", path: "/practice/identity?scenario=mfa", kind: "playground" }],
    stages: [id("mfa-passkeys")],
    file: "assertion.js",
    starter: `// verifyAssertion(assertion, expected) -> Promise<boolean>
//   assertion: { clientDataJSON: string, signature: Uint8Array }   (signature: ECDSA P-256 / SHA-256 over clientDataJSON's bytes)
//   expected:  { publicKey: CryptoKey, origin: string, issued: Set<string>, used: Set<string> }
async function verifyAssertion(assertion, expected) {
  const data = JSON.parse(assertion.clientDataJSON);
  return expected.issued.has(data.challenge);
}

const phished = { clientDataJSON: JSON.stringify({ type: "webauthn.get", challenge: "c1", origin: "https://app-example.co" }), signature: new Uint8Array(64) };
console.log("phished response accepted:", await verifyAssertion(phished, { publicKey: null, origin: "https://app.example", issued: new Set(["c1"]), used: new Set() }));
`,
    solution: `async function verifyAssertion(assertion, expected) {
  let data;
  try { data = JSON.parse(assertion.clientDataJSON); } catch { return false; }
  // The signature first: until it verifies, nothing in clientDataJSON is evidence.
  let ok = false;
  try {
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, expected.publicKey, assertion.signature, new TextEncoder().encode(assertion.clientDataJSON));
  } catch { return false; }
  if (!ok) return false;
  if (data.type !== "webauthn.get") return false;
  if (data.origin !== expected.origin) return false;                     // phishing resistance
  if (!expected.issued.has(data.challenge) || expected.used.has(data.challenge)) return false; // freshness
  expected.used.add(data.challenge);
  return true;
}

const phished = { clientDataJSON: JSON.stringify({ type: "webauthn.get", challenge: "c1", origin: "https://app-example.co" }), signature: new Uint8Array(64) };
console.log("phished response accepted:", await verifyAssertion(phished, { publicKey: null, origin: "https://app.example", issued: new Set(["c1"]), used: new Set() }));
`,
    exports: ["verifyAssertion"],
    tests: `
const setup = (async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const other = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const sign = async (data, key = pair.privateKey) => {
    const clientDataJSON = JSON.stringify(data);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(clientDataJSON)));
    return { clientDataJSON, signature };
  };
  return { pair, other, sign };
})();
const expect = (publicKey) => ({ publicKey, origin: "https://app.example", issued: new Set(["c1", "c2"]), used: new Set() });
test("a genuine assertion verifies", async () => {
  const { pair, sign } = await setup;
  assert.equal(await lab.verifyAssertion(await sign({ type: "webauthn.get", challenge: "c1", origin: "https://app.example" }), expect(pair.publicKey)), true, "genuine");
});
test("a challenge works once (replay)", async () => {
  const { pair, sign } = await setup;
  const e = expect(pair.publicKey);
  const a = await sign({ type: "webauthn.get", challenge: "c1", origin: "https://app.example" });
  await lab.verifyAssertion(a, e);
  assert.equal(await lab.verifyAssertion(a, e), false, "replayed");
  assert.equal(await lab.verifyAssertion(await sign({ type: "webauthn.get", challenge: "never-issued", origin: "https://app.example" }), e), false, "unknown challenge");
});
test("another origin is refused (phishing)", async () => {
  const { pair, sign } = await setup;
  assert.equal(await lab.verifyAssertion(await sign({ type: "webauthn.get", challenge: "c1", origin: "https://app-example.co" }), expect(pair.publicKey)), false, "phished origin");
});
test("tampered client data, another key, or the wrong type are refused", async () => {
  const { pair, other, sign } = await setup;
  const a = await sign({ type: "webauthn.get", challenge: "c1", origin: "https://app-example.co" });
  const tampered = { clientDataJSON: a.clientDataJSON.replace("app-example.co", "app.example"), signature: a.signature };
  assert.equal(await lab.verifyAssertion(tampered, expect(pair.publicKey)), false, "origin edited after signing");
  assert.equal(await lab.verifyAssertion(await sign({ type: "webauthn.get", challenge: "c1", origin: "https://app.example" }, other.privateKey), expect(pair.publicKey)), false, "signed by another key");
  assert.equal(await lab.verifyAssertion(await sign({ type: "webauthn.create", challenge: "c1", origin: "https://app.example" }), expect(pair.publicKey)), false, "registration data used to sign in");
});
`,
    timeoutMs: 6000,
    hints: ["Verify the signature over the exact clientDataJSON bytes before trusting anything in it.", "Then check type, origin, and that the challenge was issued and not used.", "Mark the challenge used only when everything passed."],
  },
  {
    kind: "http", id: "protected-api", version: 1, subject: "identity",
    title: "Call a protected API with real tokens",
    summary: "Fetch a discovery document and JWKS, then call a real resource server with synthetic tokens and read its 401, 403 and 404 answers.",
    difficulty: "intermediate", minutes: 25, modes: ["real-protocol"],
    modeNote: "Real requests to Kitab's teaching API, which really verifies RS256 signatures with Web Crypto. The tokens are synthetic and were signed once with a key that was then destroyed; they open nothing outside /api/lab/identity.",
    objective: "See a resource server's decisions from the outside: WWW-Authenticate challenges, invalid_token versus insufficient_scope, and tenant isolation reported as 404.",
    problem: "A mobile app gets 401s and 403s from the orders API and the team can't tell why. Every response here says which check decided it (X-Lab-Check).",
    build: "Complete the tasks: read the discovery document, read the JWKS, then call /api/lab/identity/orders with no token, a valid token, a token for another API, a token without the scope, and a token from another tenant.",
    canChange: "The method, path and headers of each request.",
    tools: "The request builder sends with fetch. The response inspector shows status, WWW-Authenticate, X-Lab-Check and the body.",
    verify: "Each task's checks read the real response from the server.",
    success: "All tasks pass and you can explain each status from its WWW-Authenticate header.",
    computer: [
      { title: "The browser sends your request", detail: "fetch() adds your Authorization header. Kitab's echo never reflects credential values, and saved drafts keep only these synthetic lab tokens.", observed: true },
      { title: "The resource server authenticates the token", detail: "It checks the header names the lab key, verifies the RS256 signature with Web Crypto, then iss, aud and exp.", observed: true },
      { title: "Then it authorizes", detail: "Scope orders.read, then tenant (another tenant's order is a 404), then ownership.", observed: true },
      { title: "The answer says why", detail: "401 or 403 with a WWW-Authenticate header (RFC 6750), and X-Lab-Check naming the check.", observed: true },
    ],
    configs: [],
    terms: ["jwt", "scope", "audience", "tenant"],
    related: [{ label: "Learn: ID tokens versus access tokens", path: "/learn/identity/oidc#id-vs-access", kind: "learn" }, { label: "Playground: the API's checks", path: "/practice/identity?scenario=oidc-login", kind: "playground" }],
    stages: [id("tokens")],
    reference: { title: "Synthetic lab tokens", note: "Signed once for this lab with a key that was then destroyed. They open nothing outside /api/lab/identity. Never paste a real token into any website.", items: [
      { label: "Alice (valid, orders.read)", value: LAB_TOKENS.alice },
      { label: "Alice, without orders.read", value: LAB_TOKENS.aliceNoScope },
      { label: "Alice, issued for another API (HR)", value: LAB_TOKENS.aliceOtherApi },
      { label: "Alice, expired", value: LAB_TOKENS.aliceExpired },
      { label: "Dave (Globex)", value: LAB_TOKENS.dave },
      { label: "Forged: same kid, another key", value: LAB_TOKENS.forged },
    ] },
    tasks: [
      {
        id: "discovery", title: "Read the discovery document", goal: "GET the issuer's /.well-known/openid-configuration and find its jwks_uri.",
        starter: draft("GET", "/api/lab/identity/openid-configuration"), solution: draft("GET", "/api/lab/identity/.well-known/openid-configuration"),
        checks: [
          { label: "The response status is 200", test: (o) => status(o) === 200 },
          { label: "It names the issuer and a jwks_uri", test: (o) => typeof (o.response?.json as { jwks_uri?: unknown } | undefined)?.jwks_uri === "string" },
        ],
        hints: ["Discovery documents live at /.well-known/openid-configuration under the issuer: here /api/lab/identity/.well-known/openid-configuration."],
      },
      {
        id: "jwks", title: "Read the keys", goal: "GET the JWKS and note the kid of the signing key.",
        starter: draft("GET", "/api/lab/identity/keys"), solution: draft("GET", "/api/lab/identity/jwks"),
        checks: [
          { label: "The response status is 200", test: (o) => status(o) === 200 },
          { label: "It lists an RSA public key with a kid, and no private parts", test: (o) => { const k = (o.response?.json as { keys?: Record<string, unknown>[] } | undefined)?.keys?.[0]; return !!k && k.kty === "RSA" && typeof k.kid === "string" && k.d === undefined; } },
        ],
        hints: ["The discovery document's jwks_uri ends in /api/lab/identity/jwks."],
      },
      {
        id: "no-token", title: "Call without a token", goal: "GET /api/lab/identity/orders/123 with no Authorization header and read the challenge.",
        starter: draft("GET", "/api/lab/identity/orders/123"), solution: draft("GET", "/api/lab/identity/orders/123"),
        checks: [
          { label: "The response status is 401", test: (o) => status(o) === 401 },
          { label: "WWW-Authenticate says to use a Bearer token", test: (o) => /^Bearer/.test(header(o.response?.headers, "www-authenticate") ?? "") },
        ],
        hints: ["Just send it as it is."],
      },
      {
        id: "valid", title: "Call with a valid token", goal: "Alice reads her own order 123 with her token.",
        starter: draft("GET", "/api/lab/identity/orders/123", { headers: [{ name: "Authorization", value: LAB_TOKENS.alice }] }),
        solution: draft("GET", "/api/lab/identity/orders/123", { headers: bearer(LAB_TOKENS.alice) }),
        checks: [
          { label: "The response status is 200", test: (o) => status(o) === 200 },
          { label: "The server's decision was 'allowed'", test: (o) => check(o) === "allowed" },
        ],
        hints: ["The header needs the scheme: Authorization: Bearer <token>."],
      },
      {
        id: "audience", title: "A token for another API", goal: "Send Alice's token issued for the HR API, and read why it's refused.",
        starter: draft("GET", "/api/lab/identity/orders/123", { headers: bearer(LAB_TOKENS.alice) }),
        solution: draft("GET", "/api/lab/identity/orders/123", { headers: bearer(LAB_TOKENS.aliceOtherApi) }),
        checks: [
          { label: "The response status is 401", test: (o) => status(o) === 401 },
          { label: "error=\"invalid_token\": the audience check failed", test: (o) => /invalid_token/.test(header(o.response?.headers, "www-authenticate") ?? "") && check(o) === "audience" },
        ],
        hints: ["Replace the token with the 'other API' token from the lab's token list."],
      },
      {
        id: "scope", title: "A token without the scope", goal: "Send a token that is valid here but lacks orders.read.",
        starter: draft("GET", "/api/lab/identity/orders/123", { headers: bearer(LAB_TOKENS.alice) }),
        solution: draft("GET", "/api/lab/identity/orders/123", { headers: bearer(LAB_TOKENS.aliceNoScope) }),
        checks: [
          { label: "The response status is 403", test: (o) => status(o) === 403 },
          { label: "error=\"insufficient_scope\" names orders.read", test: (o) => /insufficient_scope/.test(header(o.response?.headers, "www-authenticate") ?? "") && /orders\.read/.test(header(o.response?.headers, "www-authenticate") ?? "") },
        ],
        question: {
          prompt: "Why 403 here but 401 for the HR token?",
          options: [{ id: "403-permission", label: "This token is acceptable here but lacks permission (403); the HR token isn't acceptable here at all (401)" }, { id: "same", label: "They are the same problem" }],
          answer: (h) => (h.at(-1) && status(h.at(-1)!) === 403 ? "403-permission" : null),
          explain: "RFC 6750 §3.1: invalid_token (401) means the token can't be used here; insufficient_scope (403) means it can, but doesn't allow this.",
        },
        hints: ["Use the 'no scope' token."],
      },
      {
        id: "tenant", title: "Another tenant's order", goal: "Dave, from Globex, asks for Acme's order 123.",
        starter: draft("GET", "/api/lab/identity/orders/123", { headers: bearer(LAB_TOKENS.alice) }),
        solution: draft("GET", "/api/lab/identity/orders/123", { headers: bearer(LAB_TOKENS.dave) }),
        checks: [
          { label: "The response status is 404", test: (o) => status(o) === 404 },
          { label: "The tenant check decided it", test: (o) => check(o) === "tenant" },
        ],
        hints: ["Use Dave's token. A 404 rather than 403 avoids confirming the order exists."],
      },
    ],
  },
];

