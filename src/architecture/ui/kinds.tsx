import { Archive, Boxes, Cog, Database, Globe, Inbox, Server, Split, Users, Zap, type LucideIcon } from "lucide-react";
import type { ComponentKind, ConnectionKind } from "../model.ts";

export const kindIcon: Record<ComponentKind, LucideIcon> = {
  client: Users,
  cdn: Globe,
  "load-balancer": Split,
  api: Server,
  cache: Zap,
  sql: Database,
  nosql: Boxes,
  queue: Inbox,
  worker: Cog,
  "object-storage": Archive,
};

export const connectionNames: Record<ConnectionKind, string> = {
  request: "Request (waits for an answer)",
  async: "Message (doesn't wait)",
  replication: "Replication (copies writes)",
};
