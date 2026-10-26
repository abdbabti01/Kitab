import type { TutorRequest, TutorResponse } from "../learning/tutor.ts";
import { tutorResponseSchema } from "../learning/tutor.ts";

const SESSION_KEY = "kitab.session";

/** Anonymous, random per-browser id for per-session limits. Not an identity. */
export function sessionId() {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing && /^[a-f0-9-]{16,64}$/.test(existing)) return existing;
    const created = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, created);
    return created;
  } catch {
    return "unavailable";
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), init.timeoutMs ?? 20_000);
  const outer = init.signal;
  outer?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const response = await fetch(path, {
      ...init,
      signal: controller.signal,
      headers: { "content-type": "application/json", "x-kitab-session": sessionId(), ...(init.headers ?? {}) },
    });
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON (e.g. dev server without the Worker)
    }
    if (!response.ok || data === null) {
      const body = (data ?? {}) as { error?: string; code?: string };
      throw new ApiError(body.error ?? "The Kitab service is unavailable.", response.status, body.code);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") throw new ApiError(outer?.aborted ? "Cancelled." : "The request timed out.", 0, "TIMEOUT");
    throw new ApiError("The Kitab service could not be reached.", 0, "NETWORK");
  } finally {
    window.clearTimeout(timer);
  }
}

export type TutorReply = { response: TutorResponse; source: "ai" | "fallback"; reason?: string };

export async function askTutor(request: TutorRequest, signal?: AbortSignal): Promise<TutorReply> {
  const data = await api<{ response: unknown; source: "ai" | "fallback"; reason?: string }>("/api/tutor", { method: "POST", body: JSON.stringify(request), signal, timeoutMs: 15_000 });
  // The client validates the shape too; content grounding was checked on the server.
  return { response: tutorResponseSchema.parse(data.response), source: data.source === "ai" ? "ai" : "fallback", reason: data.reason };
}

export type ComposedScenario = { id: number; params: Record<string, string | number | boolean>; scenarioKey: string };

/** AI maps a description onto the mission's own controls; the Worker validates it against the engine. */
export function composeScenario(missionId: string, missionVersion: string, description: string) {
  return api<ComposedScenario>("/api/scenario", { method: "POST", body: JSON.stringify({ missionId, missionVersion, description }), timeoutMs: 15_000 });
}

export type FeedbackTarget =
  | { kind: "mission"; missionId: string; missionVersion: string; engineVersion: string; scenarioKey: string; frameId: string }
  | { kind: "draft"; versionId: number; frameId: string };

export function sendFeedback(target: FeedbackTarget, rating: number, comment: string) {
  return api<{ ok: true; id: number }>("/api/feedback", { method: "POST", body: JSON.stringify({ target, rating, comment }) });
}

/** Meaningful learning events only (prediction, mastery), never per-frame. Best effort. */
export function sendLearningEvent(event: { type: "prediction-submitted" | "mission-mastered" | "attempt-finished"; missionId: string; missionVersion: string; engineVersion: string; scenarioKey: string; correct?: boolean }) {
  return api("/api/events", { method: "POST", body: JSON.stringify(event), timeoutMs: 8_000 }).catch(() => undefined);
}
