import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute, redirectFor } from "../src/app/routes.ts";

test("routes parse missions, concepts and drafts, with trailing slashes", () => {
  assert.deepEqual(parseRoute("/"), { name: "home" });
  assert.deepEqual(parseRoute("/missions/tcp-lab/"), { name: "mission", id: "tcp-lab" });
  assert.deepEqual(parseRoute("/concepts/dns"), { name: "concept", slug: "dns" });
  assert.deepEqual(parseRoute("/learn/hello-tcp/"), { name: "lesson", id: "hello-tcp" });
  assert.deepEqual(parseRoute("/drafts/binary%20heap"), { name: "draft", slug: "binary heap" });
});

test("malformed or hostile paths become not-found instead of throwing", () => {
  for (const path of ["/missions/%E0%A4%A", "/missions/%", "/missions/a/b", "/learn/", "/learn/a/b", "/drafts/%3Cscript%3E", "/missions/", "/unknown/x", "/drafts/" + "a".repeat(200)]) {
    assert.equal(parseRoute(path).name, "not-found", path);
  }
});

test("legacy addresses keep working", () => {
  assert.equal(redirectFor("/lesson/tcp"), "/missions/tcp-lab");
  assert.equal(redirectFor("/lesson/tcp/anything"), "/missions/tcp-lab");
  assert.equal(redirectFor("/visual-lab/"), "/missions/tcp-lab");
  assert.equal(redirectFor("/lesson/data-structures"), "/missions/ds-lab");
  assert.equal(redirectFor("/missions/tcp-lab"), undefined);
});
