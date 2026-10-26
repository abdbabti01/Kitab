/**
 * Local fake bindings for Worker integration tests. The D1 fake runs the real
 * migrations on SQLite (node:sqlite), executes each statement atomically on a
 * later tick (so concurrent requests interleave between awaits, like D1), and
 * runs batch() in a transaction.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AiBinding, D1Database, D1Result, D1Statement, Env, WorkerContext } from "../../worker/env.ts";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const normalizeParam = (value: unknown) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value);

export class FakeD1 implements D1Database {
  readonly sqlite = new DatabaseSync(":memory:");
  failWhen: ((sql: string) => boolean) | null = null;
  statements: string[] = [];

  constructor() {
    const dir = new URL("../../migrations/", import.meta.url);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) this.sqlite.exec(readFileSync(new URL(file, dir), "utf8"));
  }

  private execute(sql: string, params: unknown[]): D1Result<any> {
    if (this.failWhen?.(sql)) throw new Error(`D1_ERROR: injected failure for ${sql.slice(0, 40)}`);
    this.statements.push(sql);
    const statement = this.sqlite.prepare(sql);
    const values = params.map(normalizeParam) as never[];
    if (/\bRETURNING\b|^\s*SELECT/i.test(sql)) return { results: statement.all(...values) as never[], success: true };
    const info = statement.run(...values);
    return { results: [], success: true, meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) } };
  }

  prepare(sql: string): D1Statement {
    const db = this;
    let params: unknown[] = [];
    const statement: D1Statement & { sql: string; params: () => unknown[] } = {
      sql,
      params: () => params,
      bind(...values: unknown[]) { params = values; return statement; },
      async first<T>() { await tick(); return ((db.execute(sql, params).results ?? [])[0] as T) ?? null; },
      async all<T>() { await tick(); return db.execute(sql, params) as D1Result<T>; },
      async run() { await tick(); return db.execute(sql, params); },
    };
    return statement;
  }

  async batch<T>(statements: D1Statement[]): Promise<D1Result<T>[]> {
    await tick();
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((item) => {
        const { sql, params } = item as unknown as { sql: string; params: () => unknown[] };
        return this.execute(sql, params()) as D1Result<T>;
      });
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]) {
    return this.sqlite.prepare(sql).all(...(params.map(normalizeParam) as never[])).map((row) => ({ ...row })) as T[];
  }
}

export type AiScript = (input: Record<string, unknown>, call: number) => unknown | Promise<unknown>;

export class FakeAi implements AiBinding {
  calls: { model: string; input: Record<string, unknown> }[] = [];
  private script: AiScript;
  constructor(script: AiScript) {
    this.script = script;
  }
  async run(model: string, input: Record<string, unknown>) {
    this.calls.push({ model, input });
    await tick();
    return this.script(input, this.calls.length);
  }
}

export function context() {
  const pending: Promise<unknown>[] = [];
  const ctx: WorkerContext & { settle: () => Promise<unknown[]> } = { waitUntil: (promise) => void pending.push(promise), settle: () => Promise.allSettled(pending) };
  return ctx;
}

export function envWith(patch: Partial<Env>): Env {
  return { AI_TIMEOUT_MS: "200", ...patch };
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://kitab.test${path}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.5", ...headers } });
}

/** A schema-valid, on-topic generated lesson for a memory-family concept. */
export function lessonFor(concept: string) {
  return {
    schemaVersion: 2,
    title: concept,
    category: "Data structures",
    level: "Beginner",
    summary: `A ${concept} stores values in memory nodes connected by pointers.`,
    analogy: `Like a chain of labelled boxes, each pointing at the next box of the ${concept}.`,
    sections: [
      { heading: "Nodes", body: `Each ${concept} node keeps a value and a pointer.` },
      { heading: "Traversal", body: "Follow pointers from the head node to read values." },
      { heading: "Insertion", body: "Insert by rewriting one pointer in memory." },
    ],
    terms: [
      { term: "Node", definition: "A memory block holding a value and a pointer." },
      { term: "Pointer", definition: "An address of another node." },
      { term: "Head", definition: "The first node of the structure." },
    ],
    visualization: {
      engine: "memory",
      title: `${concept} in memory`,
      actors: [{ label: "Head", role: "Pointer to the first node" }, { label: "Node A", role: "Value and next pointer" }, { label: "Node B", role: "Value and null pointer" }],
      links: [{ from: 0, to: 1, label: "points to" }, { from: 1, to: 2, label: "next" }],
      events: [0, 1, 2, 3].map((index) => ({ from: Math.min(index, 1), to: Math.min(index + 1, 2), label: `Step ${index + 1}`, detail: "Follow the pointer to the next memory node.", state: "Pointer followed", payload: "ptr" })),
    },
    tryIt: ["Insert a node", "Delete a node", "Traverse the nodes"],
  };
}
