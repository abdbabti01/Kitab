// Starting designs: the playground's guided templates, and the base of lesson experiments and challenges.
import { configFor, newDesign, ruleFor, workloadSchema, type ComponentKind, type Design, type DesignNode, type Fault, type Workload } from "./model.ts";
import { parseDesign } from "./validate.ts";

type NodeSpec = [id: string, kind: ComponentKind, label: string, x: number, y: number, config?: Record<string, unknown>];

/** A design from compact specs; connections take their kind from the rules. Throws on a spec the rules refuse. */
export function build(name: string, nodes: NodeSpec[], edges: [string, string][], workload: Partial<Workload> = {}, faults: Fault[] = []): Design {
  const design = newDesign(name, "template", "2026-11-15T00:00:00.000Z");
  design.nodes = nodes.map(([id, kind, label, x, y, config]): DesignNode => ({ id, kind, label, x, y, config: configFor(kind, config) }));
  design.edges = edges.map(([from, to]) => {
    const a = design.nodes.find((n) => n.id === from)!;
    const b = design.nodes.find((n) => n.id === to)!;
    const rule = ruleFor(a.kind, b.kind);
    if (!rule) throw new Error(`No rule for ${from} → ${to}`);
    return { id: `${from}--${to}`, from, to, kind: rule.kind };
  });
  design.workload = workloadSchema.parse(workload);
  design.faults = faults;
  return parseDesign(design);
}

export type Template = { id: string; title: string; summary: string; design: () => Design };

export const templates: Template[] = [
  {
    id: "blank",
    title: "Blank canvas",
    summary: "Start from nothing: add a client, then the parts it needs.",
    design: () => build("Untitled design", [], []),
  },
  {
    id: "three-tier",
    title: "Client, API, database",
    summary: "The simplest web application: one API server in front of one SQL database.",
    design: () =>
      build("Client, API, database", [
        ["client-1", "client", "Users", 80, 200, { rps: 50 }],
        ["api-1", "api", "API server", 340, 200],
        ["sql-1", "sql", "SQL database", 600, 200],
      ], [["client-1", "api-1"], ["api-1", "sql-1"]]),
  },
  {
    id: "cached-api",
    title: "API with a cache",
    summary: "Cache-aside reads: the cache answers popular items and the database sees the misses.",
    design: () =>
      build("API with a cache", [
        ["client-1", "client", "Users", 80, 200, { rps: 300, writePercent: 5 }],
        ["api-1", "api", "API server", 340, 200, { concurrency: 32 }],
        ["cache-1", "cache", "Cache", 600, 80],
        ["sql-1", "sql", "SQL database", 600, 320],
      ], [["client-1", "api-1"], ["api-1", "cache-1"], ["api-1", "sql-1"]]),
  },
  {
    id: "load-balanced",
    title: "Load-balanced API",
    summary: "Three API servers behind a load balancer with health checks, sharing one database.",
    design: () =>
      build("Load-balanced API", [
        ["client-1", "client", "Users", 60, 240, { rps: 400 }],
        ["load-balancer-1", "load-balancer", "Load balancer", 280, 240],
        ["api-1", "api", "API server", 500, 100],
        ["api-2", "api", "API server 2", 500, 240],
        ["api-3", "api", "API server 3", 500, 380],
        ["sql-1", "sql", "SQL database", 740, 240, { concurrency: 40 }],
      ], [["client-1", "load-balancer-1"], ["load-balancer-1", "api-1"], ["load-balancer-1", "api-2"], ["load-balancer-1", "api-3"], ["api-1", "sql-1"], ["api-2", "sql-1"], ["api-3", "sql-1"]]),
  },
  {
    id: "async-orders",
    title: "Queue and workers",
    summary: "The API accepts each write onto a queue at once; workers store it in the background.",
    design: () =>
      build("Queue and workers", [
        ["client-1", "client", "Shoppers", 60, 200, { rps: 100, writePercent: 100 }],
        ["api-1", "api", "Orders API", 300, 200, { concurrency: 16 }],
        ["queue-1", "queue", "Order queue", 520, 200],
        ["worker-1", "worker", "Worker", 740, 120, { serviceMs: 80 }],
        ["worker-2", "worker", "Worker 2", 740, 280, { serviceMs: 80 }],
        ["sql-1", "sql", "Orders database", 960, 200],
      ], [["client-1", "api-1"], ["api-1", "queue-1"], ["queue-1", "worker-1"], ["queue-1", "worker-2"], ["worker-1", "sql-1"], ["worker-2", "sql-1"]]),
  },
  {
    id: "static-site",
    title: "CDN for static files",
    summary: "Images and scripts come from a CDN in front of object storage; data requests go to the API.",
    design: () =>
      build("CDN for static files", [
        ["client-1", "client", "Visitors", 60, 200, { rps: 200, assetPercent: 70, writePercent: 5 }],
        ["cdn-1", "cdn", "CDN", 300, 80],
        ["object-storage-1", "object-storage", "File storage", 560, 80],
        ["api-1", "api", "API server", 300, 320, { concurrency: 16 }],
        ["sql-1", "sql", "SQL database", 560, 320],
      ], [["client-1", "cdn-1"], ["client-1", "api-1"], ["cdn-1", "object-storage-1"], ["api-1", "sql-1"]]),
  },
];

export const findTemplate = (id: string) => templates.find((t) => t.id === id);

