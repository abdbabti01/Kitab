// Validation of a design: first the document (shape, bounds, references), then the graph (what the simulator
// needs to run it). Pure functions; every message is written for the learner and names the components involved.
import { components, configSchemas, designSchema, MAX_ARRIVALS, ruleFor, type Design, type DesignEdge, type DesignNode } from "./model.ts";

export type Issue = { severity: "error" | "warning"; code: string; message: string; nodes: string[]; edges: string[] };
export type Validation = { ok: boolean; errors: Issue[]; warnings: Issue[] };

export class DesignFormatError extends Error {}

/**
 * Untrusted input (storage, an imported file) → a design with every setting defaulted and bounded, or a
 * DesignFormatError saying why not. Newer formats and unknown kinds are refused, never guessed at.
 */
export function parseDesign(raw: unknown): Design {
  if (raw && typeof raw === "object" && "version" in raw && typeof raw.version === "number" && raw.version > 1) {
    throw new DesignFormatError("This design was saved by a newer version of Kitab.");
  }
  const parsed = designSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new DesignFormatError(`This isn't a valid Kitab design (${first.path.join(".") || "document"}: ${first.message}).`);
  }
  const doc = parsed.data;
  const nodes: DesignNode[] = doc.nodes.map((node) => {
    const config = configSchemas[node.kind].safeParse(node.config);
    if (!config.success) throw new DesignFormatError(`The settings of “${node.label}” are out of range (${config.error.issues[0].path.join(".")}).`);
    return { ...node, config: config.data } as DesignNode;
  });
  const ids = new Set<string>();
  for (const item of [...nodes, ...doc.edges]) {
    if (ids.has(item.id)) throw new DesignFormatError(`Two parts of the design share the id “${item.id}”.`);
    ids.add(item.id);
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of doc.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) throw new DesignFormatError(`A connection refers to a component that doesn't exist (${edge.id}).`);
  }
  for (const fault of doc.faults) {
    if (!nodeIds.has(fault.node)) throw new DesignFormatError(`A planned failure refers to a component that doesn't exist (${fault.node}).`);
  }
  return { ...doc, nodes };
}

const issue = (severity: Issue["severity"], code: string, message: string, nodes: string[] = [], edges: string[] = []): Issue => ({ severity, code, message, nodes, edges });

/** The graph facts the simulator and the rules below read: who connects to whom, by connection kind. */
export function indexDesign(design: Design) {
  const byId = new Map(design.nodes.map((node) => [node.id, node]));
  const out = (id: string, kind: DesignEdge["kind"] = "request") => design.edges.filter((e) => e.from === id && e.kind === kind).map((e) => byId.get(e.to)!);
  const into = (id: string, kind: DesignEdge["kind"] = "request") => design.edges.filter((e) => e.to === id && e.kind === kind).map((e) => byId.get(e.from)!);
  const edgeBetween = (from: string, to: string) => design.edges.find((e) => e.from === from && e.to === to);
  /** A SQL node with an incoming replication connection is a read replica; any other database is a primary. */
  const isReplica = (node: DesignNode) => node.kind === "sql" && into(node.id, "replication").length > 0;
  /** The primary database a caller writes to, and the replicas it may read from. */
  const dataStores = (caller: string) => {
    const linked = out(caller).filter((n) => n.kind === "sql" || n.kind === "nosql");
    return { primaries: linked.filter((n) => !isReplica(n)), replicas: linked.filter(isReplica) };
  };
  return { byId, out, into, edgeBetween, isReplica, dataStores };
}

export function validateDesign(design: Design): Validation {
  const issues: Issue[] = [];
  const g = indexDesign(design);
  const name = (id: string) => g.byId.get(id)?.label ?? id;

  const seen = new Set<string>();
  for (const edge of design.edges) {
    const from = g.byId.get(edge.from)!;
    const to = g.byId.get(edge.to)!;
    const rule = ruleFor(from.kind, to.kind);
    if (edge.from === edge.to) issues.push(issue("error", "self-connection", `${from.label} is connected to itself.`, [from.id], [edge.id]));
    else if (!rule || rule.kind !== edge.kind) {
      issues.push(issue("error", "connection-not-allowed", `A ${components[from.kind].name} can't send ${edge.kind === "request" ? "requests" : edge.kind === "async" ? "messages" : "replication"} to a ${components[to.kind].name}.`, [from.id, to.id], [edge.id]));
    }
    const pair = `${edge.from}>${edge.to}`;
    if (seen.has(pair)) issues.push(issue("error", "duplicate-connection", `${from.label} is connected to ${to.label} twice.`, [from.id, to.id], [edge.id]));
    seen.add(pair);
  }

  const clients = design.nodes.filter((n) => n.kind === "client");
  if (!clients.length) issues.push(issue("error", "no-client", "Add a Client: without one, no request is ever sent."));
  let arrivals = 0;
  for (const client of clients) {
    const config = client.config as { rps: number; writePercent: number; assetPercent: number };
    arrivals += config.rps * design.workload.durationS;
    if (config.writePercent + config.assetPercent > 100) issues.push(issue("error", "mix-over-100", `${client.label}: writes and static files add up to more than 100%.`, [client.id]));
    const targets = g.out(client.id);
    if (!targets.length) issues.push(issue("error", "client-unconnected", `${client.label} isn't connected to anything, so its requests have nowhere to go.`, [client.id]));
    const dynamic = targets.filter((n) => n.kind === "api" || n.kind === "load-balancer");
    const viaCdn = targets.filter((n) => n.kind === "cdn" && g.out(n.id).some((o) => o.kind === "api" || o.kind === "load-balancer"));
    if (dynamic.length > 1) issues.push(issue("error", "client-two-entries", `${client.label} connects to more than one API server or load balancer. Put a load balancer in front of the servers instead.`, [client.id, ...dynamic.map((n) => n.id)]));
    const needsDynamic = config.assetPercent < 100;
    if (targets.length && needsDynamic && !dynamic.length && !viaCdn.length) {
      issues.push(issue("error", "no-api-path", `${client.label} sends reads and writes, but no path from it reaches an API server.`, [client.id]));
    }
    const assetTargets = targets.filter((n) => n.kind === "cdn" || n.kind === "object-storage");
    if (assetTargets.length > 1) issues.push(issue("error", "client-two-file-routes", `${client.label} has two routes for static files. Connect it to either the CDN or object storage.`, [client.id]));
  }
  if (arrivals > MAX_ARRIVALS) {
    issues.push(issue("error", "too-much-traffic", `This run would send ${arrivals.toLocaleString("en")} requests. The simulator runs at most ${MAX_ARRIVALS.toLocaleString("en")}: lower the request rate or the duration.`, clients.map((c) => c.id)));
  }

  for (const node of design.nodes) {
    const outs = g.out(node.id);
    if (node.kind === "load-balancer" && !outs.length) issues.push(issue("error", "lb-no-targets", `${node.label} has no API servers to send requests to.`, [node.id]));
    if (node.kind === "load-balancer" && !g.into(node.id).length) issues.push(issue("warning", "unused", `Nothing sends requests to ${node.label}.`, [node.id]));
    if (node.kind === "cdn" && !outs.length) issues.push(issue("error", "cdn-no-origin", `${node.label} has no origin: connect it to object storage (files) or an API (reads and writes).`, [node.id]));
    if (node.kind === "cdn" && outs.filter((n) => n.kind === "api" || n.kind === "load-balancer").length > 1) issues.push(issue("error", "cdn-two-origins", `${node.label} has more than one API origin. Use a load balancer.`, [node.id]));
    if (node.kind === "api" || node.kind === "worker") {
      const { primaries, replicas } = g.dataStores(node.id);
      if (primaries.length > 1) issues.push(issue("error", "two-databases", `${node.label} connects to ${primaries.length} databases. In this simulator a server writes to one primary database.`, [node.id, ...primaries.map((p) => p.id)]));
      for (const replica of replicas) {
        const primary = g.into(replica.id, "replication")[0];
        if (!primaries.some((p) => p.id === primary.id)) issues.push(issue("error", "replica-without-primary", `${node.label} reads from ${replica.label}, a replica of ${primary.label}, but doesn't use ${primary.label} itself.`, [node.id, replica.id, primary.id]));
      }
      if (node.kind === "api" && !primaries.length && !g.out(node.id, "async").length) issues.push(issue("warning", "no-database", `${node.label} has no database, so it answers reads and writes from its own memory. Data would be lost if it restarted.`, [node.id]));
      if (node.kind === "worker" && !primaries.length) issues.push(issue("error", "worker-no-database", `${node.label} has no database to write its results to.`, [node.id]));
      if (node.kind === "worker" && !g.into(node.id, "async").length) issues.push(issue("warning", "worker-idle", `${node.label} isn't connected to a queue, so it never receives work.`, [node.id]));
      if (outs.filter((n) => n.kind === "cache").length > 1) issues.push(issue("error", "two-caches", `${node.label} connects to more than one cache.`, [node.id]));
      if (outs.filter((n) => n.kind === "object-storage").length > 1) issues.push(issue("error", "two-storages", `${node.label} connects to more than one object storage.`, [node.id]));
      if (g.out(node.id, "async").length > 1) issues.push(issue("error", "two-queues", `${node.label} publishes to more than one queue.`, [node.id]));
    }
    if (node.kind === "api" && !g.into(node.id).length) issues.push(issue("warning", "unused", `Nothing sends requests to ${node.label}.`, [node.id]));
    if (node.kind === "queue" && !g.out(node.id, "async").length) issues.push(issue("warning", "queue-no-workers", `${node.label} has no workers, so messages pile up and are never processed.`, [node.id]));
    if (node.kind === "sql") {
      const sources = g.into(node.id, "replication");
      if (sources.length > 1) issues.push(issue("error", "replica-two-primaries", `${node.label} replicates from more than one primary.`, [node.id]));
      if (sources.length && g.out(node.id, "replication").length) issues.push(issue("error", "replica-chain", `${node.label} is a replica and has replicas of its own. This simulator models one level of replicas.`, [node.id]));
      if (sources.length && g.into(node.id).some((n) => n.kind === "worker")) issues.push(issue("error", "write-to-replica", `${node.label} is a read-only replica, but a worker writes to it.`, [node.id]));
    }
  }

  for (const fault of design.faults) {
    if (fault.toS <= fault.fromS) issues.push(issue("error", "fault-window", `The failure of ${name(fault.node)} must end after it starts.`, [fault.node]));
  }

  const errors = issues.filter((i) => i.severity === "error");
  return { ok: errors.length === 0, errors, warnings: issues.filter((i) => i.severity === "warning") };
}

/** The connections a node may start, for the accessible "Connect to…" list: allowed, not yet made, not itself. */
export function connectableTargets(design: Design, from: string) {
  const source = design.nodes.find((n) => n.id === from);
  if (!source) return [];
  return design.nodes.filter((to) => to.id !== from && ruleFor(source.kind, to.kind) && !design.edges.some((e) => e.from === from && e.to === to.id));
}
