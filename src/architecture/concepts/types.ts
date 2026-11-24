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

/**
 * A design decision for a given situation, judged by rules written in advance: the choice must be one of the
 * acceptable ones (there may be several) and every reason picked must actually support it, with at least
 * `minReasons` of them. No model or simulation decides; the situations are described so the rules hold.
 */
export type Decision = {
  id: string;
  title: string;
  /** The situation, in a few facts. */
  context: string[];
  question: string;
  choices: { text: string; acceptable?: true; why: string }[];
  reasons: { text: string; relevant?: true }[];
  minReasons: number;
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
  /** Where the subject is taught in depth elsewhere in Kitab. */
  see?: { label: string; path: string; detail: string }[];
  /** Decisions to practise; each counts towards completing the unit like a concept's check. */
  decisions?: Decision[];
};

/** Whether a decision was made well: an acceptable choice, supported only by relevant reasons, enough of them. */
export function judgeDecision(decision: Decision, choice: number, reasons: number[]) {
  const acceptable = decision.choices[choice]?.acceptable === true;
  const wrongReasons = reasons.filter((r) => !decision.reasons[r]?.relevant);
  const enough = reasons.length - wrongReasons.length >= decision.minReasons;
  return { correct: acceptable && wrongReasons.length === 0 && enough, acceptable, wrongReasons, enough };
}

/** Every check that completes a unit: each concept's question and each decision. */
export const unitCheckIds = (unit: ConceptUnit) => [...unit.concepts.map((c) => c.id), ...(unit.decisions ?? []).map((d) => `decision:${d.id}`)];
