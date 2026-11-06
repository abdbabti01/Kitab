export interface D1Result<T> {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number; last_row_id?: number };
}

export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}

export interface D1Database {
  prepare(sql: string): D1Statement;
  /** Executes statements in one transaction; any failure rolls back all of them. */
  batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1Result<T>[]>;
}

export interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  AI?: AiBinding;
  DB?: D1Database;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  /** Workers AI model id. Default: see DEFAULT_MODEL. */
  AI_MODEL?: string;
  DAILY_GENERATIONS_PER_IP?: string;
  DAILY_GENERATIONS_PER_SESSION?: string;
  DAILY_GENERATIONS_GLOBAL?: string;
  DAILY_TUTOR_PER_IP?: string;
  DAILY_TUTOR_PER_SESSION?: string;
  DAILY_TUTOR_GLOBAL?: string;
  /** Daily Workers AI Neurons Kitab may reserve across every AI path; "0" turns real AI off. */
  DAILY_NEURON_BUDGET?: string;
  /** Overrides inference timeouts (ms); defaults are 45 s per draft attempt and 12 s for the tutor. */
  AI_TIMEOUT_MS?: string;
}

export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * In the model catalog and on the Workers AI JSON mode list of models that accept `response_format:
 * json_schema` (checked 2026-10-27). llama-3.1-8b-instruct-fp8 is not on that list and fails with 5025.
 */
export const DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Half of Cloudflare's 10,000 free daily Neurons: margin for estimation error and other account usage. */
export const DEFAULT_NEURON_BUDGET = 5_000;

export function modelFor(env: Env) {
  return env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

export function limit(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function neuronBudget(env: Env) {
  return limit(env.DAILY_NEURON_BUDGET, DEFAULT_NEURON_BUDGET);
}
