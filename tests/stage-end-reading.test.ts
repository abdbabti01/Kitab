// A stage's summary is held for its reading time: about 10 words a second, by words, within limits.
import test from "node:test";
import assert from "node:assert/strict";
import { stageEndMs } from "../src/practice/network/motion.ts";

test("a stage's reading time counts its words, not its letter s", () => {
  // 15 words without an "s": 1.5 s to read.
  assert.equal(stageEndMs("the PC put the frame on the link to the home router and it went"), 1500);
  // The same 4 words read in the same time whatever letters they hold, and a short summary gets the minimum.
  assert.equal(stageEndMs("sss ssss sssss ss"), stageEndMs("aaa aaaa aaaaa aa"));
  assert.equal(stageEndMs("Your PC finds 192.168.1.1"), 700);
  // Line breaks and repeated spaces separate words too; a long summary is capped.
  assert.equal(stageEndMs("one\ntwo   three\tfour five six seven eight nine ten eleven twelve"), 1200);
  assert.equal(stageEndMs(Array(40).fill("word").join(" ")), 2000);
});
