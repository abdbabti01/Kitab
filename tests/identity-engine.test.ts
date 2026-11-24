// The Identity track's engines: the protocol scenarios (one canonical event stream per run), the authorization
// policy engine and the real Web Crypto JWT validator. Security regressions are asserted here: wrong signatures,
// audiences, keys, PKCE verifiers and states must fail; cross-tenant access must be denied.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { base64url, fromBase64url, s256, sha256, utf8 } from "../src/identity/sha256.ts";
import { MAX_EVENTS, firstFailure, outcomeOf, parseConfig, runScenario, stateAt, type Config, type FlowRun, type Scenario } from "../src/identity/model.ts";
import { findScenario, scenarios } from "../src/identity/flows/index.ts";
import { audit, compare, evaluate, securePolicy, suite, RULES } from "../src/identity/authz.ts";
import { AUDIENCE, ISSUER, decode, generateKey, samples, sign, validate } from "../src/identity/jwt.ts";

const run = (id: string, config: Record<string, string> = {}) => runScenario(findScenario(id)!, config);
const failedCheck = (r: FlowRun) => firstFailure(r)?.check.id ?? null;

test("SHA-256 matches node:crypto, and S256 matches RFC 7636 Appendix B", () => {
  assert.equal(s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  for (const text of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "é".repeat(300)]) {
    assert.equal(Buffer.from(sha256(utf8(text))).toString("hex"), createHash("sha256").update(text).digest("hex"));
  }
  for (const bytes of [[], [1], [1, 2], [1, 2, 3], [250, 251, 252, 253]]) {
    const b = new Uint8Array(bytes);
    assert.equal(base64url(b), Buffer.from(b).toString("base64url"));
    assert.deepEqual([...fromBase64url(base64url(b))!], bytes);
  }
  assert.equal(fromBase64url("a+b/"), null);
});

/** Every combination of every control's options (unavailable ones are resolved by parseConfig). */
function* combinations(scenario: Scenario): Generator<Config> {
  const controls = scenario.controls;
  const walk = function* (i: number, acc: Config): Generator<Config> {
    if (i === controls.length) return yield acc;
    for (const o of controls[i].options) yield* walk(i + 1, { ...acc, [controls[i].id]: o.value });
  };
  yield* walk(0, {});
}

test("every scenario, in every configuration: deterministic, bounded, ordered, with known actors and a purpose per event", () => {
  let runs = 0;
  for (const scenario of scenarios) {
    const actorIds = new Set(scenario.actors.map((a) => a.id));
    for (const raw of combinations(scenario)) {
      const a = runScenario(scenario, raw);
      const b = runScenario(scenario, raw);
      assert.deepEqual(a, b, `${scenario.id} replays identically`);
      assert.ok(a.events.length > 0 && a.events.length <= MAX_EVENTS, `${scenario.id} bounded`);
      a.events.forEach((e, i) => {
        assert.equal(e.step, i);
        assert.ok(actorIds.has(e.from) && actorIds.has(e.to), `${scenario.id}: ${e.from}→${e.to} are declared actors (${JSON.stringify(raw)})`);
        assert.ok(e.purpose.length > 10, `${scenario.id} step ${i} explains itself`);
        if (i > 0) assert.ok(e.t >= a.events[i - 1].t, "time never goes backwards");
      });
      // Once a check fails, at most one consequence event follows.
      const failure = firstFailure(a);
      if (failure) assert.ok(a.events.length - failure.event.step <= 2, `${scenario.id} stops after a failure (${JSON.stringify(raw)})`);
      // The fold never throws and ends with the last event.
      stateAt(a, a.events.length - 1);
      runs++;
    }
  }
  assert.ok(runs > 1000, `ran ${runs} configurations`);
});

test("parseConfig ignores unknown values and options unavailable in the chosen configuration", () => {
  const oidc = findScenario("oidc-login")!;
  assert.equal(parseConfig(oidc, { client: "<script>" }).client, "web");
  assert.equal(parseConfig(oidc, { pkce: "off", fault: "verifier" }).fault, "none", "a verifier fault needs PKCE");
  assert.equal(parseConfig(oidc, { callApi: "no", fault: "api-aud" }).fault, "none");
  assert.equal(parseConfig(oidc, { fault: "state" }).fault, "state");
});

test("OIDC login: the correct flow succeeds for both client shapes and ends with the app's own session", () => {
  for (const client of ["web", "spa"]) {
    const r = run("oidc-login", { client });
    assert.equal(outcomeOf(r).ok, true, client);
    const world = stateAt(r, r.events.length - 1);
    assert.ok(world.app?.["Access token"], "client holds the access token");
    if (client === "web") {
      assert.match(world.browser?.["Cookie for app.example"]?.value ?? "", /__Host-session=/, "browser holds only a session id");
      assert.equal(world.app?.code_verifier, undefined, "verifier discarded after the exchange");
    }
  }
  const pkce = run("oidc-login").events.find((e) => e.title.startsWith("Generates"))!;
  assert.equal(pkce.params!.find(([k]) => k === "code_challenge")![1], s256(pkce.params!.find(([k]) => k === "code_verifier")![1]), "the challenge shown is the real S256 of the verifier");
});

test("OIDC login: every injected fault is caught by the right check (security regressions)", () => {
  const expected: Record<string, string> = {
    state: "state", verifier: "pkce", "code-reuse": "code", nonce: "idt-nonce", "idtoken-aud": "idt-aud", "idtoken-expired": "idt-exp",
    "idtoken-key": "idt-signature", "api-aud": "at-aud", "api-scope": "at-scope", "api-idtoken": "at-type",
  };
  for (const [fault, id] of Object.entries(expected)) assert.equal(failedCheck(run("oidc-login", { fault })), id, fault);
  assert.equal(failedCheck(run("oidc-login", { redirect: "slash" })), "redirect-uri", "exact matching: one extra slash is refused");
  const other = run("oidc-login", { redirect: "other" });
  assert.equal(failedCheck(other), "redirect-uri");
  assert.ok(!other.events.some((e) => e.headers?.some(([k, v]) => k === "Location" && v.startsWith("https://attacker.example") && e.from === "idp")), "never redirects to an unregistered URI");
  assert.equal(failedCheck(run("oidc-login", { client: "spa", pkce: "off" })), "pkce-required", "public clients must use PKCE");
  assert.equal(outcomeOf(run("oidc-login", { client: "web", pkce: "off" })).ok, true, "confidential client without PKCE is allowed (recommended, not required)");
  assert.equal(failedCheck(run("oidc-login", { consent: "deny" })), "consent");
  // A state failure stops before any token request.
  const csrf = run("oidc-login", { fault: "state" });
  assert.ok(!csrf.events.some((e) => e.endpoint?.endsWith("/token")));
});

test("SSO: three separate sessions; logout of one app is local; back-channel logout reaches the other", () => {
  const r = run("sso");
  const end = stateAt(r, r.events.length - 1);
  assert.ok(end.idp?.["IdP session s-9f2e"] && end.app?.["Portal session pa-11"] && end["app-b"]?.["Finance session fb-27"]);
  assert.ok(!r.events.some((e) => e.title === "Enters password again"), "no second password with a valid IdP session");
  assert.ok(run("sso", { idpAtB: "expired" }).events.some((e) => e.title === "Enters password again"));
  assert.ok(run("sso", { bMfa: "yes" }).events.some((e) => e.title.includes("step-up")));
  const local = run("sso", { after: "logout-a" });
  const afterLocal = stateAt(local, local.events.length - 1);
  assert.ok(afterLocal.idp?.["IdP session s-9f2e"], "IdP session survives a local logout");
  assert.ok(afterLocal["app-b"]?.["Finance session fb-27"], "Finance session survives");
  assert.ok(afterLocal.app?.["Portal session pa-12"], "the Portal signs straight back in");
  const without = stateAt(run("sso", { after: "logout-idp" }), 99);
  assert.equal(without.idp?.["IdP session s-9f2e"], undefined);
  assert.ok(without["app-b"]?.["Finance session fb-27"], "without back-channel logout Finance is not told");
  const withBc = stateAt(run("sso", { after: "logout-idp", backchannel: "on" }), 99);
  assert.equal(withBc["app-b"]?.["Finance session fb-27"], undefined);
  assert.equal(failedCheck(run("sso", { fault: "reuse-idtoken" })), "b-aud", "an ID token issued to the Portal is refused by Finance");
});

test("Client credentials, device grant, refresh rotation and introspection", () => {
  assert.equal(outcomeOf(run("client-credentials")).ok, true);
  assert.equal(failedCheck(run("client-credentials", { scope: "orders.write" })), "scope-allowed");
  assert.equal(failedCheck(run("client-credentials", { fault: "bad-credential" })), "client-auth");
  assert.equal(failedCheck(run("client-credentials", { fault: "wrong-resource" })), "resource");
  assert.equal(failedCheck(run("client-credentials", { renew: "late" })), "at-exp-late");
  assert.equal(outcomeOf(run("device")).ok, true);
  assert.equal(failedCheck(run("device", { user: "deny" })), "device-approved");
  assert.equal(failedCheck(run("device", { user: "never" })), "device-expired");
  assert.ok(run("device", { interval: "2" }).events.some((e) => e.title === "400 slow_down"));
  assert.equal(outcomeOf(run("refresh")).ok, true);
  assert.equal(failedCheck(run("refresh", { theft: "after" })), "rt-attacker", "rotation detects the stolen token's reuse");
  assert.equal(failedCheck(run("refresh", { theft: "first" })), "rt-app", "the legitimate app's reuse reveals the theft");
  assert.equal(outcomeOf(run("refresh", { rotation: "off", theft: "after" })).check?.kind, "security", "without rotation the attacker keeps access");
  assert.equal(outcomeOf(run("introspection", { revoke: "yes" })).check?.id, "active-2", "revocation takes effect at the next introspection");
  assert.equal(outcomeOf(run("introspection", { revoke: "yes", cache: "60" })).check?.kind, "security", "a cached introspection result serves a revoked token");
});

test("SAML: each processing rule stops its fault", () => {
  const expected: Record<string, string> = { unsigned: "signature", "rotated-cert": "signature", audience: "audience", expired: "time", "in-response-to": "in-response-to", replay: "replay", wrapping: "signed-element" };
  assert.equal(outcomeOf(run("saml")).ok, true);
  for (const [fault, id] of Object.entries(expected)) assert.equal(failedCheck(run("saml", { fault })), id, fault);
  assert.equal(failedCheck(run("saml", { initiated: "idp" })), "in-response-to", "unsolicited responses refused unless allowed");
  assert.equal(outcomeOf(run("saml", { initiated: "idp", spAllowsUnsolicited: "yes" })).ok, true);
});

test("MFA: codes and push are relayed by a phishing proxy; passkeys are not", () => {
  for (const factor of ["otp", "sms", "push", "passkey"]) assert.equal(outcomeOf(run("mfa", { factor })).ok, true, `${factor} on the real site`);
  for (const factor of ["otp", "sms", "push"]) assert.equal(outcomeOf(run("mfa", { factor, site: "phish" })).check?.kind, "security", factor);
  const passkey = outcomeOf(run("mfa", { factor: "passkey", site: "phish" }));
  assert.equal(passkey.check?.id, "rp-id");
  assert.notEqual(passkey.check?.kind, "security");
});

test("WebAuthn and key rotation", () => {
  for (const ceremony of ["register", "authenticate"]) assert.equal(outcomeOf(run("webauthn", { ceremony })).ok, true);
  for (const [fault, id] of Object.entries({ origin: "origin", challenge: "challenge", uv: "uv", unknown: "credential" })) assert.equal(failedCheck(run("webauthn", { ceremony: "authenticate", fault })), id);
  assert.equal(outcomeOf(run("key-rotation")).ok, true, "graceful rollover with refetch on unknown kid");
  assert.equal(failedCheck(run("key-rotation", { refresh: "never" })), "kid-token 2");
  assert.equal(failedCheck(run("key-rotation", { rollover: "abrupt" })), "kid-token 1b", "removing the old key early breaks tokens it signed");
  assert.equal(failedCheck(run("key-rotation", { attacker: "yes" })), "forged");
});

test("authorization: the secure policy matches itself; each missing rule lets a specific attack through", () => {
  assert.deepEqual([audit(securePolicy).tooPermissive, audit(securePolicy).tooStrict], [0, 0]);
  const without = (rule: string) => securePolicy.filter((r) => r !== rule);
  const hole = (rule: string, label: string) => assert.equal(audit(without(rule)).rows.find((r) => r.label === label)!.verdict, "too-permissive", `${rule}: ${label}`);
  hole("tenant", "Dave (Globex admin) reads an Acme order");
  hole("ownership", "Alice reads Frank's order");
  hole("conditions", "Bob (support) refunds 900");
  hole("audience", "Alice with a token for another API");
  assert.equal(evaluate(suite[0].request, []).allow, false, "deny by default: no rule grants anything");
  assert.ok(audit([...securePolicy, "admin-only"]).tooStrict > 0, "a blunt admin-only rule blocks legitimate users");
  const cross = evaluate({ subject: "dave", action: "read", order: "123", credential: "valid" }, securePolicy);
  assert.equal(cross.allow, false);
  assert.equal(cross.status, 404, "another tenant's order is reported as not found");
  assert.equal(compare({ subject: "alice", action: "read", order: "123", credential: "valid" }, RULES.filter((r) => r !== "admin-only")).verdict, "agrees");
});

test("JWT: real Web Crypto signatures; decoding is not validation; every bad sample fails at its step", async () => {
  const now = 1_800_000_000;
  const keys = { current: await generateKey("kitab-demo-1"), next: await generateKey("kitab-demo-2"), attacker: await generateKey("attacker-1"), rsa: await generateKey("kitab-demo-rsa", "RS256") };
  const list = await samples(now, keys);
  const expect = { issuer: ISSUER, audience: AUDIENCE, now, skew: 60, jwks: [keys.current.publicJwk, keys.rsa.publicJwk], required: ["sub", "exp", "iss", "aud"] };
  const firstFail = async (token: string, jwks = expect.jwks) => (await validate(token, { ...expect, jwks })).steps.find((s) => s.status === "fail")?.id ?? null;
  const want: Record<string, string | null> = { valid: null, rs256: null, tampered: "signature", "attacker-key": "signature", "unknown-kid": "kid", rotated: "kid", "wrong-iss": "iss", "wrong-aud": "aud", expired: "exp", nbf: "nbf", missing: "required", "alg-none": "alg", "alg-hs256": "alg", html: null };
  for (const s of list) assert.equal(await firstFail(s.token), want[s.id], s.id);
  const rotated = list.find((s) => s.id === "rotated")!;
  assert.equal(await firstFail(rotated.token, [...expect.jwks, keys.next.publicJwk]), null, "valid once the JWKS has the new key");
  // Decoding works for every well-formed sample, valid or not: it proves nothing.
  assert.ok(!("error" in decode(list.find((s) => s.id === "tampered")!.token)));
  // Steps after a failure are skipped, never reported as passing.
  const tampered = await validate(list.find((s) => s.id === "tampered")!.token, expect);
  assert.ok(tampered.steps.slice(tampered.steps.findIndex((s) => s.status === "fail") + 1).every((s) => s.status === "skipped"));
  assert.equal(tampered.valid, false);
  assert.equal((await validate("not.a.jwt.at.all", expect)).steps[0].status, "fail");
  assert.equal((await validate("x".repeat(20_000), expect)).valid, false);
  // A token signed for one key never verifies with another.
  const other = await sign({ alg: "ES256", kid: "kitab-demo-1" }, { iss: ISSUER }, keys.attacker);
  assert.equal(await firstFail(other), "signature");
});
