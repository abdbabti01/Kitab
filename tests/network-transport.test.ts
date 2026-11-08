import test from "node:test";
import assert from "node:assert/strict";
import { receiveBytes } from "../src/practice/network/transport.ts";
test("TCP suppresses duplicates and waits for a missing byte range", () => {
  let b = {
    next: 100,
    delivered: "",
    pending: {} as Record<number, string>,
    duplicates: 0,
  };
  b = receiveBytes(b, 103, "def");
  assert.equal(b.next, 100);
  assert.equal(b.delivered, "");
  b = receiveBytes(b, 100, "abc");
  assert.equal(b.next, 106);
  assert.equal(b.delivered, "abcdef");
  b = receiveBytes(b, 100, "abc");
  assert.equal(b.delivered, "abcdef");
  assert.equal(b.duplicates, 1);
});
test("TCP advances by UTF-8 bytes", () => {
  const b = receiveBytes(
    { next: 1, delivered: "", pending: {}, duplicates: 0 },
    1,
    "🌍",
  );
  assert.equal(b.next, 5);
});
