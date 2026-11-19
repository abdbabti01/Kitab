// Sends a learner's request for real with fetch, to Kitab's own /api/lab/ endpoints only, and records what really
// happened: the request as sent, the response, and the timing the browser's Resource Timing API reports. No
// credentials are sent and nothing is stored.
import type { HttpMethod, Observation, ReceivedResponse, RequestDraft, SentRequest, Timing } from "./model.ts";

export const LAB_API = "/api/lab/";
const MAX_BODY_SHOWN = 64_000;
export const MAX_TIMEOUT_MS = 15_000;

/** The URL a draft may be sent to, or why not. Only same-origin paths under /api/lab/. */
export function labUrl(path: string, origin: string): { url: URL } | { error: string } {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return { error: "Start the path with /, for example /api/lab/echo. Kitab's lab only sends requests to its own server." };
  let url: URL;
  try {
    url = new URL(trimmed, origin);
  } catch {
    return { error: "That path isn't a valid URL path." };
  }
  if (url.origin !== origin) return { error: "Kitab's lab only sends requests to its own server." };
  if (!url.pathname.startsWith(LAB_API)) return { error: `Lab requests go to paths under ${LAB_API}. Other parts of Kitab's API aren't part of the lab.` };
  return { url };
}

/** A header list the browser accepts, or the first header it rejects and why. */
export function buildHeaders(list: RequestDraft["headers"]): { headers: Headers } | { error: string } {
  const headers = new Headers();
  for (const { name, value } of list) {
    if (!name.trim() && !value.trim()) continue;
    try {
      headers.append(name.trim(), value);
    } catch (error) {
      return { error: `Your browser refused the header ${JSON.stringify(name)}: ${error instanceof Error ? error.message : String(error)} Header names can't contain spaces or characters like ( ) : ; and values can't contain line breaks.` };
    }
  }
  return { headers };
}

/** This request's own Resource Timing entry: the latest for its URL that started after it was sent. */
function timingFor(url: string, since: number): Timing | null {
  if (typeof performance === "undefined" || !performance.getEntriesByName) return null;
  const entry = (performance.getEntriesByName(url, "resource") as PerformanceResourceTiming[]).filter((e) => e.startTime >= since - 1).at(-1);
  if (!entry) return null;
  const span = (a: number, b: number) => (a > 0 && b >= a ? Math.round((b - a) * 10) / 10 : 0);
  const connectMs = span(entry.connectStart, entry.connectEnd);
  return {
    protocol: entry.nextHopProtocol || "not reported",
    dnsMs: span(entry.domainLookupStart, entry.domainLookupEnd),
    connectMs,
    tlsMs: entry.secureConnectionStart > 0 ? span(entry.secureConnectionStart, entry.connectEnd) : 0,
    reused: connectMs === 0,
    waitMs: span(entry.requestStart, entry.responseStart),
    totalMs: span(entry.startTime || entry.fetchStart, entry.responseEnd),
    transferSize: entry.transferSize,
  };
}

/** Send one request for real. Resolves with an observation; never throws. */
export async function sendRequest(draft: RequestDraft, origin: string, outer?: AbortSignal): Promise<Observation> {
  const started = performance.now();
  const at = Date.now();
  const target = labUrl(draft.path, origin);
  const timeoutMs = Math.max(100, Math.min(MAX_TIMEOUT_MS, Math.round(draft.timeoutMs) || 8000));
  const sent: SentRequest = { method: draft.method, url: "", path: draft.path.trim(), headers: [], body: "", timeoutMs, cache: draft.cache };
  const refused = (error: string): Observation => ({ at, request: sent, outcome: "refused", error, elapsedMs: 0 });
  if ("error" in target) return refused(target.error);
  const built = buildHeaders(draft.headers);
  if ("error" in built) return refused(built.error);
  const hasBody = !["GET", "HEAD"].includes(draft.method) && draft.body !== "";
  if (["GET", "HEAD"].includes(draft.method) && draft.body !== "") return refused(`A ${draft.method} request can't carry a body in fetch. Clear the body, or use POST.`);
  const url = target.url;
  Object.assign(sent, { url: url.href, headers: [...built.headers], body: hasBody ? draft.body : "" });
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => ((timedOut = true), controller.abort()), timeoutMs);
  const abortOuter = () => controller.abort();
  outer?.addEventListener("abort", abortOuter);
  try {
    const response = await fetch(url, {
      method: draft.method as HttpMethod,
      headers: built.headers,
      body: hasBody ? draft.body : undefined,
      credentials: "omit",
      cache: draft.cache,
      redirect: "follow",
      signal: controller.signal,
    });
    const text = draft.method === "HEAD" ? "" : await response.text();
    const type = response.headers.get("content-type") ?? "";
    let json: unknown;
    if (type.includes("json") && text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    const received: ReceivedResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers],
      body: text.slice(0, MAX_BODY_SHOWN),
      json,
      redirected: response.redirected,
      url: response.url,
      truncated: text.length > MAX_BODY_SHOWN,
    };
    return { at, request: sent, outcome: "response", response: received, timing: timingFor(url.href, started), elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - started);
    if (timedOut) return { at, request: sent, outcome: "timeout", error: `No response within ${timeoutMs} ms, so the client gave up and aborted the request.`, elapsedMs };
    if (outer?.aborted) return { at, request: sent, outcome: "network-error", error: "Cancelled.", elapsedMs };
    return { at, request: sent, outcome: "network-error", error: `The request failed before any response arrived (${error instanceof Error ? error.message : String(error)}). Check your connection.`, elapsedMs };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abortOuter);
  }
}

/** The request written as an HTTP/1.1 message. A representation for reading, not bytes Kitab captured. */
export function requestText(draft: RequestDraft, host: string) {
  const lines = [`${draft.method} ${draft.path.trim() || "/"} HTTP/1.1`, `Host: ${host}`, ...draft.headers.filter((h) => h.name.trim()).map((h) => `${h.name.trim()}: ${h.value}`)];
  return `${lines.join("\n")}\n${draft.body && !["GET", "HEAD"].includes(draft.method) ? `\n${draft.body}` : ""}`;
}

/** The same request as a curl command, for the learner's own terminal. Single-quoted for POSIX shells. */
export function curlCommand(draft: RequestDraft, origin: string) {
  const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
  const parts = ["curl -i"];
  if (draft.method === "HEAD") parts.push("--head");
  else if (draft.method !== "GET") parts.push(`-X ${draft.method}`);
  for (const h of draft.headers) if (h.name.trim()) parts.push(`-H ${quote(`${h.name.trim()}: ${h.value}`)}`);
  if (draft.body && !["GET", "HEAD"].includes(draft.method)) parts.push(`--data ${quote(draft.body)}`);
  parts.push(quote(`${origin}${draft.path.trim()}`));
  return parts.join(" ");
}
