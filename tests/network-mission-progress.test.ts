import test from "node:test";
import assert from "node:assert/strict";
import { missions } from "../src/practice/network/missions.ts";
import {
  MISSIONS_KEY,
  loadMissionStore,
  masteredVariants,
  missionState,
  notYetMastered,
  recordAttempt,
  saveMissionStore,
  type MissionAttempt,
} from "../src/practice/network/mission-progress.ts";
import { CHALLENGES_KEY } from "../src/practice/network/storage.ts";
import { PROGRESS_KEY, practiceState } from "../src/learning/progress.ts";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
}
const join = missions.find((m) => m.id === "join-and-address")!;
const strong = (variant: string, startedAt: string): MissionAttempt => ({
  variant,
  startedAt,
  completedAt: "2026-11-10T10:00:00Z",
  diagnosis: "first-try",
  evidence: true,
  explanation: true,
  prediction: true,
  hints: 0,
});

test("fixing the network completes a mission even without a diagnosis; mastery needs more and says what", () => {
  let s = loadMissionStore(memory());
  assert.equal(missionState(s.missions[join.id], join), "not-started");
  s = recordAttempt(s, join, { ...strong("passphrase", "a"), completedAt: null, diagnosis: null, evidence: false, explanation: null });
  assert.equal(missionState(s.missions[join.id], join), "in-progress");
  s = recordAttempt(s, join, { ...strong("passphrase", "a"), diagnosis: null, evidence: false, explanation: null });
  assert.equal(missionState(s.missions[join.id], join), "completed");
  const why = notYetMastered(s.missions[join.id], join).join(" ");
  assert.match(why, /first try/);
  assert.match(why, /step in the journey/);
  assert.match(why, /explanation/);
  assert.match(why, /two versions with different causes/);
});

test("mastery needs two versions with different causes, each with full evidence and without the last hint", () => {
  let s = loadMissionStore(memory());
  // Passphrase and network name are both the phone's Wi-Fi settings: the same fix twice is not mastery.
  s = recordAttempt(s, join, strong("passphrase", "a"));
  s = recordAttempt(s, join, strong("ssid", "b"));
  assert.deepEqual(masteredVariants(s.missions[join.id], join), ["passphrase"]);
  assert.equal(missionState(s.missions[join.id], join), "completed");
  assert.match(notYetMastered(s.missions[join.id], join).join(" "), /one more version with a different cause/);
  // The last hint does not count towards mastery, but nothing is taken away.
  s = recordAttempt(s, join, { ...strong("dhcp-off", "c"), hints: 3 });
  assert.equal(missionState(s.missions[join.id], join), "completed");
  s = recordAttempt(s, join, { ...strong("dhcp-off", "d"), hints: 2 });
  assert.equal(missionState(s.missions[join.id], join), "mastered");
  assert.deepEqual(notYetMastered(s.missions[join.id], join), []);
  // A wrong first diagnosis is fine for completion, not for mastery evidence.
  let t = recordAttempt(loadMissionStore(memory()), join, { ...strong("static", "e"), diagnosis: "later" });
  t = recordAttempt(t, join, strong("pool", "f"));
  assert.equal(missionState(t.missions[join.id], join), "completed");
});

test("earlier challenge completions are kept as completed, never as mastery", () => {
  const storage = memory({ [CHALLENGES_KEY]: JSON.stringify(["subnet", "nat", "unknown"]) });
  const s = loadMissionStore(storage);
  const neighbours = missions.find((m) => m.id === "neighbours")!;
  assert.equal(missionState(s.missions.neighbours, neighbours), "completed");
  assert.equal(missionState(s.missions["bring-reply-home"], missions.find((m) => m.id === "bring-reply-home")!), "completed");
  assert.equal(s.missions["no-connection"], undefined);
  assert.match(notYetMastered(s.missions.neighbours, neighbours)[0], /earlier version/);
  // New attempts build on it without losing the completion.
  const next = recordAttempt(s, neighbours, { ...strong("pc-mask", "x"), completedAt: null });
  assert.equal(missionState(next.missions.neighbours, neighbours), "completed");
  assert.ok(saveMissionStore(storage, next));
  assert.equal(storage.getItem(CHALLENGES_KEY), JSON.stringify(["subnet", "nat", "unknown"]), "old data is not overwritten");
});

test("damaged mission progress is recovered without crashing or touching other subjects", () => {
  const storage = memory({ [MISSIONS_KEY]: "{not json", [PROGRESS_KEY]: "untouched" });
  assert.deepEqual(loadMissionStore(storage).missions, {});
  const bad = memory({ [MISSIONS_KEY]: JSON.stringify({ version: 1, missions: { x: { evil: true } } }) });
  assert.deepEqual(loadMissionStore(bad).missions, {});
  assert.equal(storage.getItem(PROGRESS_KEY), "untouched");
});

test("TCP missions use the same four states", () => {
  const p = (missions: object) => ({ version: 1, missions }) as never;
  assert.equal(practiceState(p({}), "tcp-lab", "1.0.0"), "not-started");
  const base = { missionVersion: "1.0.0", visits: 1, lastVisitedAt: "", masteredAt: null, attempts: [], current: null };
  assert.equal(practiceState(p({ "tcp-lab": base }), "tcp-lab", "1.0.0"), "in-progress");
  const done = { attemptId: "a", number: 1, variantId: "v", scenarioKey: "", status: "explanation-missed", predictionCorrect: true, explanationCorrect: false, reasoning: "", at: "" };
  assert.equal(practiceState(p({ "tcp-lab": { ...base, attempts: [done] } }), "tcp-lab", "1.0.0"), "completed");
  assert.equal(practiceState(p({ "tcp-lab": { ...base, attempts: [done], masteredAt: "x" } }), "tcp-lab", "1.0.0"), "mastered");
});
