// Pure route parsing (no DOM), shared by the router and tests.
export const HTTP_WALKTHROUGH_PATH = "/learn/hello-tcp";

/** The Learn destination's views: a track's roadmap, or the library of readings. Never used as lesson ids. */
export const LEARN_SECTIONS = ["data-structures", "system-design", "identity", "library"] as const;
/** The Real Engineering Lab's subjects, as they appear in /lab/:subject/:id. */
export const LAB_SUBJECTS = ["networking", "structures", "architecture", "identity"] as const;
export type LabSubject = (typeof LAB_SUBJECTS)[number];
export type LearnSection = "networking" | (typeof LEARN_SECTIONS)[number];

export type Route =
  | { name: "home" }
  | { name: "learn"; section: LearnSection }
  | { name: "practice" }
  | { name: "network-practice" }
  | { name: "playgrounds" }
  | { name: "structures-playground" }
  | { name: "network-missions" }
  | { name: "network-mission"; id: string }
  | { name: "access-explorer" }
  | { name: "subnet-explorer" }
  | { name: "architecture-playground" }
  | { name: "architecture-challenge"; id: string }
  | { name: "architecture-lesson"; id: string }
  | { name: "architecture-labs" }
  | { name: "architecture-lab"; id: string }
  | { name: "identity-unit"; id: string }
  | { name: "identity-playground" }
  | { name: "identity-tokens" }
  | { name: "identity-authorization" }
  | { name: "identity-challenge"; id: string }
  | { name: "incidents" }
  | { name: "incident"; id: string }
  | { name: "engineering-labs" }
  | { name: "engineering-lab"; subject: LabSubject; id: string }
  | { name: "mission"; id: string }
  | { name: "lesson"; id: string }
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
  if (path === "/learn") return { name: "learn", section: "networking" };
  if (path === "/practice") return { name: "practice" };
  const learnSection = /^\/learn\/([^/]+)$/.exec(path)?.[1];
  if (learnSection && (LEARN_SECTIONS as readonly string[]).includes(learnSection)) return { name: "learn", section: learnSection as LearnSection };
  if (path === "/practice/connections") return { name: "access-explorer" };
  if (path === "/practice/subnets") return { name: "subnet-explorer" };
  if (path === "/practice/network") return { name: "network-practice" };
  if (path === "/playground") return { name: "playgrounds" };
  if (path === "/practice/structures") return { name: "structures-playground" };
  if (path === "/practice/missions") return { name: "network-missions" };
  if (path === "/lab") return { name: "engineering-labs" };
  if (path === "/practice/incidents") return { name: "incidents" };
  const incident = /^\/practice\/incidents\/([^/]+)$/.exec(path);
  if (incident) {
    const id = segment(incident[1]);
    return id ? { name: "incident", id } : { name: "not-found", path };
  }
  const engineering = /^\/lab\/([^/]+)\/([^/]+)$/.exec(path);
  if (engineering) {
    const id = segment(engineering[2]);
    const subject = engineering[1] as LabSubject;
    return id && (LAB_SUBJECTS as readonly string[]).includes(subject) ? { name: "engineering-lab", subject, id } : { name: "not-found", path };
  }
  if (path === "/practice/identity") return { name: "identity-playground" };
  if (path === "/practice/identity/tokens") return { name: "identity-tokens" };
  if (path === "/practice/identity/authorization") return { name: "identity-authorization" };
  const identity = /^\/practice\/identity\/challenges\/([^/]+)$/.exec(path) ?? /^\/learn\/identity\/([^/]+)$/.exec(path);
  if (identity) {
    const id = segment(identity[1]);
    if (!id) return { name: "not-found", path };
    return path.startsWith("/learn/") ? { name: "identity-unit", id } : { name: "identity-challenge", id };
  }
  if (path === "/practice/architecture") return { name: "architecture-playground" };
  if (path === "/practice/architecture/labs") return { name: "architecture-labs" };
  const lab = /^\/practice\/architecture\/labs\/([^/]+)$/.exec(path);
  if (lab) {
    const id = segment(lab[1]);
    return id ? { name: "architecture-lab", id } : { name: "not-found", path };
  }
  const architecture = /^\/practice\/architecture\/challenges\/([^/]+)$/.exec(path) ?? /^\/learn\/system-design\/([^/]+)$/.exec(path);
  if (architecture) {
    const id = segment(architecture[1]);
    if (!id) return { name: "not-found", path };
    return path.startsWith("/learn/") ? { name: "architecture-lesson", id } : { name: "architecture-challenge", id };
  }
  const practice = /^\/practice\/missions\/([^/]+)$/.exec(path);
  if (practice) {
    const id = segment(practice[1]);
    return id ? { name: "network-mission", id } : { name: "not-found", path };
  }
  const [, kind, value, extra] = path.split("/");
  const clean = value ? segment(value) : null;
  if (!clean || extra !== undefined) return { name: "not-found", path };
  if (kind === "missions") return { name: "mission", id: clean };
  if (kind === "learn") return { name: "lesson", id: clean };
  if (kind === "concepts") return { name: "concept", slug: clean };
  if (kind === "drafts") return { name: "draft", slug: clean };
  return { name: "not-found", path };
}

/** Home's old section anchors, kept working: each now has its own page. */
const anchors: Record<string, string> = { "#path": "/learn", "#journeys": "/learn", "#missions": "/practice", "#concepts": "/learn/library" };

export function redirectFor(pathname: string, hash = "") {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/" && anchors[hash]) return anchors[hash];
  return legacy[path] ?? (path.startsWith("/lesson/tcp") ? legacy["/lesson/tcp"] : undefined);
}
