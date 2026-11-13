// The subnet explorer's questions, feedback and explanations (src/net/subnet-practice.ts). Every answer must be the
// shared helper's own result, every wrong choice a distinct, explained mistake, and /0, /31 and /32 must never be
// described with a network or broadcast address they don't have.
import test from "node:test";
import assert from "node:assert/strict";
import { block, formatAddress, isAddress, parseAddress, sameSubnet } from "../src/net/ipv4.ts";
import {
  DEFAULTS,
  PRESETS,
  SPECIAL,
  blockStart,
  boundary,
  compare,
  describeRange,
  example,
  explain,
  explorerPath,
  kindNote,
  question,
  readExplorerQuery,
} from "../src/net/subnet-practice.ts";

function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
const next = random(31337);
const edges = [0, 1, 255, 256, 2 ** 24, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 2, 2 ** 32 - 1].map(formatAddress);
const addresses = [...edges, ...Array.from({ length: 2000 }, () => formatAddress(Math.floor(next() * 2 ** 32)))];
const prefixes = Array.from({ length: 33 }, (_, p) => p);

test("every question, for every prefix /0–/32, has exactly one right answer and 3–4 distinct, explained choices", () => {
  let checked = 0;
  for (const address of addresses)
    for (const prefix of prefixes) {
      const q = question(address, prefix),
        labels = q.choices.map((c) => c.label);
      assert.equal(q.choices.filter((c) => c.correct).length, 1, `${address}/${prefix}`);
      assert.ok(q.choices.length >= 3 && q.choices.length <= 4, `${address}/${prefix}: ${labels}`);
      assert.equal(new Set(labels).size, labels.length, `${address}/${prefix}: ${labels}`);
      for (const c of q.choices) if (!c.correct) assert.ok(c.feedback.length > 20, `${address}/${prefix} ${c.label}`);
      assert.ok(q.answer.length > 20);
      checked++;
    }
  assert.equal(checked, addresses.length * 33);
});

test("the right answer is the helper's own result", () => {
  for (const address of addresses.slice(0, 500))
    for (const prefix of prefixes) {
      const b = block(address, prefix),
        right = question(address, prefix).choices.find((c) => c.correct)!.label;
      if (prefix === 0) assert.equal(right, "Every IPv4 address");
      else if (prefix >= 31) assert.equal(right, String(b.usable));
      else {
        assert.equal(right, b.network);
        // Every wrong choice really is a different address, so it can't secretly be right.
        for (const c of question(address, prefix).choices) if (!c.correct) assert.notEqual(c.label, b.network);
      }
    }
});

test("each wrong choice names the mistake that produces it", () => {
  const q = question("10.20.30.77", 28),
    by = (label: string) => q.choices.find((c) => c.label === label)!;
  assert.deepEqual(q.choices.map((c) => c.label).sort(), ["10.20.30.0", "10.20.30.64", "10.20.30.77", "10.20.30.79"]);
  assert.equal(by("10.20.30.64").correct, true);
  assert.match(by("10.20.30.79").feedback, /broadcast address/);
  assert.match(by("10.20.30.0").feedback, /as \/24 would\. With \/28 the boundary is 4 bits into octet 4/);
  assert.match(by("10.20.30.77").feedback, /keeps the host bits/);
  assert.match(q.answer, /Clearing the 4 host bits of 10\.20\.30\.77 gives 10\.20\.30\.64, the first address of its 16-address block 10\.20\.30\.64\/28/);

  // A boundary on an octet edge has no "cut at a whole octet" mistake: the next block stands in.
  const lan = question("192.168.1.10", 24);
  assert.deepEqual(lan.choices.map((c) => c.label).sort(), ["192.168.1.0", "192.168.1.10", "192.168.1.255", "192.168.2.0"]);
  assert.match(lan.choices.find((c) => c.label === "192.168.2.0")!.feedback, /start of the next block\. \/24 blocks hold 256 addresses/);
  // The top block has no next block, so the previous one is used.
  assert.ok(question("255.255.255.200", 24).choices.some((c) => c.label === "255.255.254.0" && /previous block/.test(c.feedback)));
});

test("/31, /32 and /0 questions and notes never mention a network or broadcast address they don't have", () => {
  for (const address of addresses.slice(0, 300))
    for (const prefix of [31, 32]) {
      const q = question(address, prefix),
        text = [q.prompt, q.answer, ...q.choices.map((c) => c.feedback), explain(block(address, prefix), address).what].join(" ");
      assert.match(q.prompt, /How many addresses in .* can an interface use\?/);
      assert.doesNotMatch(text, /network address|broadcast address is|its broadcast/i);
    }
  assert.match(question("10.0.0.6", 31).choices.find((c) => c.label === "0")!.feedback, /RFC 3021/);
  assert.equal(question("10.0.0.6", 31).choices.find((c) => c.correct)!.label, "2");
  assert.equal(question("10.0.0.6", 32).choices.find((c) => c.correct)!.label, "1");
  const zero = question("8.8.8.8", 0);
  assert.equal(zero.prompt, "Which addresses are in 0.0.0.0/0?");
  assert.match(zero.answer, /default route/);
  assert.match(kindNote(block("8.8.8.8", 0))!, /No interface is configured with it/);
  assert.equal(kindNote(block("8.8.8.8", 24)), null);
});

test("choice order is fixed for a question and does not always put the answer first", () => {
  const firsts = new Set<boolean>();
  for (const address of addresses.slice(0, 200)) {
    assert.deepEqual(question(address, 26), question(address, 26));
    firsts.add(question(address, 26).choices[0].correct);
  }
  assert.deepEqual([...firsts].sort(), [false, true]);
});

test("the boundary text works through the octet the boundary is in", () => {
  assert.equal(boundary("10.20.30.77", 28), "The boundary is inside octet 4: 77 = 64 + 8 + 4 + 1 = 01001101 in binary. Its first 4 bits belong to the network.");
  assert.equal(boundary("172.20.200.9", 20), "The boundary is inside octet 3: 200 = 128 + 64 + 8 = 11001000 in binary. Its first 4 bits belong to the network.");
  assert.equal(boundary("10.0.0.0", 9), "The boundary is inside octet 2: 0 = 0 = 00000000 in binary. Its first bit belongs to the network.");
  assert.match(boundary("192.168.1.10", 24), /between octets 3 and 4/);
  assert.match(boundary("1.2.3.4", 0), /All 32 bits are host bits/);
  assert.match(boundary("1.2.3.4", 32), /All 32 bits are network bits/);
  for (const prefix of prefixes) assert.ok(boundary("203.0.113.7", prefix).length > 10);
});

test("explanations match the block they describe", () => {
  for (const address of addresses.slice(0, 200))
    for (const prefix of prefixes) {
      const b = block(address, prefix),
        e = explain(b, address);
      assert.ok(e.what && e.why && e.source);
      if (prefix >= 1 && prefix <= 30) assert.match(e.what, new RegExp(`keeps the first ${prefix} bits of ${address.replace(/\./g, "\\.")}\\. Clearing the other ${32 - prefix}`));
      else assert.equal(e.what, kindNote(b));
    }
  assert.match(explain(block("10.0.0.6", 31), "10.0.0.6").source, /RFC 3021/);
});

test("address types use the helper's ranges, and nothing is called public", () => {
  assert.match(describeRange("192.168.1.10").note, /^Private \(RFC 1918\)/);
  assert.match(describeRange("169.254.3.4").note, /when DHCP fails/);
  assert.match(describeRange("203.0.113.7").note, /^Documentation \(RFC 5737\)/);
  assert.match(describeRange("127.0.0.1").note, /^Loopback/);
  const other = describeRange("8.8.8.8");
  assert.equal(other.range, "other");
  assert.match(other.note, /doesn't make it a public, reachable address/);
  for (const address of addresses.slice(0, 500)) assert.doesNotMatch(describeRange(address).note, /^Public/);
});

test("same-subnet comparison is the helper's arithmetic, including /0, /31 and /32", () => {
  for (const address of addresses.slice(0, 200))
    for (const prefix of prefixes) {
      const other = addresses[(addresses.indexOf(address) * 7 + prefix) % addresses.length],
        c = compare(address, other, prefix);
      assert.equal(c.same, sameSubnet(address, other, prefix));
      assert.equal(c.own, blockStart(block(address, prefix)));
      assert.equal(c.same, c.own === c.other);
    }
  assert.deepEqual(compare("10.20.30.77", "10.20.30.90", 28), { same: false, mask: "255.255.255.240", own: "10.20.30.64", other: "10.20.30.80" });
  assert.equal(compare("10.0.0.6", "10.0.0.7", 31).same, true);
  assert.equal(compare("1.1.1.1", "200.0.0.1", 0).same, true);
});

test("generated examples are replayable, private and use preset prefixes", () => {
  let seed = 1;
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const e = example(seed);
    assert.deepEqual(example(seed), e);
    assert.ok(isAddress(e.address));
    assert.ok(PRESETS.includes(e.prefix));
    assert.equal(describeRange(e.address).range, "private", e.address);
    seen.add(`${e.address}/${e.prefix}`);
    seed = e.seed;
  }
  assert.ok(seen.size > 450);
  assert.deepEqual(SPECIAL, [0, 31, 32]);
});

test("deep links round-trip, and malformed ones fall back to the defaults without throwing", () => {
  const path = explorerPath({ address: "10.20.30.77", prefix: 28, destination: "10.20.30.90" });
  assert.equal(path, "/practice/subnets?ip=10.20.30.77&prefix=28&to=10.20.30.90");
  assert.deepEqual(readExplorerQuery(path.split("?")[1]), { address: "10.20.30.77", prefix: 28, destination: "10.20.30.90" });
  assert.deepEqual(readExplorerQuery("?ip=0.0.0.0&prefix=0"), { address: "0.0.0.0", prefix: 0, destination: DEFAULTS.destination });
  assert.equal(readExplorerQuery("?prefix=32").prefix, 32);
  for (const bad of ["?ip=01.2.3.4&prefix=33&to=x", "?prefix=-1", "?prefix=24.5", "?prefix=%E0%A4%A", "?ip=", "", "?prefix=007"])
    assert.equal(readExplorerQuery(bad).prefix, DEFAULTS.prefix, bad);
  assert.deepEqual(readExplorerQuery("?ip=01.2.3.4&prefix=33&to=x"), DEFAULTS);
  assert.equal(parseAddress(readExplorerQuery("?ip=256.1.1.1").address), parseAddress(DEFAULTS.address));
});

test("the explorer route resolves, with or without a trailing slash", async () => {
  const { parseRoute } = await import("../src/app/routes.ts");
  assert.deepEqual(parseRoute("/practice/subnets"), { name: "subnet-explorer" });
  assert.deepEqual(parseRoute("/practice/subnets/"), { name: "subnet-explorer" });
});
