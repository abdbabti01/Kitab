// A System Design concept unit: concepts taught from intuition to mechanism, each with its failure, fix,
// trade-offs, when not to use it, and one check question. Pure data, reviewed by hand; nothing here is generated.

export type CheckQuestion = {
  prompt: string;
  /** Exactly one is correct (a test enforces it); every option says why once chosen. */
  options: { text: string; correct?: true; why: string }[];
};

export type Concept = {
  id: string;
  title: string;
  /** The idea in plain words, for someone meeting it for the first time. */
  plain: string;
  /** Why the problem exists at all. */
  why: string;
  /** Where it shows up in a real application. */
  example: string;
  /** How it actually works, in technical terms. */
  mechanism: string[];
  /** What goes wrong without it, or when it's done badly. */
  failure: string;
  /** What to do. */
  solution: string;
  tradeoffs: string[];
  /** When not to reach for it. */
  avoid: string[];
  /** Distinctions people commonly get wrong. */
  pitfalls?: string[];
  check: CheckQuestion;
  /** A lab that practises it. */
  lab?: string;
};

export type ConceptUnit = {
  id: string;
  title: string;
  summary: string;
  objectives: string[];
  intro: string[];
  concepts: Concept[];
  /** Labs that practise the unit, in order. */
  labs: string[];
  takeaways: string[];
};
