// The browser's loading boundary: eager engines at once, the rest only when a page needs them.
// The Worker and tests register the same on-demand engines synchronously in index.ts (a test keeps the two lists equal).
import { getEngine, registerEngine } from "../registry.ts";
import type { EngineAdapter } from "../types.ts";
import "./eager.ts";

export const onDemandEngines: Record<string, () => Promise<EngineAdapter<any, any>>> = {
  "local-delivery": () => import("./local-delivery.ts").then((m) => m.localDeliveryAdapter),
};

/** Resolves once the engine is registered. Rejects if its code fails to load; calling again retries. */
export async function loadEngine(id: string) {
  if (getEngine(id) || !onDemandEngines[id]) return;
  registerEngine(await onDemandEngines[id]());
}
