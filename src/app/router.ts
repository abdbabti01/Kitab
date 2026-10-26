import { useEffect, useState } from "react";

export type Route =
  | { name: "home" }
  | { name: "mission"; id: string }
  | { name: "concept"; slug: string }
  | { name: "draft"; slug: string }
  | { name: "not-found"; path: string };

/** Old addresses kept working: they redirect to their closest current page. */
const legacy: Record<string, string> = {
  "/lesson/tcp": "/missions/tcp-lab",
  "/visual-lab": "/missions/tcp-lab",
  "/lesson/data-structures": "/missions/ds-lab",
};

function segment(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return /^[\p{L}\p{N}][\p{L}\p{N} +#.\-]{0,119}$/u.test(decoded) ? decoded : null;
  } catch {
    return null; // malformed percent-encoding
  }
}

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/") return { name: "home" };
  const [, kind, value, extra] = path.split("/");
  const clean = value ? segment(value) : null;
  if (!clean || extra !== undefined) return { name: "not-found", path };
  if (kind === "missions") return { name: "mission", id: clean };
  if (kind === "concepts") return { name: "concept", slug: clean };
  if (kind === "drafts") return { name: "draft", slug: clean };
  return { name: "not-found", path };
}

export function redirectFor(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return legacy[path] ?? (path.startsWith("/lesson/tcp") ? legacy["/lesson/tcp"] : undefined);
}

export function navigate(path: string, state?: unknown) {
  if (path === window.location.pathname + window.location.search) return;
  window.history.pushState(state ?? null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate", { state: state ?? null }));
  window.scrollTo({ top: 0 });
}

export function useRoute() {
  const read = () => {
    const redirect = redirectFor(window.location.pathname);
    if (redirect) window.history.replaceState(null, "", redirect);
    return parseRoute(window.location.pathname);
  };
  const [route, setRoute] = useState<Route>(read);
  useEffect(() => {
    const update = () => setRoute(read());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  return route;
}

/** Same-origin link that uses client navigation but stays a real anchor for keyboard and new tabs. */
export function linkProps(path: string) {
  return {
    href: path,
    onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(path);
    },
  };
}
