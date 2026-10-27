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
  DAILY_TOKEN_BUDGET?: string;
  /** Overrides inference timeouts (ms); defaults are 25 s for drafts and 8 s for the tutor. */
  AI_TIMEOUT_MS?: string;
}

export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

/** Documented in the Cloudflare model catalog and pricing page (checked 2026-10-25). */
export const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";

export function modelFor(env: Env) {
  return env.AI_MODEL?.trim() || DEFAULT_MODEL;
}

export function limit(value: string | undefined, fallback: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}
