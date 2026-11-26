// A dedicated worker for incident runs: a verification simulates two 80-100 s runs (target and stress), which takes
// several hundred milliseconds, so it never runs on the page's main thread. It has no network access of its own
// to use: it only imports the engine and the scenarios, and answers with plain data.
import { incidentRun, verify, type Step } from "./assess.ts";
import { findScenario } from "./scenarios.ts";

export type SimRequest = { id: number; kind: "incident" | "verify"; scenario: string; variant: string; steps: Step[] };

const scope = self as unknown as { onmessage: ((e: MessageEvent<SimRequest>) => void) | null; postMessage: (message: unknown) => void };
scope.onmessage = (event) => {
  const { id, kind, scenario, variant, steps } = event.data;
  try {
    const s = findScenario(scenario);
    const v = s?.variants.find((x) => x.id === variant);
    if (!s || !v) throw new Error("Unknown incident");
    scope.postMessage({ id, ok: true, result: kind === "incident" ? incidentRun(s, v) : verify(s, v, steps) });
  } catch (error) {
    scope.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
