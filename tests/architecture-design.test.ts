import test from "node:test";
import assert from "node:assert/strict";
import { connectionRules, configFor, MAX_NODES, newDesign, nextLabel, nextNodeId, type Design } from "../src/architecture/model.ts";
import { connectableTargets, DesignFormatError, parseDesign, validateDesign } from "../src/architecture/validate.ts";
import { build, templates } from "../src/architecture/templates.ts";
import {
  challengeRecordFor, deleteDesign, DESIGNS_KEY, duplicateDesign, exportDesign, importDesign, loadArchitectureProgress, loadDesigns,
  MAX_DESIGNS, MAX_IMPORT_BYTES, PROGRESS_KEY, recordChallengeCheck, recordExperiment, saveChallengeDesign, saveDesign,
} from "../src/architecture/persistence.ts";

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const codes = (design: Design) => validateDesign(design).errors.map((e) => e.code);
const basic = () => templates.find((t) => t.id === "three-tier")!.design();

// ---- Validation ----

test("every template is valid and every connection in it follows a rule", () => {
  for (const t of templates) {
    const v = validateDesign(t.design());
    if (t.id === "blank") assert.deepEqual(v.errors.map((e) => e.code), ["no-client"]);
    else assert.ok(v.ok, `${t.id}: ${v.errors.map((e) => e.message).join("; ")}`);
  }
});

test("connections not in the rule table are errors, with both components named", () => {
  const d = basic();
  d.edges.push({ id: "bad", from: "client-1", to: "sql-1", kind: "request" });
  const issue = validateDesign(d).errors.find((e) => e.code === "connection-not-allowed")!;
  assert.deepEqual(issue.nodes, ["client-1", "sql-1"]);
  assert.match(issue.message, /Client can't send requests to a SQL database/);
  // The right pair with the wrong kind is refused too.
  const wrongKind = basic();
  wrongKind.edges[1] = { ...wrongKind.edges[1], kind: "async" };
  assert.ok(codes(wrongKind).includes("connection-not-allowed"));
});

test("the rules never let a client reach a database or a queue directly", () => {
  for (const rule of connectionRules) if (rule.from === "client") assert.ok(!["sql", "nosql", "queue", "cache", "worker"].includes(rule.to));
});

test("duplicates, self-connections and missing paths are found", () => {
  const d = basic();
  d.edges.push({ ...d.edges[0], id: "dup" });
  assert.ok(codes(d).includes("duplicate-connection"));
  const lonely = build("t", [["client-1", "client", "U", 0, 0]], []);
  assert.deepEqual(codes(lonely), ["client-unconnected"]);
  const onlyFiles = build("t", [["client-1", "client", "U", 0, 0], ["object-storage-1", "object-storage", "S", 0, 0]], [["client-1", "object-storage-1"]]);
  assert.deepEqual(codes(onlyFiles), ["no-api-path"]);
  const self = basic();
  self.nodes.push({ ...self.nodes[2], id: "sql-2", label: "Copy" });
  self.edges.push({ id: "loop", from: "sql-2", to: "sql-2", kind: "replication" });
  assert.ok(codes(self).includes("self-connection"));
});

test("structure rules: one primary database per server, replicas used with their primary, one level of replicas", () => {
  const two = build("t", [["client-1", "client", "U", 0, 0], ["api-1", "api", "A", 0, 0], ["sql-1", "sql", "D1", 0, 0], ["nosql-1", "nosql", "D2", 0, 0]], [["client-1", "api-1"], ["api-1", "sql-1"], ["api-1", "nosql-1"]]);
  assert.ok(codes(two).includes("two-databases"));
  const orphanReplica = build("t", [["client-1", "client", "U", 0, 0], ["api-1", "api", "A", 0, 0], ["sql-1", "sql", "P", 0, 0], ["sql-2", "sql", "R", 0, 0]], [["client-1", "api-1"], ["api-1", "sql-2"], ["sql-1", "sql-2"]]);
  assert.ok(codes(orphanReplica).includes("replica-without-primary"));
  const chain = build("t", [["client-1", "client", "U", 0, 0], ["api-1", "api", "A", 0, 0], ["sql-1", "sql", "P", 0, 0], ["sql-2", "sql", "R", 0, 0], ["sql-3", "sql", "R2", 0, 0]], [["client-1", "api-1"], ["api-1", "sql-1"], ["sql-1", "sql-2"], ["sql-2", "sql-3"]]);
  assert.ok(codes(chain).includes("replica-chain"));
  const lb = build("t", [["client-1", "client", "U", 0, 0], ["load-balancer-1", "load-balancer", "LB", 0, 0]], [["client-1", "load-balancer-1"]]);
  assert.ok(codes(lb).includes("lb-no-targets"));
});

test("warnings teach without blocking a run", () => {
  const d = build("t", [["client-1", "client", "U", 0, 0], ["api-1", "api", "A", 0, 0], ["queue-1", "queue", "Q", 0, 0]], [["client-1", "api-1"], ["api-1", "queue-1"]]);
  const v = validateDesign(d);
  assert.ok(v.ok);
  assert.deepEqual(v.warnings.map((w) => w.code), ["queue-no-workers"]);
  const memoryOnly = build("t", [["client-1", "client", "U", 0, 0], ["api-1", "api", "A", 0, 0]], [["client-1", "api-1"]]);
  assert.deepEqual(validateDesign(memoryOnly).warnings.map((w) => w.code), ["no-database"]);
});

test("a run larger than the simulator's bound is refused before it starts", () => {
  const d = basic();
  (d.nodes[0].config as { rps: number }).rps = 2000;
  d.workload.durationS = 60;
  assert.ok(codes(d).includes("too-much-traffic"));
  const mix = basic();
  Object.assign(mix.nodes[0].config, { writePercent: 60, assetPercent: 60 });
  assert.ok(codes(mix).includes("mix-over-100"));
});

test("connectable targets list only allowed, new connections", () => {
  const d = basic();
  assert.deepEqual(connectableTargets(d, "client-1").map((n) => n.id), []);
  assert.deepEqual(connectableTargets(d, "api-1").map((n) => n.id), []);
  d.nodes.push({ id: "cache-1", kind: "cache", label: "Cache", x: 0, y: 0, config: configFor("cache") });
  assert.deepEqual(connectableTargets(d, "api-1").map((n) => n.id), ["cache-1"]);
});

test("new ids and labels are readable and unique", () => {
  const d = basic();
  assert.equal(nextNodeId(d, "api"), "api-2");
  assert.equal(nextLabel(d, "api"), "API server 2");
  assert.equal(nextNodeId(d, "cache"), "cache-1");
});

// ---- Parsing untrusted documents ----

test("parsing fills defaults for missing settings, so older designs still load", () => {
  const raw = JSON.parse(JSON.stringify(basic()));
  delete raw.workload;
  delete raw.faults;
  raw.nodes[1].config = { concurrency: 4 };
  const d = parseDesign(raw);
  assert.equal(d.workload.durationS, 10);
  assert.deepEqual(d.nodes[1].config, { concurrency: 4, serviceMs: 20, queueLimit: 50 });
});

test("parsing refuses newer formats, unknown kinds, unknown fields, out-of-range values and broken references", () => {
  const good = JSON.parse(JSON.stringify(basic()));
  const broken = (change: (d: any) => void) => {
    const copy = structuredClone(good);
    change(copy);
    return () => parseDesign(copy);
  };
  assert.throws(broken((d) => (d.version = 2)), /newer version/);
  assert.throws(broken((d) => (d.nodes[0].kind = "mainframe")), DesignFormatError);
  assert.throws(broken((d) => (d.surprise = true)), DesignFormatError);
  assert.throws(broken((d) => (d.nodes[1].config.concurrency = 1e9)), /out of range/);
  assert.throws(broken((d) => (d.nodes[1].config.script = "alert(1)")), /out of range/);
  assert.throws(broken((d) => (d.edges[0].to = "ghost")), /doesn't exist/);
  assert.throws(broken((d) => (d.nodes[1].id = d.nodes[0].id)), /share the id/);
  assert.throws(broken((d) => (d.faults = [{ node: "ghost", fromS: 1, toS: 2 }])), /doesn't exist/);
  assert.throws(broken((d) => (d.nodes = Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ ...d.nodes[0], id: `n-${i}` })))), DesignFormatError);
  assert.throws(broken((d) => (d.nodes[0].label = "<b>" + "x".repeat(100))), DesignFormatError);
  assert.throws(() => parseDesign(null), DesignFormatError);
});

// ---- Saved designs ----

test("designs save, list newest first, rename, duplicate and delete", () => {
  const s = memory();
  const a = { ...basic(), id: "d-a", name: "First" };
  const b = { ...basic(), id: "d-b", name: "Second" };
  assert.ok(saveDesign(s, a, "2026-11-01T00:00:00.000Z"));
  assert.ok(saveDesign(s, b, "2026-11-02T00:00:00.000Z"));
  assert.deepEqual(loadDesigns(s).designs.map((d) => d.name), ["Second", "First"]);
  saveDesign(s, { ...a, name: "Renamed" }, "2026-11-03T00:00:00.000Z");
  assert.deepEqual(loadDesigns(s).designs.map((d) => d.name), ["Renamed", "Second"]);
  const copy = duplicateDesign(s, b, "d-c", "2026-11-04T00:00:00.000Z")!;
  assert.equal(copy.name, "Second (copy)");
  assert.equal(loadDesigns(s).designs.length, 3);
  deleteDesign(s, "d-a");
  assert.deepEqual(loadDesigns(s).designs.map((d) => d.id), ["d-c", "d-b"]);
});

test("a saved design round-trips exactly", () => {
  const s = memory();
  const d = { ...templates.find((t) => t.id === "load-balanced")!.design(), id: "d-x", faults: [{ node: "api-1", fromS: 1, toS: 2 }] };
  saveDesign(s, d, "2026-11-01T00:00:00.000Z");
  assert.deepEqual(loadDesigns(s).designs[0], { ...d, updatedAt: "2026-11-01T00:00:00.000Z" });
});

test("unreadable saved designs are reported and preserved untouched when others are saved", () => {
  const future = { format: "kitab.architecture", version: 9, id: "d-future", name: "From the future" };
  const s = memory({ [DESIGNS_KEY]: JSON.stringify({ version: 1, designs: [future, { junk: true }] }) });
  const loaded = loadDesigns(s);
  assert.equal(loaded.designs.length, 0);
  assert.equal(loaded.unreadable.length, 2);
  assert.match(loaded.unreadable[0].reason, /newer version/);
  saveDesign(s, { ...basic(), id: "d-new" });
  const raw = JSON.parse(s.data.get(DESIGNS_KEY)!);
  assert.deepEqual(raw.designs.slice(0, 2), [future, { junk: true }]);
  assert.equal(raw.designs.length, 3);
});

test("a damaged store is kept aside, never lost", () => {
  const s = memory({ [DESIGNS_KEY]: "{not json" });
  assert.deepEqual(loadDesigns(s).designs, []);
  assert.equal(s.data.get(`${DESIGNS_KEY}.corrupt`), "{not json");
});

test("saving refuses when the list is full or storage fails, without throwing", () => {
  const s = memory();
  for (let i = 0; i < MAX_DESIGNS; i++) assert.ok(saveDesign(s, { ...basic(), id: `d-${i}` }));
  assert.equal(saveDesign(s, { ...basic(), id: "d-over" }), false);
  assert.ok(saveDesign(s, { ...basic(), id: "d-0", name: "Still editable" }), "existing designs can still be saved");
  const refusing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.equal(saveDesign(refusing, basic()), false);
});

test("import gives a new id, and refuses oversized, non-JSON, foreign and invalid files", () => {
  const d = basic();
  const imported = importDesign(exportDesign(d), "d-imported", "2026-11-05T00:00:00.000Z");
  assert.equal(imported.id, "d-imported");
  assert.deepEqual(imported.nodes, d.nodes);
  assert.throws(() => importDesign("x".repeat(MAX_IMPORT_BYTES + 1)), /too large/);
  assert.throws(() => importDesign("{"), /valid JSON/);
  assert.throws(() => importDesign(JSON.stringify({ version: 1, devices: [] })), /isn't a Kitab architecture/);
  assert.throws(() => importDesign(JSON.stringify({ ...d, nodes: "lots" })), DesignFormatError);
});

// ---- Progress ----

test("challenge progress counts checks, keeps the first pass and the cheapest passing design", () => {
  const s = memory();
  recordChallengeCheck(s, "simple-web-app", "1", { passed: false, cost: 2, p95: 100 }, "2026-11-01T00:00:00.000Z");
  recordChallengeCheck(s, "simple-web-app", "1", { passed: true, cost: 8, p95: 110 }, "2026-11-02T00:00:00.000Z");
  recordChallengeCheck(s, "simple-web-app", "1", { passed: true, cost: 6, p95: 117 }, "2026-11-03T00:00:00.000Z");
  const record = challengeRecordFor(loadArchitectureProgress(s), "simple-web-app", "1")!;
  assert.equal(record.attempts, 3);
  assert.equal(record.passedAt, "2026-11-02T00:00:00.000Z");
  assert.deepEqual(record.best, { cost: 6, p95: 117 });
  // A new challenge version starts again.
  assert.equal(challengeRecordFor(loadArchitectureProgress(s), "simple-web-app", "2"), undefined);
});

test("a working design is kept per challenge; experiments are recorded per lesson; damage is kept aside", () => {
  const s = memory();
  saveChallengeDesign(s, "simple-web-app", "1", basic(), "2026-11-01T00:00:00.000Z");
  recordExperiment(s, "fundamentals", "2026-11-01T00:00:00.000Z");
  const p = loadArchitectureProgress(s);
  assert.deepEqual(parseDesign(p.challenges["simple-web-app"].design), basic());
  assert.equal(p.lessons.fundamentals.experimentAt, "2026-11-01T00:00:00.000Z");
  const damaged = memory({ [PROGRESS_KEY]: "[]" });
  assert.deepEqual(loadArchitectureProgress(damaged), { version: 1, challenges: {}, lessons: {} });
  assert.equal(damaged.data.get(`${PROGRESS_KEY}.corrupt`), "[]");
  assert.deepEqual(newDesign("x", "d-1", "t").nodes, []);
});
