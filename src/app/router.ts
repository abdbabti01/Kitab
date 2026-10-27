import { useEffect, useState, type MouseEvent } from "react";

export type { Route } from "./routes.ts";
import { parseRoute, redirectFor, type Route } from "./routes.ts";

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
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      navigate(path);
    },
  };
}
