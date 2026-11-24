# Real Engineering Lab

`/lab` is Kitab's fourth kind of activity, beside Learn, Practice and the Playgrounds. In a Playground Kitab
*models* a system. In the Engineering Lab the learner works with real things: their JavaScript actually runs, and
their HTTP requests actually reach a server and come back. Every lab states which of those it is, and what
(if anything) is a model.

## 1. Architecture decision

**Context.** Kitab is a static React app served by one Cloudflare Worker (API + assets), with D1 and optional
Workers AI. There is no container platform, no paid service, and no budget for one. Labs must run inside that.

**Options compared**

| Option | Authentic? | Isolation | Cost | Browser support | Verdict |
|---|---|---|---|---|---|
| 1. Browser-native APIs (`fetch`, Resource Timing, `Headers`) | Real HTTP from a real browser; real timing the browser reports | The browser's own | None | Universal | **Used** for the HTTP labs |
| 2. WebAssembly runtimes (Pyodide, QuickJS-wasm, v86 Linux) | Real for their language; a Linux emulator is real but slow | Same as where they run | 5–30 MB downloads per learner | Good | Deferred: no lab here needs another language yet, and the download cost is large |
| 3. Browser-hosted JavaScript in a sandbox | Real: the learner's code runs on the browser's own JS engine (V8, SpiderMonkey, JSC) | Opaque-origin sandboxed iframe + CSP + Web Worker + hard kill (below) | None | Universal | **Used** for the code labs |
| 4. Real HTTP to controlled same-origin endpoints | Real requests, real status codes, headers, ETags, timing | Endpoints only echo or answer from fixed data; they make no outbound calls | One Worker request per send (free tier: 100,000/day, shared) | Universal | **Used**: `/api/lab/*` |
| 5. Remote isolated containers (Linux shell, Nginx, databases, Docker) | Fully real | Needs per-session VMs, quotas and abuse controls | Real money per session | — | **Rejected for now**: needs separate approval; see §6 |

**Decision.** Options 1, 3 and 4. They give genuinely executable labs with no new infrastructure, no new
dependency and no new cost. Anything that needs a real operating system, server process or raw socket is shown
as *Unavailable in the browser* with the reason, never imitated.

### Execution modes (shown on every lab)

| Mode | Meaning in Kitab |
|---|---|
| Real execution | The learner's JavaScript runs on the browser's own JS engine inside the sandbox. |
| Real protocol | A real HTTP request leaves the browser and a real response from Kitab's server is shown. |
| Real configuration | A genuine parser interprets the learner's configuration. (Not used yet.) |
| Emulated | A disclosed interpreter implements a subset of a technology. (Not used yet.) |
| Simulated | Kitab's deterministic simulators model the behaviour (the Playgrounds; linked, not embedded). |
| Unavailable | Needs a real OS, server or socket that cannot run safely here. |

A lab may combine a real mode with a stated model, for example the DNS lab: the learner's resolver really runs,
over a small zone that is data, not the Internet's DNS. The lab header says exactly that.

## 2. Threat model

**Assets.** Kitab's origin and its `localStorage` (all learner progress), the Worker's bindings (D1, AI) and any
secrets, the AI Neuron budget, other learners' data (there is none on the client), internal networks reachable
from Cloudflare, and the learner's device (responsiveness, memory).

**Attacker.** Code typed into the editor. It may be the learner's own mistake (an infinite loop) or something
pasted from elsewhere. It is treated as hostile.

| Threat | Control | Residual risk |
|---|---|---|
| Learner code reads Kitab's storage, cookies or DOM | Runs in an `<iframe sandbox="allow-scripts">` without `allow-same-origin`: an **opaque origin**. Storage, cookies, IndexedDB and `parent.document` throw `SecurityError` (tested). | Browser sandbox bugs. |
| Learner code sends data anywhere (fetch, WebSocket, `importScripts`, images) | The frame's CSP: `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:`. `connect-src` falls back to `'none'`. A blocked request is tested. The code runs in a Worker: no DOM, so no `<img>`/form exfiltration. | None known; `'unsafe-eval'` applies only inside the opaque frame. |
| Learner code navigates or pops up the Kitab page | No `allow-top-navigation`, `allow-popups`, `allow-forms`, `allow-modals` in the sandbox. | — |
| Infinite loop / CPU burn freezes Kitab | Code runs in a dedicated Worker inside the frame, never on the page's thread. A timer on the page removes the whole frame after the lab's limit (2–6 s), which terminates the Worker. Each run gets a fresh frame. | CPU is busy for at most the limit. |
| Memory exhaustion | Output is capped (200 lines, 20,000 characters); runs are short. The platform offers no memory limit for a Worker. | A deliberate allocation bomb can crash the frame's renderer, and on browsers that keep sandboxed frames in Kitab's process, the tab. **Work is saved before every run**, so nothing typed is lost. |
| Forged results from the frame | The page accepts messages only from the current frame's `contentWindow` with the current run id, and validates them with zod. Output is rendered as React text, never HTML. | A learner can fake their own *browser-local* result (see §4). |
| Lab endpoints used as an open proxy / SSRF | `/api/lab/*` never makes an outbound request. Every response is computed from the request and fixed data. | — |
| Lab requests spending the AI budget or writing D1 | The request builder only sends to paths under `/api/lab/`; the endpoints touch neither D1 nor AI. | Lab requests count towards the account's Worker request quota. |
| Reflected content as XSS | Endpoints return JSON or `text/plain` with `nosniff`. The page shows bodies as text. | — |
| Echo reflects credentials or infrastructure details | An **allowlist**: the echo returns values only for standard non-secret headers (Accept, Content-Type, Host, User-Agent, If-None-Match, Sec-Fetch-*...) and the lab's own (X-Learner, X-Api-Version), each cut to 300 characters. Every other header (Authorization, Proxy-Authorization, Cookie, API keys, tokens, any unknown custom header) is listed by name only in `withheldHeaders`; Cloudflare and proxy headers (`cf-*`, `x-forwarded-*`...) aren't named at all. Other reflected text (paths, Accept, ids, query values) is length-capped. Tested with eleven credential-style headers: no value appears anywhere in the response. | A header newly added to the allowlist must be non-secret. |
| Other sites using the endpoints (CORS, embedding, visitors' browsers as amplifiers) | No `Access-Control-*` headers on any response, so other origins can't read them; `Cross-Origin-Resource-Policy: same-origin` blocks cross-origin embedding. Browser requests whose `Sec-Fetch-Site` is `cross-site` or `same-site` get 403; Kitab's own pages (`same-origin`), direct visits (`none`) and non-browser clients such as curl (no header) are answered. | Non-browser clients can still call the endpoints directly, like any public URL. |
| Slow endpoint ties up the Worker | `/api/lab/slow` waits at most 3 s (wall time, no CPU: the lab's timeout tasks need 2.5 s and 3 s). Each Worker instance holds at most 8 slow requests at once; more get `503` with `Retry-After: 5`. Cross-site browser requests are refused (above). | The cap is per instance, not global. A Workers Rate Limiting binding would make it account-wide, but changes deployment config, so it's left as a follow-up. A waiting request isn't cancelled when its client disconnects. |
| Sensitive payloads kept on the device | Saved work is the code and the request drafts only; responses and run output are never stored. | Learners can still type secrets into a request; they stay in this browser. |
| Labs that need Web Crypto | Chromium gives the sandbox's Worker (a `blob:null` URL, not a secure context) no `crypto.subtle`; the frame itself has one. The frame runs six allowlisted operations for its own Worker (digest, generateKey, importKey, exportKey, sign, verify), at most 5,000 per run, and returns only the result; keys stay in the frame (at most 1,000) and the Worker gets handles, because `CryptoKey` exists only in secure contexts. Nothing is forwarded to Kitab's page, and the frame's CSP and sandbox flags are unchanged. Browsers whose Worker already has `crypto.subtle` (WebKit, Node in tests) use their own. | Learner code can make its own frame do bounded cryptographic work until the time limit removes it. |
| `/api/lab/identity/*` used as a token service or verifier of real tokens | It issues nothing: the fixtures were signed once and the private key discarded (only the public JWK is in the repository). A token whose header doesn't name the lab key is refused before its payload is decoded; no token or claim is ever reflected. GET only, token ≤ 4 KB, fixed synthetic data. | — |
| Real credentials kept in saved drafts | Saved request drafts drop the values of Authorization, Proxy-Authorization, Cookie and X-Api-Key, unless the value is one of the lab's synthetic tokens. | — |
| Telemetry | Lab code, requests and output are never sent anywhere. Errors log the lab id and kind only (`diagnostics.ts`). | — |

**Not claimed.** A Web Worker alone is not a security boundary; the opaque-origin frame is the boundary and the
Worker is for responsiveness. Kitab does not claim CPU or memory isolation beyond the hard time limit.

## 3. How a code run works

1. The page saves the learner's code, then creates a fresh sandboxed frame from `srcdoc` (no network fetch).
2. The frame's bootstrap creates a Worker from a `blob:` URL holding the harness, and forwards one message:
   the learner's code, and for **Check** the lab's tests.
3. The harness compiles the code with `new Function` (a syntax error is reported with its message), captures
   `console`, runs it, and for Check runs each test against the functions the lab names.
4. Every message carries the run id. The page drops anything from an old run, a removed frame, or the wrong shape.
5. On finish, error, the time limit, **Stop** or leaving the page, the frame is removed.

## 4. How labs are judged

- **Code labs.** A lab's tests are ordinary JavaScript that calls the learner's functions with real inputs,
  including edge cases (empty arrays, invalid indexes, a missing base case, a never-succeeding operation). A lab is
  completed only when every test passes in a Check run. Run alone never completes anything.
- **HTTP labs.** Each task's checks read the request that was really sent and the response that really came back
  (status, headers, body, and for the echo endpoint what the server says it received). Nothing is decided from
  text Kitab wrote itself.
- **Formative, not secure.** All checking happens in the learner's own browser, like the rest of Kitab's progress.
  A determined learner can fake their own completion. It is feedback for learning, not an exam, and nothing on a
  server trusts it.

## 5. Saved work

`kitab.engineering-labs.v1` through `src/learning/keyed-store.ts` (record-by-record, damaged records kept aside,
another tab's records never overwritten). Per lab: the code or request drafts, which tasks passed, hints shown,
whether a Check was attempted, completion time and the lab version it was saved under. A `last` record remembers
the last lab opened. Run output and HTTP responses are never stored, so an old result can never be restored as if
it were current. A lab whose version changed keeps the learner's code and says so.

## 6. The labs

| Subject | Lab | Mode | Real | Modeled or explained |
|---|---|---|---|---|
| Networking | Send and inspect real HTTP requests | Real protocol | GET/POST to the echo; what the server received; dropped forbidden headers | TCP/TLS/packets (explained) |
| Networking | Headers, status codes and caching | Real protocol | 404, 405 + Allow, Accept → text/plain, ETag → 304, the browser's own HTTP cache | — |
| Networking | Write a DNS resolver | Real execution | The learner's resolver (CNAME chains, NXDOMAIN, NODATA, loops) | The zone is data; no DNS packets. The Network Playground simulates a lookup |
| Networking | TCP connections versus HTTP requests | Real protocol | Protocol, connection setup and reuse as Resource Timing reports them; a real client timeout | Segments, handshakes and stream cancellation (explained) |
| Networking | Troubleshoot a failing HTTP request | Real protocol | Five real faults in sequence: browser refusal, 404, 415, 500 (deliberate v1 defect), 422, then 201; an invalid header name; a timeout | — |
| Data structures | Run your first program | Real execution | Output, return values, syntax and runtime errors with line numbers | — |
| Data structures | Insert, remove and search in an array | Real execution | Slot-by-slot moves on guarded arrays; RangeErrors | Fixed-size memory (the rules impose it) |
| Data structures | Stacks and queues | Real execution | LIFO, FIFO, bracket matching | — |
| Data structures | Recursion and a real stack overflow | Real execution | The engine's real RangeError and measured stack depth | Frames are explained; the Playground draws a simulated stack |
| Data structures | Debug a binary search that never finishes | Real execution | A real hang stopped at the limit; the fix verified by tests | — |
| System design | Follow a request through an API | Real protocol | Router vs handler 404, 422 validation, 201 + Location | The API stores nothing (it says so) |
| System design | Concurrency, throughput and capacity | Real execution | Measured concurrency and elapsed time of the learner's limiter | Each "request" is a timer standing in for I/O; Little's law is a model |
| System design | Build a cache with expiry and invalidation | Real execution | Hits, misses, TTL and invalidation | Clock is controlled by the tests; not Redis |
| System design | Bounded retries with backoff and timeouts | Real execution | Attempts, measured backoff delays, no retry of non-idempotent work, timeouts | The failing service is scripted |
| System design | Troubleshoot a misbehaving API handler | Real execution | The learner's handler, called with request objects | No network (the live version is the API lab) |

| Identity & security | Thirteen labs (see docs/IDENTITY.md): authorization request, PKCE with Web Crypto, callback validation, redirect URI matching, JWT claims, JWKS + ES256 signature verification, audience bug, scope decisions, RBAC/ABAC/tenant policy, single-flight refresh, session cookies and log redaction, passkey-style challenge-response; one HTTP lab | Real execution; Real protocol | The learner's code, Web Crypto signatures, a resource server that really verifies RS256 tokens | Identity providers are stand-ins; tokens are synthetic |

Every code lab's worked solution passes all its tests in the real harness, and every starter that needs work fails
(`tests/lab-content.test.ts`). Every HTTP task's solution passes against the real Worker handler.

## 7. Future real-infrastructure labs (not built)

Linux terminal, Nginx, Apache, ASP.NET Core, Node.js, SQL Server, PostgreSQL, Redis, Docker, Kafka, raw TCP
sockets, TLS certificates, firewalls, packet capture and cloud deployment need a real OS or server. The catalog
lists them as **Unavailable in the browser**. Two possible paths, both needing separate approval:

- **Local Lab Mode.** The learner runs the real tool on their machine (or in Docker). Kitab supplies the
  configuration, the commands, what to look for, and troubleshooting. Kitab cannot see the learner's terminal, so
  these are self-checked. The HTTP labs already include one: `curl -i` against `/api/lab/echo`.
- **Remote Sandbox Mode.** A per-session isolated VM or container with CPU, memory, disk and time limits,
  egress blocked by default, per-user quotas, abuse detection and a hard monthly cost ceiling. Requires its own
  architecture and security review, and a budget.

## 8. Limits

- Code labs run JavaScript only.
- Resource Timing reports what the browser chooses to expose: protocol, connection and request timing. It never
  shows TCP segments, and on a connection that is already open it reports zero connect time.
- `fetch` cannot set forbidden headers (`Host`, `Cookie`, `Connection`, `Content-Length`...); the browser drops
  them. The echo shows what really arrived.
- When the browser revalidates a cached response itself, `fetch` reports `200`, not the server's `304`. The
  headers lab sends `If-None-Match` explicitly to see the real `304`.
