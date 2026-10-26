import type { Env, WorkerContext } from "./env.ts";
import { handleEvent, handleFeedback } from "./feedback.ts";
import { handleGenerate, handleListConcepts, handleReadLesson } from "./generation.ts";
import { failure, HttpError } from "./http.ts";
import { handleTutor } from "./tutor.ts";

export { applyEnginePolicy, lessonMatchesConcept } from "./generation.ts";

type Route = { method: string; match: (path: string) => boolean; handle: (request: Request, env: Env, ctx: WorkerContext) => Promise<Response> };

const routes: Route[] = [
  { method: "GET", match: (path) => path === "/api/concepts", handle: handleListConcepts },
  { method: "GET", match: (path) => path.startsWith("/api/lessons/"), handle: handleReadLesson },
  { method: "POST", match: (path) => path === "/api/concept", handle: handleGenerate },
  { method: "POST", match: (path) => path === "/api/tutor", handle: handleTutor },
  { method: "POST", match: (path) => path === "/api/feedback", handle: handleFeedback },
  { method: "POST", match: (path) => path === "/api/events", handle: handleEvent },
];

export async function handle(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) {
    if (!env.ASSETS) return failure(503, "ASSETS_UNAVAILABLE", "Static assets are not bound.");
    return env.ASSETS.fetch(request);
  }
  const candidates = routes.filter((route) => route.match(url.pathname));
  if (!candidates.length) return failure(404, "NOT_FOUND", "Unknown API route.");
  const route = candidates.find((item) => item.method === request.method);
  if (!route) return failure(405, "METHOD_NOT_ALLOWED", `Use ${candidates.map((item) => item.method).join(" or ")}.`);
  try {
    return await route.handle(request, env, ctx);
  } catch (error) {
    if (error instanceof HttpError) return failure(error.status, error.code, error.message);
    console.error("Unhandled API error.", error);
    return failure(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
  }
}

export default { fetch: handle };
