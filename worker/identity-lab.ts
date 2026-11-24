// The Identity Engineering Lab's endpoints, under /api/lab/identity/. A teaching resource server: it publishes a
// synthetic discovery document and JWKS, and protects fixed synthetic orders with real RS256 verification (Web
// Crypto) of the pre-signed lab tokens in src/identity/lab-fixtures.ts. Threat model:
// - Nothing is stored, logged or sent anywhere; no D1, no AI, no outbound request.
// - It is not a token service: it issues nothing, and the private key that signed the fixtures no longer exists.
// - It is not a verification oracle for real tokens: a token whose header doesn't name the lab key is refused
//   without decoding its payload or saying anything about it, and no token value is ever reflected.
// - Inputs are bounded (token ≤ 4 KB, numeric ids only); responses are JSON with nosniff (set by handleLab).
import { LAB_AUDIENCE, LAB_ISSUER, LAB_JWK } from "../src/identity/lab-fixtures.ts";

export const IDENTITY_PREFIX = "/api/lab/identity/";
const MAX_TOKEN = 4096;
const ORDERS: Record<string, { owner: string; tenant: string; total: number }> = {
  "123": { owner: "alice", tenant: "acme", total: 120 },
  "124": { owner: "frank", tenant: "acme", total: 900 },
  "900": { owner: "gina", tenant: "globex", total: 50 },
};

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

const b64urlBytes = (s: string) => {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  try {
    return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
};
const json = (s: string): Record<string, unknown> | null => {
  const bytes = b64urlBytes(s);
  if (!bytes) return null;
  try {
    const v = JSON.parse(new TextDecoder().decode(bytes));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
};

const invalid = (description: string, check: string): Answer => ({
  status: 401,
  headers: { "www-authenticate": `Bearer realm="kitab-lab", error="invalid_token", error_description="${description}"`, "x-lab-check": check },
  body: { error: "invalid_token", error_description: description },
});

let keyPromise: Promise<CryptoKey> | null = null;
const labKey = () => (keyPromise ??= crypto.subtle.importKey("jwk", LAB_JWK as JsonWebKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]));

/** Authenticates the bearer token: lab key only, real signature check, then iss, aud and exp. */
async function authenticate(request: Request): Promise<{ claims: Record<string, unknown> } | Answer> {
  const header = request.headers.get("authorization");
  if (!header) return { status: 401, headers: { "www-authenticate": 'Bearer realm="kitab-lab"', "x-lab-check": "missing" }, body: { error: "A bearer token is required." } };
  const match = /^Bearer ([A-Za-z0-9_.-]{1,4096})$/.exec(header);
  if (!match || match[1].length > MAX_TOKEN) return invalid("The Authorization header must be: Bearer <token>", "format");
  const parts = match[1].split(".");
  if (parts.length !== 3) return invalid("Not a signed JWT", "format");
  const head = json(parts[0]);
  // Anything not naming the lab key is refused here, before its payload is read.
  if (!head || head.alg !== "RS256" || head.kid !== LAB_JWK.kid) return invalid("Not signed by the lab's synthetic key", "key");
  const signature = b64urlBytes(parts[2]);
  const ok = signature && (await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, await labKey(), signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`)));
  if (!ok) return invalid("The signature does not verify", "signature");
  const claims = json(parts[1]);
  if (!claims) return invalid("Unreadable payload", "format");
  if (claims.iss !== LAB_ISSUER) return invalid("Unexpected issuer", "issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(LAB_AUDIENCE)) return invalid("The token is not for this API", "audience");
  if (typeof claims.exp !== "number" || Date.now() / 1000 >= claims.exp + 30) return invalid("The access token expired", "expiry");
  return { claims };
}

async function order(request: Request, id: string): Promise<Answer> {
  const auth = await authenticate(request);
  if (!("claims" in auth)) return auth;
  const { claims } = auth;
  if (!String(claims.scope ?? "").split(" ").includes("orders.read")) {
    return { status: 403, headers: { "www-authenticate": 'Bearer realm="kitab-lab", error="insufficient_scope", scope="orders.read"', "x-lab-check": "scope" }, body: { error: "insufficient_scope", scope: "orders.read" } };
  }
  const found = ORDERS[id];
  // Another tenant's order is reported exactly like a missing one.
  if (!found || found.tenant !== claims.tenant) return { status: 404, headers: { "x-lab-check": "tenant" }, body: { error: "No such order." } };
  if (found.owner !== claims.sub) return { status: 403, headers: { "x-lab-check": "owner" }, body: { error: "This order belongs to someone else." } };
  return { status: 200, headers: { "x-lab-check": "allowed" }, body: { id: Number(id), total: found.total, owner: found.owner, synthetic: true } };
}

export async function identityAnswer(request: Request, url: URL, path: string): Promise<Answer | null> {
  if (!path.startsWith("/api/lab/identity")) return null;
  const get = request.method === "GET" || request.method === "HEAD";
  const notAllowed: Answer = { status: 405, headers: { allow: "GET" }, body: { error: "Only GET is supported here." } };
  if (path === "/api/lab/identity/.well-known/openid-configuration") {
    return get ? { status: 200, body: {
      issuer: LAB_ISSUER,
      jwks_uri: `${url.origin}/api/lab/identity/jwks`,
      id_token_signing_alg_values_supported: ["RS256"],
      note: "A synthetic, read-only teaching issuer: it has no authorization or token endpoint. Its tokens were signed once, ahead of time, and the signing key was then destroyed.",
    } } : notAllowed;
  }
  if (path === "/api/lab/identity/jwks") return get ? { status: 200, headers: { "cache-control": "public, max-age=300" }, body: { keys: [LAB_JWK] } } : notAllowed;
  const m = /^\/api\/lab\/identity\/orders\/(\d{1,6})$/.exec(path);
  if (m) return get ? order(request, m[1]) : notAllowed;
  return { status: 404, body: { error: "No such identity lab route.", routes: ["/api/lab/identity/.well-known/openid-configuration", "/api/lab/identity/jwks", "/api/lab/identity/orders/:id"] } };
}
