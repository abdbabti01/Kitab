import { useEffect, useRef } from "react";
import { incidentRun, verify, type Step, type Verification } from "../assess.ts";
import type { Run } from "../engine.ts";
import { findScenario } from "../scenarios.ts";
import type { SimRequest } from "../sim.worker.ts";

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/**
 * Runs simulations in one dedicated worker per page, terminated when the page goes. Without Worker support (old
 * browsers, some test environments) the same functions run on the main thread after a tick.
 */
export function useSim() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
  const next = useRef(0);
  useEffect(() => {
    try {
      const w = new Worker(new URL("../sim.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
        const p = pending.current.get(e.data.id);
        if (!p) return;
        pending.current.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      w.onerror = () => {
        for (const p of pending.current.values()) p.reject(new Error("The simulation stopped unexpectedly."));
        pending.current.clear();
      };
      worker.current = w;
    } catch {
      worker.current = null;
    }
    return () => {
      worker.current?.terminate();
      worker.current = null;
      pending.current.clear();
    };
  }, []);

  function call<T>(request: Omit<SimRequest, "id">): Promise<T> {
    const id = ++next.current;
    const w = worker.current;
    if (!w) {
      return new Promise((resolve, reject) => setTimeout(() => {
        try {
          const s = findScenario(request.scenario)!;
          const v = s.variants.find((x) => x.id === request.variant)!;
          resolve((request.kind === "incident" ? incidentRun(s, v) : verify(s, v, request.steps)) as T);
        } catch (error) {
          reject(error as Error);
        }
      }, 0));
    }
    return new Promise<T>((resolve, reject) => {
      pending.current.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, ...request });
    });
  }
  return {
    incident: (scenario: string, variant: string) => call<Run>({ kind: "incident", scenario, variant, steps: [] }),
    verify: (scenario: string, variant: string, steps: Step[]) => call<Verification>({ kind: "verify", scenario, variant, steps }),
  };
}
