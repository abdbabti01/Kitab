// Reproducible timings for the incident simulator: `npm run incident-perf`. For each scenario and version it times
// the incident run and a verification (two continued runs: today's workload and stress), and reports the size of
// what was recorded. Numbers depend on the machine; the event and span counts don't.
import { incidentRun, verify } from "../src/incidents/assess.ts";
import { SCENARIOS } from "../src/incidents/scenarios.ts";

const rows: string[][] = [["scenario/version", "incident ms", "verify ms", "events", "spans", "heap MB"]];
for (const s of SCENARIOS) for (const v of s.variants) {
  globalThis.gc?.();
  const before = process.memoryUsage().heapUsed;
  let t = performance.now();
  const run = incidentRun(s, v);
  const incidentMs = performance.now() - t;
  t = performance.now();
  const result = verify(s, v, [], run);
  const verifyMs = performance.now() - t;
  const heap = (process.memoryUsage().heapUsed - before) / 1e6;
  rows.push([`${s.id}/${v.id}`, incidentMs.toFixed(0), verifyMs.toFixed(0), String(run.events.length + result.target.events.length + result.stress.events.length), String(run.spans.length + result.target.spans.length + result.stress.spans.length), heap.toFixed(0)]);
}
const width = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
for (const r of rows) console.log(r.map((c, i) => (i ? c.padStart(width[i]) : c.padEnd(width[i]))).join("  "));
