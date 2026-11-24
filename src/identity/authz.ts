// The Authorization Playground's engine: an API deciding GET/refund/delete on /api/orders/{id}, one request at a
// time, in the order a real resource server checks: authenticated, credential valid, meant for this API, permitted
// (scope and role), related to the resource (tenant, ownership), and allowed by attribute conditions. Deny by
// default: if no rule grants the action, it is refused. Pure and deterministic; the same function judges the
// Practice challenges.

export type Role = "customer" | "support" | "manager" | "admin";
export type Person = { id: string; name: string; tenant: string; role: Role; department?: string };
export type Order = { id: string; tenant: string; owner: string; amount: number; status: "open" | "shipped" };
export type Action = "read" | "refund" | "delete";
export type Credential = "valid" | "missing" | "expired" | "wrong-audience" | "no-scope";
export type Rule = "audience" | "scope" | "role" | "tenant" | "ownership" | "conditions" | "admin-only";

export const people: Person[] = [
  { id: "alice", name: "Alice", tenant: "acme", role: "customer" },
  { id: "frank", name: "Frank", tenant: "acme", role: "customer" },
  { id: "bob", name: "Bob", tenant: "acme", role: "support", department: "support" },
  { id: "carol", name: "Carol", tenant: "acme", role: "manager", department: "finance" },
  { id: "erin", name: "Erin", tenant: "acme", role: "admin", department: "it" },
  { id: "dave", name: "Dave", tenant: "globex", role: "admin", department: "it" },
];
export const orders: Order[] = [
  { id: "123", tenant: "acme", owner: "alice", amount: 120, status: "open" },
  { id: "124", tenant: "acme", owner: "frank", amount: 900, status: "open" },
  { id: "125", tenant: "acme", owner: "alice", amount: 60, status: "shipped" },
  { id: "900", tenant: "globex", owner: "gina", amount: 50, status: "open" },
];

/** Role → permissions (RBAC). Scopes in the token limit what the client app may do on the user's behalf. */
export const rolePermissions: Record<Role, Action[]> = {
  customer: ["read"],
  support: ["read", "refund"],
  manager: ["read", "refund"],
  admin: ["read", "refund", "delete"],
};
export const requiredScope: Record<Action, string> = { read: "orders.read", refund: "orders.refund", delete: "orders.delete" };
/** The scopes the user's client app was granted (by role, as an identity provider's consent policy might). */
export const tokenScopes = (p: Person): string[] => rolePermissions[p.role].map((a) => requiredScope[a]);
export const REFUND_LIMIT = 500;

export const ruleInfo: Record<Rule, { label: string; help: string }> = {
  audience: { label: "Check the token's audience", help: "aud must be this API. Without it, a token issued for any other API from the same issuer works here." },
  scope: { label: "Require the matching scope", help: "orders.read / orders.refund / orders.delete must be in the token: what the client app was allowed to do." },
  role: { label: "Require a role that has the permission (RBAC)", help: "customer: read · support, manager: read, refund · admin: read, refund, delete." },
  tenant: { label: "Same organization only (tenant isolation)", help: "The order's tenant must be the caller's tenant, whatever their role." },
  ownership: { label: "Customers only see their own orders", help: "Object-level check: a customer must own the order. Staff are related to their tenant's orders instead." },
  conditions: { label: "Refund conditions (ABAC)", help: `Refunds only for open orders; support up to ${REFUND_LIMIT}; managers in finance any amount; admins any.` },
  "admin-only": { label: "Only admins may call this API", help: "A blunt rule. Safe, but it locks out everyone who legitimately needs the API." },
};
export const RULES = Object.keys(ruleInfo) as Rule[];
/** The policy a secure orders API enforces: every check except the blunt admin-only rule. */
export const securePolicy: Rule[] = ["audience", "scope", "role", "tenant", "ownership", "conditions"];

export type AccessRequest = { subject: string; action: Action; order: string; credential: Credential };
export type StepResult = { id: string; question: string; result: "pass" | "fail" | "not-checked"; detail: string; status?: number };
export type Decision = { allow: boolean; status: number; steps: StepResult[]; reason: string };

const methodOf: Record<Action, string> = { read: "GET", refund: "POST", delete: "DELETE" };
export const describe = (r: AccessRequest) => `${methodOf[r.action]} /api/orders/${r.order}${r.action === "refund" ? "/refund" : ""}`;

/** Evaluates one request under the rules the API enforces. Authentication (signature, expiry) is always enforced. */
export function evaluate(request: AccessRequest, rules: readonly Rule[]): Decision {
  const on = (rule: Rule) => rules.includes(rule);
  const person = people.find((p) => p.id === request.subject);
  const order = orders.find((o) => o.id === request.order);
  const steps: StepResult[] = [];
  const deny = (status: number, reason: string): Decision => ({ allow: false, status, steps, reason });
  const step = (id: string, question: string, ok: boolean | null, detail: string, status?: number) => {
    steps.push({ id, question, result: ok === null ? "not-checked" : ok ? "pass" : "fail", detail, status: ok === false ? status : undefined });
    return ok !== false;
  };

  if (!step("authenticated", "Is the caller authenticated?", request.credential !== "missing", request.credential === "missing" ? "No Authorization header." : "A bearer token is present.", 401)) return deny(401, "No credential: 401 with WWW-Authenticate: Bearer.");
  if (!step("valid", "Is the credential valid?", request.credential !== "expired", request.credential === "expired" ? "Signature fine, but exp has passed." : "Signature verifies; not expired; trusted issuer.", 401)) return deny(401, "Expired token: 401 invalid_token.");
  if (!person) return deny(401, "Unknown subject.");
  const wrongAud = request.credential === "wrong-audience";
  if (!step("audience", "Is it meant for this API?", on("audience") ? !wrongAud : null, on("audience") ? (wrongAud ? "aud = https://hr.example, not this API." : "aud = https://api.example.") : wrongAud ? "Not checked, and this token was issued for https://hr.example." : "Not checked.", 401)) return deny(401, "Token for another API: 401 invalid_token.");
  const scopes = request.credential === "no-scope" ? ["openid", "profile"] : tokenScopes(person);
  const hasScope = scopes.includes(requiredScope[request.action]);
  const hasRole = rolePermissions[person.role].includes(request.action);
  step("scope", `Does the token carry ${requiredScope[request.action]}?`, on("scope") ? hasScope : null, `Token scopes: ${scopes.join(" ")}.`, 403);
  if (on("scope") && !hasScope) return deny(403, `403 insufficient_scope: the token lacks ${requiredScope[request.action]}.`);
  step("role", `Does role ${person.role} have permission to ${request.action}?`, on("role") ? hasRole : null, `${person.role}: ${rolePermissions[person.role].join(", ")}.`, 403);
  if (on("role") && !hasRole) return deny(403, `403: role ${person.role} can't ${request.action}.`);
  if (on("admin-only") && !step("admin-only", "Is the caller an admin?", person.role === "admin", `${person.name} is ${person.role}.`, 403) ) return deny(403, "403: only admins may call this API.");
  if (!(on("scope") || on("role"))) {
    step("grant", "Does any rule grant this action?", false, "No permission rule is enforced, so nothing grants it. Deny by default.", 403);
    return deny(403, "Deny by default: no rule grants the action.");
  }
  if (!order) {
    step("exists", "Does the order exist?", false, `No order ${request.order}.`, 404);
    return deny(404, "404 Not Found.");
  }
  const sameTenant = order.tenant === person.tenant;
  if (!step("tenant", "Same tenant as the caller?", on("tenant") ? sameTenant : null, `Order in ${order.tenant}; ${person.name} in ${person.tenant}.`, 404)) return deny(404, "404: another tenant's order is reported as not found, so its existence doesn't leak.");
  const owns = order.owner === person.id;
  const related = person.role !== "customer" || owns;
  if (!step("ownership", person.role === "customer" ? "Does the customer own this order?" : "Is the staff member related to this order?", on("ownership") ? related : null, person.role === "customer" ? `Owner: ${order.owner}.` : `Staff of ${person.tenant}${on("tenant") ? "" : " (tenant not checked)"}.`, 403)) return deny(403, "403: not this customer's order (object-level authorization).");
  if (request.action === "refund") {
    const allowed = order.status === "open" && (person.role === "admin" || (person.role === "support" && order.amount <= REFUND_LIMIT) || (person.role === "manager" && person.department === "finance"));
    if (!step("conditions", "Do the refund conditions hold?", on("conditions") ? allowed : null, `Order ${order.status}, amount ${order.amount}; ${person.role}${person.department ? ` in ${person.department}` : ""}.`, 403)) return deny(403, "403: refund conditions not met (ABAC).");
  }
  return { allow: true, status: request.action === "delete" ? 204 : 200, steps, reason: "Allowed." };
}

/** What the API should decide: the secure policy's answer. */
export const intended = (request: AccessRequest) => evaluate(request, securePolicy);

/** Where a configured policy disagrees with the secure one: unauthorized access, or legitimate access blocked. */
export function compare(request: AccessRequest, rules: readonly Rule[]) {
  const got = evaluate(request, rules);
  const want = intended(request);
  return { got, want, verdict: got.allow === want.allow ? ("agrees" as const) : got.allow ? ("too-permissive" as const) : ("too-strict" as const) };
}

/** Requests that between them exercise every rule; used by the challenges and the "test every request" view. */
export const suite: { label: string; request: AccessRequest }[] = [
  { label: "Alice reads her order", request: { subject: "alice", action: "read", order: "123", credential: "valid" } },
  { label: "Alice reads Frank's order", request: { subject: "alice", action: "read", order: "124", credential: "valid" } },
  { label: "Alice refunds her own order", request: { subject: "alice", action: "refund", order: "123", credential: "valid" } },
  { label: "Bob (support) refunds 120", request: { subject: "bob", action: "refund", order: "123", credential: "valid" } },
  { label: "Bob (support) refunds 900", request: { subject: "bob", action: "refund", order: "124", credential: "valid" } },
  { label: "Carol (finance manager) refunds 900", request: { subject: "carol", action: "refund", order: "124", credential: "valid" } },
  { label: "Bob refunds a shipped order", request: { subject: "bob", action: "refund", order: "125", credential: "valid" } },
  { label: "Dave (Globex admin) reads an Acme order", request: { subject: "dave", action: "read", order: "123", credential: "valid" } },
  { label: "Erin (Acme admin) deletes an order", request: { subject: "erin", action: "delete", order: "124", credential: "valid" } },
  { label: "Bob deletes an order", request: { subject: "bob", action: "delete", order: "124", credential: "valid" } },
  { label: "Alice with a token for another API", request: { subject: "alice", action: "read", order: "123", credential: "wrong-audience" } },
  { label: "Alice's app without orders.read", request: { subject: "alice", action: "read", order: "123", credential: "no-scope" } },
  { label: "Alice with an expired token", request: { subject: "alice", action: "read", order: "123", credential: "expired" } },
];

/** Runs the suite: how many requests each way the configured policy gets wrong. */
export function audit(rules: readonly Rule[]) {
  const rows = suite.map((s) => ({ ...s, ...compare(s.request, rules) }));
  return { rows, tooPermissive: rows.filter((r) => r.verdict === "too-permissive").length, tooStrict: rows.filter((r) => r.verdict === "too-strict").length };
}
