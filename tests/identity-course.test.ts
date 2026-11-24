// The Identity track: content complete and consistent with its catalog, challenges judged by the engines (starters
// fail, several solutions pass where justified), progress records, routes, examples, and the teaching endpoints'
// security behaviour.
import assert from "node:assert/strict";
import test from "node:test";
import { identityChallengeCatalog, identityUnitCatalog } from "../src/identity/catalog.ts";
import { identityUnits } from "../src/identity/content/index.ts";
import { findScenario } from "../src/identity/flows/index.ts";
import { parseConfig } from "../src/identity/model.ts";
import { diagnosis, identityChallenges, judge, runOf, type Challenge } from "../src/identity/challenges.ts";
import { securePolicy, type Rule } from "../src/identity/authz.ts";
import { identityExamples } from "../src/identity/code.ts";
import { IDENTITY_KEY, challengeRecordFor, challengeState, loadIdentityProgress, recordAttempt, recordUnitCheck, savePlayground } from "../src/identity/progress.ts";
import { unitCheckIds, type ConceptUnit } from "../src/architecture/concepts/types.ts";
import { labs } from "../src/lab/catalog.ts";
import { parseRoute } from "../src/app/routes.ts";
import { findTrack, locate } from "../src/learning/tracks.ts";
import { activityState, canMaster, recommend, type Evidence } from "../src/learning/networking-path.ts";
import { handleLab } from "../worker/lab.ts";
import { LAB_TOKENS } from "../src/identity/lab-fixtures.ts";
import { saveLab, readLabs, LAB_PROGRESS_KEY } from "../src/lab/progress.ts";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

test("the catalog matches the units, in order, and the track has one stage per unit", () => {
  assert.deepEqual(identityUnits.map((u) => [u.id, u.title]), identityUnitCatalog.map((u) => [u.id, u.title]));
  const track = findTrack("identity")!;
  assert.deepEqual(track.stages.map((s) => s.id), identityUnits.map((u) => u.id));
  assert.equal(identityUnits.length, 12);
});

test("every concept is complete, with exactly one right answer whose position varies within the unit", () => {
  for (const unit of identityUnits) {
    assert.ok(unit.objectives.length && unit.intro.length && unit.takeaways.length && unit.sources.length, unit.id);
    const positions = new Set<number>();
    for (const c of unit.concepts) {
      for (const field of ["plain", "why", "example", "failure", "solution"] as const) assert.ok(c[field].length > 20, `${unit.id}/${c.id}.${field}`);
      assert.ok(c.mechanism.length && c.tradeoffs.length && c.avoid.length, `${unit.id}/${c.id}`);
      assert.equal(c.check.options.filter((o) => o.correct).length, 1, `${unit.id}/${c.id} has one right option`);
      assert.ok(c.check.options.every((o) => o.why.length > 5), `${unit.id}/${c.id} explains every option`);
      positions.add(c.check.options.findIndex((o) => o.correct));
    }
    assert.ok(positions.size > 1, `${unit.id}: the right option isn't always in the same place`);
    assert.equal(new Set(unitCheckIds(unit as unknown as ConceptUnit)).size, unitCheckIds(unit as unknown as ConceptUnit).length, `${unit.id} check ids unique`);
    for (const d of unit.decisions ?? []) {
      assert.ok(d.choices.some((c) => c.acceptable) && d.reasons.filter((r) => r.relevant).length >= d.minReasons, `${unit.id}/${d.id}`);
    }
  }
});

test("walkthroughs, examples, labs and links of every unit exist", () => {
  const routes = new Set(["not-found"]);
  for (const unit of identityUnits) {
    if (unit.walkthrough) {
      const scenario = findScenario(unit.walkthrough.scenario);
      assert.ok(scenario, `${unit.id} walkthrough scenario`);
      const parsed = parseConfig(scenario!, unit.walkthrough.config ?? {});
      for (const [k, v] of Object.entries(unit.walkthrough.config ?? {})) assert.equal(parsed[k], v, `${unit.id} walkthrough ${k}`);
    }
    for (const topic of unit.examples) assert.deepEqual(identityExamples.filter((e) => e.topic === topic).map((e) => e.lang).sort(), ["csharp", "java", "python"], `${unit.id} example ${topic}`);
    const declared = labs.filter((l) => l.stages.some((s) => s.track === "identity" && s.stage === unit.id)).map((l) => l.id).sort();
    assert.deepEqual([...unit.labs].sort(), declared, `${unit.id} labs`);
    for (const link of unit.related) assert.ok(!routes.has(parseRoute(link.path.split(/[?#]/)[0]).name), `${unit.id} → ${link.path}`);
  }
});

test("code examples explain themselves; examples that run state their exact output", () => {
  assert.equal(new Set(identityExamples.map((e) => e.id)).size, identityExamples.length);
  for (const e of identityExamples) {
    assert.ok(e.file && e.framework && e.notes.length >= 2 && e.failure && e.production.length, e.id);
    if (e.verify === "run") assert.ok(e.output && e.output.split("\n").length >= 3, `${e.id} has output`);
    else assert.equal(e.output, undefined, `${e.id} is build-only and shows no invented output`);
    assert.ok(!/BEGIN (RSA )?PRIVATE KEY/.test(e.source), `${e.id} embeds no private key`);
  }
});

test("the challenge catalog matches the challenges, and every challenge belongs to a unit", () => {
  assert.deepEqual(identityChallenges.map((c) => [c.id, c.title, c.version, c.unit, c.variants.length]), identityChallengeCatalog.map((c) => [c.id, c.title, c.version, c.unit, c.variants]));
  for (const c of identityChallenges) assert.ok(identityUnits.some((u) => u.id === c.unit), c.id);
});

/** A correct submission for each kind, derived from the engine or the authored rules (never stored as an answer key). */
function solve(c: Challenge, variant: string) {
  if (c.kind === "classify") return { kind: "classify" as const, answers: c.variants.find((v) => v.id === variant)!.items.map((i) => i.answer) };
  if (c.kind === "diagnose") {
    const v = c.variants.find((x) => x.id === variant)!;
    const d = diagnosis(c, runOf(v.scenario, v.config));
    return { kind: "diagnose" as const, step: d.step, cause: d.cause };
  }
  if (c.kind === "policy") return { kind: "policy" as const, rules: [...securePolicy] };
  if (c.kind === "decision") {
    const d = c.variants.find((x) => x.id === variant)!;
    return { kind: "decision" as const, choice: d.choices.findIndex((x) => x.acceptable), reasons: d.reasons.map((r, i) => (r.relevant ? i : -1)).filter((i) => i >= 0) };
  }
  return null;
}

test("every challenge variant: the right submission passes and a wrong one fails, judged by the model", () => {
  for (const c of identityChallenges) {
    for (const v of c.variants) {
      const right = solve(c, v.id);
      if (!right) continue;
      assert.equal(judge(c, v.id, right).passed, true, `${c.id}/${v.id} right answer`);
      if (right.kind === "diagnose") {
        assert.equal(judge(c, v.id, { ...right, step: right.step === 0 ? 1 : 0 }).passed, false, `${c.id}/${v.id} wrong step`);
        const other = c.kind === "diagnose" ? c.causes.find((x) => x.id !== right.cause)!.id : "";
        assert.equal(judge(c, v.id, { ...right, cause: other }).passed, false, `${c.id}/${v.id} wrong cause`);
      }
      if (right.kind === "classify") assert.equal(judge(c, v.id, { ...right, answers: right.answers.map((a, i) => (i === 0 ? (a === "authn" ? "authz" : "authn") : a)) }).passed, false, `${c.id}/${v.id} one wrong`);
      if (right.kind === "decision") assert.equal(judge(c, v.id, { ...right, choice: c.kind === "decision" ? c.variants.find((x) => x.id === v.id)!.choices.findIndex((x) => !x.acceptable) : 0 }).passed, false, `${c.id}/${v.id} unacceptable choice`);
      if (right.kind === "policy" && c.kind === "policy") assert.equal(judge(c, v.id, { kind: "policy", rules: c.variants.find((x) => x.id === v.id)!.start }).passed, false, `${c.id}/${v.id} the starting policy fails`);
    }
  }
});

test("configure challenges: the broken start fails; more than one fix passes where the design allows it", () => {
  const repair = identityChallenges.find((c) => c.id === "repair-pkce")!;
  const sso = identityChallenges.find((c) => c.id === "sso-two-apps")!;
  const pass = (c: Challenge, v: string, config: Record<string, string>) => judge(c, v, { kind: "configure", config: parseConfig(findScenario(c.kind === "configure" ? c.scenario : "")!, config) }).passed;
  for (const c of [repair, sso]) if (c.kind === "configure") for (const v of c.variants) assert.equal(pass(c, v.id, v.start), false, `${c.id}/${v.id} start fails`);
  assert.equal(pass(repair, "spa-no-pkce", { client: "spa", pkce: "S256" }), true, "add PKCE");
  assert.equal(pass(repair, "spa-no-pkce", { client: "web", pkce: "S256" }), true, "or move to a backend-for-frontend");
  assert.equal(pass(repair, "spa-no-pkce", { client: "web", pkce: "off" }), true, "a confidential client without PKCE completes (recommended, not required)");
  assert.equal(pass(repair, "slash", { redirect: "exact" }), true, "exact redirect");
  assert.equal(pass(repair, "both", { client: "spa", pkce: "S256", redirect: "exact" }), true, "both fixes");
  assert.equal(pass(repair, "both", { client: "spa", pkce: "S256", redirect: "other" }), false, "one fix is not enough");
  assert.equal(pass(sso, "mfa", { bMfa: "yes" }), true);
  assert.equal(pass(sso, "logout-everywhere", { after: "logout-idp", backchannel: "on" }), true);
  assert.equal(pass(sso, "logout-everywhere", { after: "logout-idp" }), false, "without back-channel logout Finance stays signed in");
  assert.equal(pass(sso, "no-silent", { after: "logout-idp" }), true);
  assert.equal(pass(sso, "no-silent", { after: "logout-idp", backchannel: "on" }), true, "a second valid answer");
  const policy = identityChallenges.find((c) => c.id === "fix-api-policy")!;
  assert.equal(judge(policy, "nothing", { kind: "policy", rules: securePolicy.filter((r) => r !== "role") as Rule[] }).passed, true, "scope already mirrors roles here: a second valid policy");
});

test("progress: units complete once every check is right; challenges complete, then master in two variants", () => {
  const storage = memory();
  const unit = identityUnits[0];
  const ids = unitCheckIds(unit as unknown as ConceptUnit);
  for (const id of ids.slice(0, -1)) recordUnitCheck(storage, unit.id, id, true, ids);
  assert.equal(loadIdentityProgress(storage).units[unit.id].completedAt, undefined);
  recordUnitCheck(storage, unit.id, ids.at(-1)!, true, ids);
  const done = loadIdentityProgress(storage).units[unit.id].completedAt;
  assert.ok(done);
  recordUnitCheck(storage, unit.id, ids[0], false, ids);
  assert.equal(loadIdentityProgress(storage).units[unit.id].completedAt, done, "a later wrong answer never un-completes");

  recordAttempt(storage, "validate-id-token", "1", "nonce", false, 4);
  assert.equal(challengeState(challengeRecordFor(loadIdentityProgress(storage), "validate-id-token", "1")), "in-progress");
  recordAttempt(storage, "validate-id-token", "1", "nonce", true, 4);
  recordAttempt(storage, "validate-id-token", "1", "nonce", true, 4);
  assert.equal(challengeState(challengeRecordFor(loadIdentityProgress(storage), "validate-id-token", "1")), "completed", "the same variant twice doesn't master");
  recordAttempt(storage, "validate-id-token", "1", "aud", true, 4);
  assert.equal(challengeState(challengeRecordFor(loadIdentityProgress(storage), "validate-id-token", "1")), "mastered");
  recordAttempt(storage, "phishing-resistant", "1", "proxy", true, 1);
  assert.equal(challengeState(challengeRecordFor(loadIdentityProgress(storage), "phishing-resistant", "1")), "completed", "a one-version challenge completes");

  // The track reads the same records.
  const evidence = { learning: { version: 1, lessons: {} }, progress: { version: 2, missions: {} }, network: { version: 1, missions: {} }, visits: { version: 1, activities: {} }, architecture: { version: 1, lessons: {}, challenges: {} }, labs: { version: 1, labs: {}, units: {} }, identity: loadIdentityProgress(storage) } as unknown as Evidence;
  const unitActivity = locate(`id:${unit.id}`)!.activity;
  const challenge = locate("idc:validate-id-token")!.activity;
  assert.equal(activityState(unitActivity, evidence), "completed");
  assert.equal(activityState(challenge, evidence), "mastered");
  assert.equal(canMaster(challenge), true);
  assert.equal(canMaster(locate("idc:phishing-resistant")!.activity), false);
  assert.notEqual(recommend(evidence, findTrack("identity")!.stages).kind, "start");
});

test("progress: damaged data is kept aside, a newer store is never overwritten, and nothing secret is stored", () => {
  const damaged = memory({ [IDENTITY_KEY]: "{not json" });
  savePlayground(damaged, "oidc-login", { client: "web" });
  assert.equal(damaged.data.get(`${IDENTITY_KEY}.corrupt`), "{not json");
  const newer = memory({ [IDENTITY_KEY]: JSON.stringify({ version: 2, units: {} }) });
  assert.equal(recordUnitCheck(newer, "oidc", "why-oidc", true, ["why-oidc"]).saved, false);
  assert.equal(newer.data.get(IDENTITY_KEY), JSON.stringify({ version: 2, units: {} }));
  const s = memory();
  savePlayground(s, "oidc-login", Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, "x".repeat(500)])));
  const saved = loadIdentityProgress(s).prefs.playground!;
  assert.ok(Object.keys(saved.config!).length <= 12 && Object.values(saved.config!).every((v) => v.length <= 60), "bounded");
});

test("identity routes parse; unknown identity pages are not found", () => {
  assert.deepEqual(parseRoute("/learn/identity"), { name: "learn", section: "identity" });
  assert.deepEqual(parseRoute("/learn/identity/oidc"), { name: "identity-unit", id: "oidc" });
  assert.deepEqual(parseRoute("/practice/identity"), { name: "identity-playground" });
  assert.deepEqual(parseRoute("/practice/identity/tokens"), { name: "identity-tokens" });
  assert.deepEqual(parseRoute("/practice/identity/authorization"), { name: "identity-authorization" });
  assert.deepEqual(parseRoute("/practice/identity/challenges/saml-failure"), { name: "identity-challenge", id: "saml-failure" });
  assert.deepEqual(parseRoute("/lab/identity/pkce"), { name: "engineering-lab", subject: "identity", id: "pkce" });
  assert.equal(parseRoute("/learn/identity/%E0%A4%A").name, "not-found");
  assert.equal(parseRoute("/practice/identity/challenges/a/b").name, "not-found");
});

// ---- The teaching resource server (worker/identity-lab.ts) ----
const call = (path: string, init: RequestInit = {}) => handleLab(new Request(`http://lab.test${path}`, init));
const bearer = (t: string) => ({ headers: { authorization: `Bearer ${t}` } });

test("the lab resource server: real signature checks, the right status for each token, and no reflection", async () => {
  const expect = async (token: string | null, status: number, check: string) => {
    const r = await call("/api/lab/identity/orders/123", token === null ? {} : bearer(token));
    assert.equal(r.status, status, check);
    assert.equal(r.headers.get("x-lab-check"), check, check);
    const body = await r.text();
    if (token) assert.ok(!body.includes(token) && !body.includes(token.split(".")[1]), `${check}: token not reflected`);
  };
  await expect(null, 401, "missing");
  await expect(LAB_TOKENS.alice, 200, "allowed");
  await expect(LAB_TOKENS.forged, 401, "signature");
  await expect(LAB_TOKENS.aliceOtherApi, 401, "audience");
  await expect(LAB_TOKENS.aliceExpired, 401, "expiry");
  await expect(LAB_TOKENS.aliceNoScope, 403, "scope");
  await expect(LAB_TOKENS.dave, 404, "tenant");
  const [h, p, s] = LAB_TOKENS.alice.split(".");
  const tampered = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, "base64url").toString()), scope: "orders.read orders.delete" })).toString("base64url")}.${s}`;
  await expect(tampered, 401, "signature");
  // A foreign token (not naming the lab key) is refused without its payload being read or described.
  const foreign = `${Buffer.from(JSON.stringify({ alg: "RS256", kid: "someone-elses-key" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "real-user", email: "person@company.test" })).toString("base64url")}.c2ln`;
  const r = await call("/api/lab/identity/orders/123", bearer(foreign));
  const text = await r.text();
  assert.equal(r.status, 401);
  assert.ok(!/real-user|person@company/.test(text), "nothing about a foreign token is echoed");
  assert.equal((await call("/api/lab/identity/orders/123", bearer("x".repeat(5000)))).status, 401, "oversized tokens refused");
  assert.equal((await call("/api/lab/identity/orders/123", { method: "POST", headers: { authorization: `Bearer ${LAB_TOKENS.alice}` } })).status, 405);
  assert.equal((await call("/api/lab/identity/orders/123", { headers: { authorization: `Bearer ${LAB_TOKENS.alice}`, "sec-fetch-site": "cross-site" } })).status, 403, "other sites can't use it");
});

test("the lab's discovery document and JWKS publish only public material", async () => {
  const d = await (await call("/api/lab/identity/.well-known/openid-configuration")).json() as Record<string, unknown>;
  assert.equal(d.issuer, "https://idp.lab.kitab.example");
  assert.equal(d.token_endpoint, undefined, "no token endpoint: the lab issues nothing");
  const jwks = await (await call("/api/lab/identity/jwks")).json() as { keys: Record<string, unknown>[] };
  assert.equal(jwks.keys.length, 1);
  for (const field of ["d", "p", "q", "dp", "dq", "qi"]) assert.equal(jwks.keys[0][field], undefined, `no private ${field}`);
});

test("saved lab drafts never keep a real credential, only the lab's synthetic tokens", () => {
  const storage = memory();
  saveLab(storage, "protected-api", 1, (r) => ({ ...r, drafts: {
    valid: { method: "GET", path: "/api/lab/identity/orders/123", headers: [{ name: "Authorization", value: `Bearer ${LAB_TOKENS.alice}` }], body: "", timeoutMs: 8000, cache: "no-store" },
    mine: { method: "GET", path: "/api/lab/echo", headers: [{ name: "authorization", value: "Bearer eyJhbGciOiJSUzI1NiJ9.real-looking.sig" }, { name: "Cookie", value: "session=abc" }, { name: "Accept", value: "text/plain" }], body: "", timeoutMs: 8000, cache: "no-store" },
  } }));
  const drafts = readLabs(storage).records.labs["protected-api"].drafts!;
  assert.equal(drafts.valid.headers[0].value, `Bearer ${LAB_TOKENS.alice}`, "lab token kept");
  assert.deepEqual(drafts.mine.headers.map((h) => h.value), ["", "", "text/plain"], "real credentials dropped");
  assert.ok(!storage.data.get(LAB_PROGRESS_KEY)!.includes("real-looking"));
});
