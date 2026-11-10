import test from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "./support/network-scenarios.ts";
import { stageAt, stagesOf } from "../src/practice/network/stages.ts";

const all = scenarios();
const stagesFor = (name: string) => {
  const s = all.find((x) => x.name === name)!;
  return { s, stages: stagesOf(s.trace.events, s.network) };
};

test("stages partition every trace: each event in exactly one stage, in the original order", () => {
  for (const s of all) {
    const stages = stagesOf(s.trace.events, s.network);
    assert.equal(stages[0].start, 0, s.name);
    assert.equal(stages.at(-1)!.end, s.trace.events.length - 1, s.name);
    stages.forEach((stage, k) => {
      assert.ok(stage.end >= stage.start, `${s.name} stage ${k}`);
      if (k) assert.equal(stage.start, stages[k - 1].end + 1, `${s.name}: stage ${k} follows stage ${k - 1}`);
      assert.doesNotMatch(`${stage.title} ${stage.summary}`, /undefined|NaN|\[object/, `${s.name}: ${stage.title}`);
    });
    s.trace.events.forEach((_, i) => assert.ok(stages[stageAt(stages, i)].start <= i && i <= stages[stageAt(stages, i)].end));
    // Summaries describe only what happened inside the stage: its links come from its own events.
    for (const stage of stages)
      assert.deepEqual(stage.hops, s.trace.events.slice(stage.start, stage.end + 1).flatMap((e) => (e.hop ? [e.hop] : [])));
  }
});

test("a long HTTP journey reads as named stages", () => {
  const { s, stages } = stagesFor("internet: HTTP by name");
  assert.equal(s.trace.events.length, 489);
  assert.equal(stages.length, 27);
  assert.deepEqual(
    stages.filter((x) => x.title.startsWith("ARP")).map((x) => x.title),
    ["ARP · Your PC looks for 192.168.1.1", "ARP · Home router looks for 203.0.113.1", "ARP · ISP router looks for 198.51.100.53", "ARP · ISP router looks for 198.51.100.20"],
  );
  const answer = stages.find((x) => x.title === "DNS answer · DNS server → Your PC")!;
  assert.match(answer.summary, /forwarded by ISP router and Home router; Home router restored its destination to 192\.168\.1\.10:53000; it was delivered to Your PC/);
  // The four segments that close the connection read as one stage, listed in the order they were sent.
  const close = stages.find((x) => x.title === "Close the connection · Your PC ↔ kitab.test")!;
  assert.match(close.summary, /4 segments: Your PC → kitab.test FIN, ACK; kitab.test → Your PC ACK; kitab.test → Your PC FIN, ACK; Your PC → kitab.test ACK/);
  // TCP-only stages use plain names.
  assert.deepEqual(
    stages.filter((x) => x.title.startsWith("TCP")).map((x) => x.title.split(" · ")[0]),
    ["TCP handshake: SYN", "TCP handshake: SYN", "TCP handshake: SYN-ACK", "TCP acknowledgement", "TCP acknowledgement", "TCP acknowledgement", "TCP acknowledgement"],
  );
});

test("DHCP, loss and failures get their own accurate stages", () => {
  assert.deepEqual(stagesFor("wifi: phone DHCP").stages.map((x) => x.title), [
    "Join Wi-Fi · Your phone",
    "DHCP Discover · Your phone",
    "DHCP Offer · Home router",
    "DHCP Request · Your phone",
    "DHCP ACK · Home router",
  ]);
  const loss = stagesFor("internet: HTTP with one loss").stages;
  const lost = loss.find((x) => x.title === "HTTP request · lost after leaving Your PC")!;
  assert.match(lost.summary, /was lost on its first link, between Your PC and Home switch, so it never arrived/);
  assert.match(loss[loss.indexOf(lost) + 1].summary, /^No ACK came back, so Your PC resent the same bytes/);
  const failed = stagesFor("fail: wrong gateway").stages.at(-1)!;
  assert.equal(failed.error, true);
  assert.equal(failed.title, "Stopped at Your PC: Nobody uses the next-hop address");
});
