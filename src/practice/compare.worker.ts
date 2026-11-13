// Break and compare's search, off the page's thread: it runs the engine once per candidate fault, and one run of a
// long request takes a noticeable moment on a slow phone. The page stays responsive meanwhile; a new request ends
// this worker and starts another. Experiments come back as data (a fault's apply() stays here).
import { asData, experimentsFor } from "./network/experiments.ts";
import type { Action, Network, Session } from "./network/model.ts";

self.onmessage = (e: MessageEvent<{ network: Network; action: Action; session: Session }>) => {
  const found = experimentsFor(e.data.network, e.data.action, e.data.session);
  self.postMessage({ working: found.working, experiments: found.experiments.map(asData) });
};
