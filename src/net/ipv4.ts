// Canonical IPv4 arithmetic. Pure and deterministic. Addresses are unsigned 32-bit integers held in ordinary
// numbers and computed with multiplication and division, never with 32-bit shifts, so /0 and addresses at or
// above 128.0.0.0 cannot overflow or turn negative.
//
// Everything here is arithmetic about addresses. Whether two addresses are in the same block says nothing about
// whether a packet can actually get from one to the other: cables, ports, ARP, routes and NAT decide that, and only
// the network simulator models them.

const SPACE = 2 ** 32;
const OCTET = /^(0|[1-9]\d{0,2})$/;

/** Parses dotted-decimal text such as "192.168.1.10". Throws an Error whose message says what is wrong. */
export function parseAddress(text: string): number {
  const parts = text.split(".");
  if (parts.length !== 4)
    throw new Error(`“${text}” is not an IPv4 address: it needs exactly four numbers separated by dots.`);
  return parts.reduce((value, part) => {
    if (!OCTET.test(part))
      throw new Error(
        part === ""
          ? `“${text}” is not an IPv4 address: one of its four numbers is missing.`
          : `“${text}” is not an IPv4 address: “${part}” must be a whole number from 0 to 255 with no leading zeros, signs or spaces.`,
      );
    if (Number(part) > 255) throw new Error(`“${text}” is not an IPv4 address: ${part} is larger than 255.`);
    return value * 256 + Number(part);
  }, 0);
}

export function isAddress(text: string) {
  try {
    parseAddress(text);
    return true;
  } catch {
    return false;
  }
}

function checkAddress(value: number) {
  if (!Number.isInteger(value) || value < 0 || value >= SPACE)
    throw new Error(`${value} is not a 32-bit IPv4 address value.`);
}

export function formatAddress(value: number): string {
  checkAddress(value);
  return [3, 2, 1, 0].map((octet) => Math.floor(value / 256 ** octet) % 256).join(".");
}

/** Thirty-two bits in four dot-separated octets, for example "11000000.10101000.00000001.00001010". */
export function toBinary(value: number): string {
  checkAddress(value);
  return formatAddress(value)
    .split(".")
    .map((octet) => Number(octet).toString(2).padStart(8, "0"))
    .join(".");
}

export function checkPrefix(prefix: number) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32)
    throw new Error(`/${prefix} is not an IPv4 prefix length: use a whole number from 0 to 32.`);
  return prefix;
}

/** The mask for a prefix length: /0 → 0.0.0.0, /24 → 255.255.255.0, /32 → 255.255.255.255. */
export function maskOf(prefix: number): number {
  return SPACE - 2 ** (32 - checkPrefix(prefix));
}

/** The prefix length of a mask. Throws when the one-bits are not contiguous from the left, as in 255.0.255.0. */
export function prefixOfMask(mask: string | number): number {
  const value = typeof mask === "string" ? parseAddress(mask) : mask;
  checkAddress(value);
  for (let prefix = 0; prefix <= 32; prefix++) if (maskOf(prefix) === value) return prefix;
  throw new Error(
    `${formatAddress(value)} is not a valid subnet mask: its 1 bits must be contiguous from the left, followed only by 0 bits.`,
  );
}

export type BlockKind =
  /** /0–/30: the first address names the network, the last is the broadcast, and the rest are usable hosts. */
  | "normal"
  /** /31 (RFC 3021): a point-to-point link with exactly two usable addresses, no network or broadcast address. */
  | "point-to-point"
  /** /32: one single address, as in a host route. No network or broadcast address. */
  | "host";

export interface Block {
  prefix: number;
  kind: BlockKind;
  mask: string;
  /** The first address of the block, written with the prefix: "192.168.1.0/24". */
  cidr: string;
  /** The network address. Only "normal" blocks have one. */
  network: string | null;
  /** The directed broadcast address. Only "normal" blocks have one. */
  broadcast: string | null;
  /** The first and last addresses usable by an interface. */
  firstUsable: string;
  lastUsable: string;
  /** Every address in the block, and how many of them an interface can use. */
  size: number;
  usable: number;
}

/** The block of `prefix` that contains `address`. */
export function block(address: string, prefix: number): Block {
  const size = 2 ** (32 - checkPrefix(prefix)),
    start = Math.floor(parseAddress(address) / size) * size,
    end = start + size - 1,
    kind: BlockKind = prefix === 32 ? "host" : prefix === 31 ? "point-to-point" : "normal",
    normal = kind === "normal";
  return {
    prefix,
    kind,
    mask: formatAddress(maskOf(prefix)),
    cidr: `${formatAddress(start)}/${prefix}`,
    network: normal ? formatAddress(start) : null,
    broadcast: normal ? formatAddress(end) : null,
    firstUsable: formatAddress(normal ? start + 1 : start),
    lastUsable: formatAddress(normal ? end - 1 : end),
    size,
    usable: normal ? size - 2 : size,
  };
}

/**
 * True when both addresses fall in the same block of `prefix`. This is the arithmetic test a host uses to decide
 * whether to deliver directly or through its gateway. It is not a reachability check.
 */
export function sameSubnet(a: string, b: string, prefix: number) {
  const size = 2 ** (32 - checkPrefix(prefix));
  return Math.floor(parseAddress(a) / size) === Math.floor(parseAddress(b) / size);
}

export type AddressRange =
  | "unspecified"
  | "this-network"
  | "private"
  | "shared"
  | "loopback"
  | "link-local"
  | "protocol"
  | "documentation"
  | "benchmarking"
  | "multicast"
  | "reserved"
  | "limited-broadcast"
  /** In none of the ranges below. That alone does not make an address publicly routable or assigned. */
  | "other";

export interface Classification {
  range: AddressRange;
  /** The special-purpose block that contains the address, such as "10.0.0.0/8". Null for "other". */
  cidr: string | null;
  source: string | null;
}

// IANA IPv4 Special-Purpose Address Registry (RFC 6890) plus multicast and limited broadcast. Most specific first.
const ranges: [AddressRange, string, number, string][] = [
  ["unspecified", "0.0.0.0", 32, "RFC 1122 §3.2.1.3"],
  ["this-network", "0.0.0.0", 8, "RFC 791 §3.2"],
  ["private", "10.0.0.0", 8, "RFC 1918"],
  ["shared", "100.64.0.0", 10, "RFC 6598"],
  ["loopback", "127.0.0.0", 8, "RFC 1122 §3.2.1.3"],
  ["link-local", "169.254.0.0", 16, "RFC 3927"],
  ["private", "172.16.0.0", 12, "RFC 1918"],
  ["documentation", "192.0.2.0", 24, "RFC 5737"],
  ["protocol", "192.0.0.0", 24, "RFC 6890"],
  ["private", "192.168.0.0", 16, "RFC 1918"],
  ["benchmarking", "198.18.0.0", 15, "RFC 2544"],
  ["documentation", "198.51.100.0", 24, "RFC 5737"],
  ["documentation", "203.0.113.0", 24, "RFC 5737"],
  ["multicast", "224.0.0.0", 4, "RFC 5771"],
  ["limited-broadcast", "255.255.255.255", 32, "RFC 919, RFC 8190"],
  ["reserved", "240.0.0.0", 4, "RFC 1112 §4"],
];

export function classify(address: string): Classification {
  const match = ranges.find(([, start, prefix]) => sameSubnet(address, start, prefix));
  return match
    ? { range: match[0], cidr: `${match[1]}/${match[2]}`, source: match[3] }
    : { range: "other", cidr: null, source: null };
}
