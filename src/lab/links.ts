// Which Engineering Labs each track unit offers as an optional extra, without loading the labs themselves (their
// starters, solutions and tests are large). Keyed "<track>/<unit>". tests/lab-content.test.ts keeps it equal to the
// stages each lab declares in the catalog.
export type UnitLab = { title: string; path: string };

const http = { title: "Send and inspect real HTTP requests", path: "/lab/networking/http-inspector" };
const headers = { title: "Headers, status codes and caching", path: "/lab/networking/headers-status" };
const dns = { title: "Write a DNS resolver", path: "/lab/networking/dns-resolver" };
const tcp = { title: "TCP connections versus HTTP requests", path: "/lab/networking/tcp-vs-http" };
const troubleshootHttp = { title: "Troubleshoot a failing HTTP request", path: "/lab/networking/http-troubleshooting" };
const capacity = { title: "Concurrency, throughput and capacity", path: "/lab/architecture/capacity" };
const retries = { title: "Bounded retries with backoff and timeouts", path: "/lab/architecture/retries-timeouts" };

export const unitLabs: Record<string, UnitLab[]> = {
  "networking/internet": [http, headers, dns, tcp, troubleshootHttp],
  "data-structures/arrays": [{ title: "Insert, remove and search in an array", path: "/lab/structures/arrays" }],
  "data-structures/choose-structure": [{ title: "Stacks and queues", path: "/lab/structures/stacks-queues" }],
  "data-structures/recursion": [{ title: "Recursion and a real stack overflow", path: "/lab/structures/recursion" }],
  "data-structures/trees": [{ title: "Debug a binary search that never finishes", path: "/lab/structures/debugging" }],
  "system-design/fundamentals": [{ title: "Follow a request through an API", path: "/lab/architecture/api-request-flow" }],
  "system-design/scalability": [capacity],
  "system-design/performance": [capacity],
  "system-design/storage-caching": [{ title: "Build a cache with expiry and invalidation", path: "/lab/architecture/caching" }],
  "system-design/reliability": [retries],
  "system-design/resilience": [retries],
  "system-design/production": [{ title: "Troubleshoot a misbehaving API handler", path: "/lab/architecture/troubleshooting" }],
  "identity/oauth": [{ title: "Build a correct authorization request", path: "/lab/identity/auth-request" }],
  "identity/oauth-flows": [
    { title: "Build a correct authorization request", path: "/lab/identity/auth-request" },
    { title: "Generate a PKCE verifier and challenge with Web Crypto", path: "/lab/identity/pkce" },
    { title: "Validate an authorization callback", path: "/lab/identity/callback" },
    { title: "Diagnose a broken redirect URI check", path: "/lab/identity/redirect-uri" },
    { title: "Refresh tokens without a stampede", path: "/lab/identity/refresh-single-flight" },
  ],
  "identity/oidc": [
    { title: "Validate an authorization callback", path: "/lab/identity/callback" },
    { title: "Decode a JWT and validate its claims", path: "/lab/identity/jwt-claims" },
  ],
  "identity/failures": [
    { title: "Diagnose a broken redirect URI check", path: "/lab/identity/redirect-uri" },
    { title: "Debug an audience check", path: "/lab/identity/audience-bug" },
    { title: "Session cookies and safe token handling", path: "/lab/identity/cookie-vs-bearer" },
  ],
  "identity/tokens": [
    { title: "Decode a JWT and validate its claims", path: "/lab/identity/jwt-claims" },
    { title: "Select a key from a JWKS and verify a signature", path: "/lab/identity/jwks-verify" },
    { title: "Debug an audience check", path: "/lab/identity/audience-bug" },
    { title: "Call a protected API with real tokens", path: "/lab/identity/protected-api" },
  ],
  "identity/authorization": [
    { title: "Build a scope-based API authorization decision", path: "/lab/identity/scope-authz" },
    { title: "Write a role, attribute and tenant policy", path: "/lab/identity/policy" },
  ],
  "identity/passwords-sessions": [{ title: "Session cookies and safe token handling", path: "/lab/identity/cookie-vs-bearer" }],
  "identity/mfa-passkeys": [{ title: "Passkey-style challenge-response, for real", path: "/lab/identity/challenge-response" }],
};
