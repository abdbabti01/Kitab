import assert from "node:assert/strict";
import test from "node:test";
import { LEARN_SECTIONS, parseRoute, redirectFor } from "../src/app/routes.ts";
import { journeys, lessons } from "../src/learning/lessons/catalog.ts";

test("routes parse missions, concepts and drafts, with trailing slashes", () => {
  assert.deepEqual(parseRoute("/"), { name: "home" });
  assert.deepEqual(parseRoute("/missions/tcp-lab/"), { name: "mission", id: "tcp-lab" });
  assert.deepEqual(parseRoute("/concepts/dns"), { name: "concept", slug: "dns" });
  assert.deepEqual(parseRoute("/learn/hello-tcp/"), { name: "lesson", id: "hello-tcp" });
  assert.deepEqual(parseRoute("/drafts/binary%20heap"), { name: "draft", slug: "binary heap" });
});

test("malformed or hostile paths become not-found instead of throwing", () => {
  for (const path of ["/missions/%E0%A4%A", "/missions/%", "/missions/a/b", "/learn/a/b", "/practice/x/y", "/drafts/%3Cscript%3E", "/missions/", "/unknown/x", "/drafts/" + "a".repeat(200)]) {
    assert.equal(parseRoute(path).name, "not-found", path);
  }
});

test("Learn and Practice are real pages; every lesson address still opens its lesson", () => {
  assert.deepEqual(parseRoute("/learn"), { name: "learn", section: "networking" });
  assert.deepEqual(parseRoute("/learn/"), { name: "learn", section: "networking" });
  assert.deepEqual(parseRoute("/learn/data-structures"), { name: "learn", section: "data-structures" });
  assert.deepEqual(parseRoute("/learn/library"), { name: "learn", section: "library" });
  assert.deepEqual(parseRoute("/practice"), { name: "practice" });
  assert.deepEqual(parseRoute("/practice/missions"), { name: "network-missions" });
  for (const lesson of [...lessons, ...journeys]) {
    assert.ok(!(LEARN_SECTIONS as readonly string[]).includes(lesson.id), `${lesson.id} must not share a Learn section's address`);
    assert.deepEqual(parseRoute(`/learn/${lesson.id}`), { name: "lesson", id: lesson.id });
  }
});

test("Home's old section anchors open their new pages", () => {
  assert.equal(redirectFor("/", "#path"), "/learn");
  assert.equal(redirectFor("/", "#journeys"), "/learn");
  assert.equal(redirectFor("/", "#missions"), "/practice");
  assert.equal(redirectFor("/", "#concepts"), "/learn/library");
  assert.equal(redirectFor("/", "#main"), undefined, "the skip link and other anchors are untouched");
  assert.equal(redirectFor("/learn", "#path"), undefined);
});

test("legacy addresses keep working", () => {
  assert.equal(redirectFor("/lesson/tcp"), "/missions/tcp-lab");
  assert.equal(redirectFor("/lesson/tcp/anything"), "/missions/tcp-lab");
  assert.equal(redirectFor("/visual-lab/"), "/missions/tcp-lab");
  assert.equal(redirectFor("/lesson/data-structures"), "/missions/ds-lab");
  assert.equal(redirectFor("/missions/tcp-lab"), undefined);
});
