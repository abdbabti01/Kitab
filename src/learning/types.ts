import type { z } from "zod";

export type FactValue = string | number | boolean;

/** One authoritative, inspectable value. The scene, inspector, guide and tutor all read these. */
export type Fact = {
  id: string;
  label: string;
  value: FactValue;
  /** The selectable object this fact describes, when there is one. */
  entityId?: string;
};

/** A selectable or pointable object present in a frame, identified stably across frames. */
export type Entity = { id: string; label: string; kind: string };

export type LearningFrame<TData = unknown> = {
  id: string;
  index: number;
  title: string;
  narration: string;
  technical?: string;
  chapter?: string;
  facts: Fact[];
  /** Human-readable fact changes from the previous frame. Computed, never authored. */
  delta: string[];
  invariant?: string;
  focus: string[];
  entities: Entity[];
  durationMs: number;
  data: TData;
};

export type Trace<TData = unknown> = {
  engine: { id: string; version: string };
  /** Canonical identity of engine version + normalized parameters. */
  scenarioKey: string;
  params: Record<string, FactValue>;
  frames: LearningFrame<TData>[];
  outcome: Record<string, FactValue>;
  outcomeLabels: Record<string, string>;
  diagnostics: string[];
};

export type FrameDraft<TData> = Omit<LearningFrame<TData>, "index" | "delta">;

export type EngineAdapter<TParams extends Record<string, FactValue> = Record<string, FactValue>, TData = unknown> = {
  id: string;
  version: string;
  title: string;
  /** Parses untrusted input into normalized parameters (clamped, defaulted). */
  params: z.ZodType<TParams>;
  build(params: TParams): {
    frames: FrameDraft<TData>[];
    outcome: Record<string, FactValue>;
    outcomeLabels: Record<string, string>;
    diagnostics?: string[];
  };
  /** Domain terms; the tutor must stay within this vocabulary. */
  vocabulary: string[];
  /**
   * Returns contradictions between free text and the engine's trace for the claim shapes this adapter
   * supports. A clean result means "no supported claim is contradicted", not "the text is true".
   */
  checkClaims?(text: string, facts: Fact[], trace: Trace): string[];
};
