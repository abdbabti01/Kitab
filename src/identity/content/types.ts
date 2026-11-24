// An Identity track unit: a System Design concept unit (concepts, each with a check; optional decisions) plus what
// this track adds: a protocol walkthrough computed by the Playground's own engine, code examples in C#, Java and
// Python, Engineering Labs, guided experiments and links into the other tracks. Pure data, reviewed by hand.
import type { ConceptUnit } from "../../architecture/concepts/types.ts";

export type Link = { label: string; path: string };

export type IdentityUnit = Omit<ConceptUnit, "labs"> & {
  /** A scenario the lesson summarises step by step (from the engine) and opens in the Playground. */
  walkthrough?: { scenario: string; config?: Record<string, string>; label: string };
  /** Code example topics (src/identity/code.ts). */
  examples: string[];
  /** Engineering Lab ids (subject "identity"). */
  labs: string[];
  /** Other Kitab pages this builds on or leads to. */
  related: Link[];
  /** The standards this unit follows. */
  sources: string[];
};
