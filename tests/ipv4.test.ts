// The canonical IPv4 helper (src/net/ipv4.ts), checked against an independent BigInt reference for every prefix,
// plus known vectors, input validation, classification, properties, and agreement with the lab's existing helpers.
import test from "node:test";
import assert from "node:assert/strict";
import {
  block,
  checkPrefix,
  classify,
  formatAddress,
  isAddress,
  maskOf,
  parseAddress,
  prefixOfMask,
  sameSubnet,
  toBinary,
} from "../src/net/ipv4.ts";
import * as lab from "../src/practice/network/topology.ts";
import { isPrivate } from "../src/practice/network/engine.ts";

// Seeded generator (mulberry32), so every run checks the same addresses.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
const next = random(20261113);
const randomValue = () => Math.floor(next() * 2 ** 32);
// Edges of the address space, the sign bit, octet boundaries, then 2,000 seeded addresses.
const edges = [0, 1, 255, 256, 2 ** 24 - 1, 2 ** 24, 2 ** 31 - 1, 2 ** 31, 2 ** 31 + 1, 2 ** 32 - 2, 2 ** 32 - 1];
const values = [...edges, ...Array.from({ length: 2000 }, randomValue)];
const prefixes = Array.from({ length: 33 }, (_, p) => p);

// Independent reference: BigInt bit operations, written from the definitions rather than from the helper.
const ALL = (1n << 32n) - 1n;
const refDotted = (v: bigint) => [24n, 16n, 8n, 0n].map((s) => (v >> s) & 255n).join(".");
function reference(value: number, prefix: number) {
  const v = BigInt(value),
    hostBits = BigInt(32 - prefix),
    mask = (ALL << hostBits) & ALL,
    start = v & mask,
    end = start | (ALL >> BigInt(prefix)),
    size = end - start + 1n,
    normal = prefix <= 30;
  return {
    prefix,
    kind: prefix === 32 ? "host" : prefix === 31 ? "point-to-point" : "normal",
    mask: refDotted(mask),
    cidr: `${refDotted(start)}/${prefix}`,
    network: normal ? refDotted(start) : null,
    broadcast: normal ? refDotted(end) : null,
    firstUsable: refDotted(normal ? start + 1n : start),
    lastUsable: refDotted(normal ? end - 1n : end),
    size: Number(size),
    usable: Number(normal ? size - 2n : size),
  };
}

test("every prefix /0–/32 matches the BigInt reference on 2,011 addresses", () => {
  let checked = 0;
  for (const value of values)
    for (const prefix of prefixes) {
      assert.deepEqual(block(refDotted(BigInt(value)), prefix), reference(value, prefix), `${value}/${prefix}`);
      checked++;
    }
  assert.equal(checked, 2011 * 33);
});

test("decimal ↔ number ↔ binary round-trips, including above 128.0.0.0", () => {
  for (const value of values) {
    const text = refDotted(BigInt(value));
    assert.equal(parseAddress(text), value);
    assert.equal(formatAddress(value), text);
    assert.equal(toBinary(value), value.toString(2).padStart(32, "0").replace(/(.{8})(?!$)/g, "$1."));
  }
  assert.equal(toBinary(parseAddress("192.168.1.10")), "11000000.10101000.00000001.00001010");
  assert.equal(parseAddress("255.255.255.255"), 4294967295);
  assert.equal(parseAddress("128.0.0.0"), 2147483648);
});

test("masks and prefixes convert both ways for /0–/32", () => {
  const expected = ["0.0.0.0", "128.0.0.0", "192.0.0.0"];
  for (const prefix of prefixes) {
    const mask = maskOf(prefix);
    assert.ok(mask >= 0 && mask < 2 ** 32 && Number.isInteger(mask));
    assert.equal(prefixOfMask(mask), prefix);
    assert.equal(prefixOfMask(formatAddress(mask)), prefix);
    if (prefix < 3) assert.equal(formatAddress(mask), expected[prefix]);
  }
  assert.equal(formatAddress(maskOf(0)), "0.0.0.0");
  assert.equal(formatAddress(maskOf(28)), "255.255.255.240");
  assert.equal(formatAddress(maskOf(32)), "255.255.255.255");
  assert.equal(prefixOfMask("255.255.240.0"), 20);
});

test("non-contiguous masks are rejected, and only the 33 real masks are accepted", () => {
  for (const mask of ["255.0.255.0", "255.255.255.1", "0.255.255.255", "255.255.254.255", "128.0.0.1"])
    assert.throws(() => prefixOfMask(mask), /not a valid subnet mask: its 1 bits must be contiguous/);
  const real = new Set(prefixes.map(maskOf));
  for (const value of values)
    if (real.has(value)) assert.equal(maskOf(prefixOfMask(value)), value);
    else assert.throws(() => prefixOfMask(value), /not a valid subnet mask/);
});

test("known vectors, including /0, /31 and /32", () => {
  assert.deepEqual(block("10.20.30.77", 28), {
    prefix: 28, kind: "normal", mask: "255.255.255.240", cidr: "10.20.30.64/28",
    network: "10.20.30.64", broadcast: "10.20.30.79", firstUsable: "10.20.30.65", lastUsable: "10.20.30.78",
    size: 16, usable: 14,
  });
  const lan = block("192.168.1.10", 24);
  assert.equal(lan.network, "192.168.1.0");
  assert.equal(lan.broadcast, "192.168.1.255");
  assert.equal(lan.usable, 254);
  assert.equal(block("192.168.1.130", 25).network, "192.168.1.128");
  assert.equal(block("172.20.200.9", 20).cidr, "172.20.192.0/20");
  assert.equal(block("10.1.2.3", 8).broadcast, "10.255.255.255");
  assert.equal(block("10.0.0.5", 30).usable, 2);

  assert.deepEqual(block("203.0.113.7", 31), {
    prefix: 31, kind: "point-to-point", mask: "255.255.255.254", cidr: "203.0.113.6/31",
    network: null, broadcast: null, firstUsable: "203.0.113.6", lastUsable: "203.0.113.7", size: 2, usable: 2,
  });
  assert.deepEqual(block("198.51.100.20", 32), {
    prefix: 32, kind: "host", mask: "255.255.255.255", cidr: "198.51.100.20/32",
    network: null, broadcast: null, firstUsable: "198.51.100.20", lastUsable: "198.51.100.20", size: 1, usable: 1,
  });
  assert.deepEqual(block("8.8.8.8", 0), {
    prefix: 0, kind: "normal", mask: "0.0.0.0", cidr: "0.0.0.0/0",
    network: "0.0.0.0", broadcast: "255.255.255.255", firstUsable: "0.0.0.1", lastUsable: "255.255.255.254",
    size: 2 ** 32, usable: 2 ** 32 - 2,
  });
  assert.equal(block("255.255.255.255", 1).cidr, "128.0.0.0/1");
});

test("malformed addresses are rejected with a reason", () => {
  const cases: [string, RegExp][] = [
    ["01.2.3.4", /“01” must be a whole number from 0 to 255 with no leading zeros/],
    ["256.0.0.1", /256 is larger than 255/],
    ["1.2.3", /needs exactly four numbers/],
    ["1.2.3.4.5", /needs exactly four numbers/],
    ["", /needs exactly four numbers/],
    ["1..3.4", /one of its four numbers is missing/],
    [" 1.2.3.4", /“ 1” must be/],
    ["1.2.3.4 ", /“4 ” must be/],
    ["+1.2.3.4", /“\+1” must be/],
    ["-1.2.3.4", /“-1” must be/],
    ["1e2.0.0.1", /“1e2” must be/],
    ["0x1.2.3.4", /“0x1” must be/],
    ["1.2.3.4/24", /“4\/24” must be/],
    ["１.2.3.4", /must be a whole number/],
    ["1000.0.0.1", /must be a whole number/],
  ];
  for (const [text, reason] of cases) {
    assert.throws(() => parseAddress(text), reason, text);
    assert.equal(isAddress(text), false, text);
  }
  for (const text of ["0.0.0.0", "10.0.0.1", "255.255.255.255", "100.64.0.0"]) assert.equal(isAddress(text), true);
  for (const value of [-1, 2 ** 32, 1.5, NaN]) assert.throws(() => formatAddress(value), /not a 32-bit IPv4 address value/);
});

test("prefixes outside /0–/32 are rejected everywhere", () => {
  for (const prefix of [-1, 33, 24.5, NaN, Infinity]) {
    assert.throws(() => checkPrefix(prefix), /use a whole number from 0 to 32/);
    assert.throws(() => maskOf(prefix), /use a whole number from 0 to 32/);
    assert.throws(() => block("10.0.0.1", prefix), /use a whole number from 0 to 32/);
    assert.throws(() => sameSubnet("10.0.0.1", "10.0.0.2", prefix), /use a whole number from 0 to 32/);
  }
});

test("properties: the address is inside its block, blocks are aligned, and membership agrees with blocks", () => {
  for (const value of values.slice(0, 400))
    for (const prefix of prefixes) {
      const address = formatAddress(value),
        b = block(address, prefix),
        start = parseAddress(b.cidr.split("/")[0]),
        end = start + b.size - 1;
      assert.ok(start <= value && value <= end);
      assert.equal(start % b.size, 0);
      assert.equal(parseAddress(b.firstUsable) <= parseAddress(b.lastUsable), true);
      assert.equal(parseAddress(b.lastUsable) - parseAddress(b.firstUsable) + 1, b.usable);
      // The block start is the address AND the mask; the address OR the inverted mask is the block end.
      assert.equal(start, Number(BigInt(value) & BigInt(maskOf(prefix))));
      const other = formatAddress(randomValue());
      assert.equal(sameSubnet(address, other, prefix), block(other, prefix).cidr === b.cidr);
      assert.equal(sameSubnet(address, formatAddress(end), prefix), true);
      if (end + 1 < 2 ** 32) assert.equal(sameSubnet(address, formatAddress(end + 1), prefix), false);
    }
  assert.equal(sameSubnet("1.2.3.4", "250.0.0.1", 0), true);
  assert.equal(sameSubnet("10.0.0.1", "10.0.0.1", 32), true);
  assert.equal(sameSubnet("10.0.0.1", "10.0.0.2", 32), false);
  assert.equal(sameSubnet("10.0.0.6", "10.0.0.7", 31), true);
  assert.equal(sameSubnet("10.0.0.7", "10.0.0.8", 31), false);
});

test("classification covers the special-purpose ranges at both ends, and never calls the rest public", () => {
  const cases: [string, string, string | null][] = [
    ["0.0.0.0", "unspecified", "0.0.0.0/32"],
    ["0.0.0.1", "this-network", "0.0.0.0/8"],
    ["0.255.255.255", "this-network", "0.0.0.0/8"],
    ["1.0.0.0", "other", null],
    ["9.255.255.255", "other", null],
    ["10.0.0.0", "private", "10.0.0.0/8"],
    ["10.255.255.255", "private", "10.0.0.0/8"],
    ["11.0.0.0", "other", null],
    ["100.63.255.255", "other", null],
    ["100.64.0.0", "shared", "100.64.0.0/10"],
    ["100.127.255.255", "shared", "100.64.0.0/10"],
    ["100.128.0.0", "other", null],
    ["126.255.255.255", "other", null],
    ["127.0.0.1", "loopback", "127.0.0.0/8"],
    ["127.255.255.255", "loopback", "127.0.0.0/8"],
    ["169.253.255.255", "other", null],
    ["169.254.0.0", "link-local", "169.254.0.0/16"],
    ["169.254.255.255", "link-local", "169.254.0.0/16"],
    ["169.255.0.0", "other", null],
    ["172.15.255.255", "other", null],
    ["172.16.0.0", "private", "172.16.0.0/12"],
    ["172.31.255.255", "private", "172.16.0.0/12"],
    ["172.32.0.0", "other", null],
    ["192.0.0.8", "protocol", "192.0.0.0/24"],
    ["192.0.1.0", "other", null],
    ["192.0.2.0", "documentation", "192.0.2.0/24"],
    ["192.0.2.255", "documentation", "192.0.2.0/24"],
    ["192.167.255.255", "other", null],
    ["192.168.0.0", "private", "192.168.0.0/16"],
    ["192.168.255.255", "private", "192.168.0.0/16"],
    ["192.169.0.0", "other", null],
    ["198.17.255.255", "other", null],
    ["198.18.0.0", "benchmarking", "198.18.0.0/15"],
    ["198.19.255.255", "benchmarking", "198.18.0.0/15"],
    ["198.20.0.0", "other", null],
    ["198.51.100.20", "documentation", "198.51.100.0/24"],
    ["198.51.101.0", "other", null],
    ["203.0.112.255", "other", null],
    ["203.0.113.7", "documentation", "203.0.113.0/24"],
    ["203.0.114.0", "other", null],
    ["223.255.255.255", "other", null],
    ["224.0.0.0", "multicast", "224.0.0.0/4"],
    ["239.255.255.255", "multicast", "224.0.0.0/4"],
    ["240.0.0.0", "reserved", "240.0.0.0/4"],
    ["255.255.255.254", "reserved", "240.0.0.0/4"],
    ["255.255.255.255", "limited-broadcast", "255.255.255.255/32"],
  ];
  for (const [address, range, cidr] of cases) {
    const c = classify(address);
    assert.equal(c.range, range, address);
    assert.equal(c.cidr, cidr, address);
    assert.equal(c.source === null, range === "other", address);
  }
  const names = new Set(cases.map(([, range]) => range));
  assert.equal(names.has("public" as never), false);
});

test("determinism: the same input always gives the same output", () => {
  const run = () => values.slice(0, 200).map((v) => [block(formatAddress(v), v % 33), classify(formatAddress(v))]);
  assert.deepEqual(run(), run());
});

// Which existing consumers could move to the helper without changing behaviour. The helper is not wired in yet.
test("the lab's ipNumber, dotted, mask and sameSubnet agree with the helper for every address and /0–/32", () => {
  for (const value of values) {
    const text = formatAddress(value);
    assert.equal(lab.ipNumber(text), parseAddress(text));
    assert.equal(lab.dotted(value), text);
    for (const prefix of prefixes) {
      assert.equal(lab.mask(prefix), maskOf(prefix));
      const other = formatAddress(randomValue());
      assert.equal(lab.sameSubnet(text, other, prefix), sameSubnet(text, other, prefix));
    }
  }
  for (const text of ["01.2.3.4", "256.0.0.1", "1.2.3", " 1.2.3.4", "1..3.4"]) {
    assert.throws(() => lab.ipNumber(text));
    assert.throws(() => parseAddress(text));
  }
});

test("the lab's subnet() agrees for /0–/30 (interfaces accept /1–/30) and differs at /31 and /32", () => {
  for (const value of values.slice(0, 500)) {
    const text = formatAddress(value);
    for (const prefix of prefixes.slice(0, 31)) {
      const old = lab.subnet(text, prefix),
        b = block(text, prefix);
      assert.deepEqual(
        { network: old.network, broadcast: old.broadcast, mask: old.mask, first: old.first, last: old.last, usable: old.usable },
        { network: b.network, broadcast: b.broadcast, mask: b.mask, first: b.firstUsable, last: b.lastUsable, usable: b.usable },
        `${text}/${prefix}`,
      );
    }
  }
  // Known lab defect, unreachable today (interfaces are limited to /1–/30): /31 reports 0 usable hosts with
  // first after last, and /32 reports first two addresses after last.
  assert.deepEqual(lab.subnet("10.0.0.6", 31), {
    network: "10.0.0.6", broadcast: "10.0.0.7", mask: "255.255.255.254", first: "10.0.0.7", last: "10.0.0.6", usable: 0,
  });
  assert.equal(lab.subnet("10.0.0.6", 32).first, "10.0.0.7");
  assert.equal(lab.subnet("10.0.0.6", 32).last, "10.0.0.5");
  assert.equal(block("10.0.0.6", 31).usable, 2);
  assert.equal(block("10.0.0.6", 32).usable, 1);
});

test("the engine's isPrivate is exactly the helper's private (RFC 1918) range", () => {
  const probes = [
    ...values.map(formatAddress),
    "9.255.255.255", "10.0.0.0", "10.255.255.255", "11.0.0.0", "172.15.255.255", "172.16.0.0", "172.31.255.255",
    "172.32.0.0", "192.167.255.255", "192.168.0.0", "192.168.255.255", "192.169.0.0",
  ];
  for (const address of probes) assert.equal(isPrivate(address), classify(address).range === "private", address);
});
