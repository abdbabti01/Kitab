// Every guided experiment (predict, then test) by title and address, without loading any engine: lessons, path
// links and Playground lists read this. tests/cycles.test.ts checks it matches the cycle modules exactly.
import type { Subject } from "./cycle.ts";

export type CycleEntry = { id: string; version: number; subject: Subject; unit: string; title: string; path: string };

const sd = (id: string, unit: string, title: string): CycleEntry => ({ id, version: 1, subject: "system-design", unit, title, path: `/learn/system-design/${unit}#experiment-title` });
const ds = (id: string, unit: string, title: string): CycleEntry => ({ id, version: 1, subject: "data-structures", unit, title, path: `/practice/structures?experiment=${id}` });
const net = (id: string, unit: string, title: string): CycleEntry => ({ id, version: 1, subject: "networking", unit, title, path: `/practice/network?experiment=${id}` });
const idn = (id: string, unit: string, title: string, page = "/practice/identity"): CycleEntry => ({ id, version: 1, subject: "identity", unit, title, path: `${page}?experiment=${id}` });

export const cycleCatalog: CycleEntry[] = [
  sd("sd-capacity", "fundamentals", "Traffic grows, capacity doesn't"),
  sd("sd-cache-hit-rate", "storage-caching", "How often does the cache answer?"),
  sd("sd-bottleneck", "scalability", "Find the bottleneck, then fix the right thing"),
  sd("sd-queue", "distributed", "Slow workers behind a queue"),
  sd("sd-failover", "reliability-security", "A server fails: what do users see?"),
  ds("ds-array-insert", "arrays", "Make room in the middle of an array"),
  ds("ds-stack-queue", "choose-structure", "Stack or queue: who leaves first?"),
  ds("ds-hash-collision", "hash-tables", "Collide in a bucket"),
  ds("ds-bst-shape", "trees", "When a search tree isn't fast"),
  ds("ds-recursion-order", "recursion", "Which call returns first?"),
  net("net-arp-first", "lan", "What does your PC send first?"),
  net("net-dhcp-order", "lan", "How does a phone get an address?"),
  net("net-gateway-frame", "routing", "Where does the first frame go?"),
  idn("id-redirect", "oauth-flows", "A redirect URI with one extra slash"),
  idn("id-state", "oauth-flows", "A callback this browser never asked for"),
  idn("id-signature", "tokens", "An ID token signed with an unknown key"),
  idn("id-audience", "authorization", "A valid token at the wrong API"),
  idn("id-sso-session", "sso", "Can Application B reuse Application A's session?"),
  idn("id-key-rotation", "tokens", "The identity provider rotates its signing key"),
  idn("id-refresh-reuse", "oauth-flows", "A stolen refresh token is used after rotation"),
  idn("id-tenant", "authorization", "An admin from another tenant", "/practice/identity/authorization"),
];

export const cyclesFor = (subject: Subject, unit?: string) => cycleCatalog.filter((c) => c.subject === subject && (unit === undefined || c.unit === unit));
