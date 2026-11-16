// Kitab's learning tracks: the networking path and a data-structures path, each a list of units (stages) of
// existing lessons, readings, explorations and missions. Data and pure functions only; nothing is locked.
import { activityState, concept, isRequired, lastActive, lesson, mission, networkingPath, recommend, type Activity, type Evidence, type Recommendation, type Stage } from "./networking-path.ts";
import { challengeCatalog, challengePath, lessonCatalog, lessonPath } from "../architecture/catalog.ts";

const sdLesson = (id: (typeof lessonCatalog)[number]["id"], detail: string): Activity => ({ id: `sd:${id}`, title: lessonCatalog.find((l) => l.id === id)!.title, detail, path: lessonPath(id), track: "architecture-lesson" });
const sdChallenge = (id: (typeof challengeCatalog)[number]["id"], detail: string, needs: string[]): Activity => {
  const found = challengeCatalog.find((c) => c.id === id)!;
  return { id: `challenge:${id}`, title: found.title, version: found.version, detail, path: challengePath(id), track: "architecture-challenge", needs };
};

export const systemDesignPath: Stage[] = [
  {
    id: "fundamentals",
    title: "Architecture fundamentals",
    objective: "What clients, API servers and databases do, where a request's time goes, and what limits how many requests a server can serve.",
    learn: [sdLesson("fundamentals", "Follow one request's hops, then raise the traffic until the server's queue fills.")],
    practise: [sdChallenge("simple-web-app", "Make a notes app work: fast, reliable, and nothing lost on restart.", ["sd:fundamentals"])],
  },
  {
    id: "storage-caching",
    title: "Data storage and caching",
    objective: "SQL and NoSQL databases, cache-aside reads and writes, and why a cache's hit rate depends on what users ask for.",
    learn: [sdLesson("storage-caching", "Compare no cache, small and large caches, and popular versus uniform items.")],
    practise: [sdChallenge("cache-read-heavy", "Take load off a database that can't be made bigger.", ["sd:storage-caching"])],
  },
  {
    id: "scalability",
    title: "Scalability and performance",
    objective: "Scale out behind a load balancer, measure utilisation and queueing, and follow the bottleneck as it moves.",
    learn: [sdLesson("scalability", "One, two or three servers: find where the bottleneck goes next.")],
    practise: [sdChallenge("scale-behind-lb", "Serve 600 requests per second and survive losing any one server.", ["sd:scalability"])],
  },
  {
    id: "distributed",
    title: "Distributed systems",
    objective: "Queues and workers, backpressure, redelivery and dead letters, read replicas and partitions.",
    learn: [sdLesson("distributed", "Accept orders instantly, then watch workers keep up, or not.")],
    practise: [sdChallenge("async-orders", "Process every order in the background and lose none during a database outage.", ["sd:distributed"])],
  },
  {
    id: "reliability",
    title: "Security and reliability",
    objective: "Redundancy, health checks, timeouts, retries and backoff, retry storms, and keeping the inside of a design private.",
    learn: [sdLesson("reliability-security", "Fail a server with and without health checks and spare capacity.")],
    practise: [sdChallenge("resilient-api", "Stay up through a server failure without a retry storm.", ["sd:reliability-security"])],
  },
  {
    id: "projects",
    title: "Real-world design projects",
    objective: "Work from requirements and estimates to a design, then compare valid designs by their trade-offs.",
    learn: [sdLesson("design-projects", "Estimate a URL shortener's load and test three designs against it.")],
    practise: [sdChallenge("url-shortener", "Redirect 1,000 visitors a second, even when the cache fails.", ["sd:design-projects"])],
  },
];

export const dataStructuresPath: Stage[] = [
  {
    id: "arrays",
    title: "Arrays and memory",
    objective: "How an array keeps values side by side in memory, why any index is one calculation away, and why inserting means moving values.",
    learn: [
      lesson("array-insert", "Values, indexes and memory slots, then every value moving to make room for a new one."),
      concept("arrays", "Why access is fast, why insertion can be expensive, and how addresses are calculated."),
    ],
    practise: [mission("array-insert-shift", "Predict how many values shift when you insert into the middle.", ["array-insert"])],
  },
  {
    id: "linked-lists",
    title: "Linked lists",
    objective: "How separately stored nodes point to each other, and why deleting is one pointer write after a walk to the right node.",
    learn: [concept("linked-lists", "Follow pointers between nodes and compare walking the list with changing it.")],
    practise: [mission("ds-linked-list-delete", "Delete a value and compare the walk with the single pointer write.", ["concept:linked-lists"])],
  },
  {
    id: "hash-tables",
    title: "Hash tables",
    objective: "How a key's hash picks a bucket, what happens when two keys collide, and why capacity matters.",
    learn: [concept("hash-tables", "Turn keys into bucket indexes and watch collisions build a chain.")],
    practise: [mission("ds-hash-insert", "Count the equality checks a collision chain requires.", ["concept:hash-tables"])],
  },
  {
    id: "trees",
    title: "Trees and graphs",
    objective: "How a binary search tree discards part of the search at every comparison, and how breadth-first search explores a graph in rings.",
    learn: [concept("trees", "Use the ordering rule to choose a direction at each node.")],
    practise: [
      mission("ds-bst-search", "Count each comparison on the way down the tree.", ["concept:trees"]),
      mission("graph-bfs-reach", "Tell 'far away' apart from 'unreachable' in a graph with a cycle.", ["concept:trees"]),
    ],
  },
  {
    id: "recursion",
    title: "Recursion and the call stack",
    objective: "How every call pushes a frame, how a base case stops the recursion, and what happens without one.",
    learn: [concept("recursion", "Step through calls as frames are pushed, paused and returned in reverse.")],
    practise: [
      mission("recursion-depth", "Predict how deep the stack goes before it unwinds.", ["concept:recursion"]),
      mission("recursion-base-case", "Compare a recursion with and without a base case.", ["concept:recursion"]),
    ],
  },
  {
    id: "choose-structure",
    title: "Choose the right structure",
    objective: "Compare structures on the operations a program needs, and count the work each one really does.",
    learn: [concept("data-structures", "Choose a structure from the operations a program performs, not from its name.")],
    practise: [mission("ds-lab", "Seven structures and every operation, with an honest count of writes.", ["concept:data-structures"])],
  },
];

export type TrackId = "networking" | "data-structures" | "system-design";
export type LearningTrack = {
  id: TrackId;
  title: string;
  /** One line for a first-time learner: what the track teaches. */
  summary: string;
  /** Where the track's roadmap lives. */
  path: string;
  stages: Stage[];
};

export const tracks: LearningTrack[] = [
  {
    id: "networking",
    title: "Networking",
    summary: "From the boxes in your home to a web page crossing the Internet: Wi-Fi, addresses, routing, DNS and TCP.",
    path: "/learn",
    stages: networkingPath,
  },
  {
    id: "data-structures",
    title: "Data structures & recursion",
    summary: "How programs keep values in memory: arrays, linked lists, hash tables, trees and graphs, and the call stack.",
    path: "/learn/data-structures",
    stages: dataStructuresPath,
  },
  {
    id: "system-design",
    title: "System design & architecture",
    summary: "Design real applications from APIs, databases, caches, load balancers and queues, then send simulated traffic through them and see why they slow down or fail.",
    path: "/learn/system-design",
    stages: systemDesignPath,
  },
];

export const findTrack = (id: string) => tracks.find((track) => track.id === id);

/** The roadmap address of one unit, so "Back to the roadmap" opens on the right unit. */
export const unitPath = (track: LearningTrack, stage: Stage) => `${track.path}#unit-${stage.id}`;

const located = tracks.flatMap((track) =>
  track.stages.flatMap((stage, stageIndex) => {
    const list = [...stage.learn, ...stage.practise];
    return list.map((activity, index) => ({ track, stage, stageNumber: stageIndex + 1, activity, stepNumber: index + 1, stepCount: list.length }));
  }),
);

/** Any activity in any track, by id. */
export const findTrackActivity = (id: string) => located.find((entry) => entry.activity.id === id)?.activity;

/**
 * Where an activity sits: its track, unit and step number, the previous and next activity in its track, and
 * what to do first (suggestions only).
 */
export function locate(id: string) {
  const index = located.findIndex((entry) => entry.activity.id === id);
  if (index === -1) return undefined;
  const here = located[index];
  const sameTrack = (entry: (typeof located)[number] | undefined) => (entry && entry.track === here.track ? entry : undefined);
  return {
    ...here,
    /** Learn activities come first in a unit, then practice. */
    role: here.stage.learn.includes(here.activity) ? ("learn" as const) : ("practise" as const),
    previous: sameTrack(located[index - 1])?.activity,
    next: sameTrack(located[index + 1])?.activity,
    needs: (here.activity.needs ?? []).map((need) => findTrackActivity(need)).filter((a): a is Activity => a !== undefined),
  };
}

const activitiesOf = (track: LearningTrack) => track.stages.flatMap((stage) => [...stage.learn, ...stage.practise]);

/** Completion counts lessons and missions only; opening an exploration never moves the percentage. */
export function trackProgress(track: LearningTrack, evidence: Evidence) {
  const states = activitiesOf(track).filter(isRequired).map((activity) => activityState(activity, evidence));
  const completed = states.filter((state) => state === "completed" || state === "mastered").length;
  return {
    total: states.length,
    completed,
    mastered: states.filter((state) => state === "mastered").length,
    started: states.some((state) => state !== "not-started"),
    percent: states.length ? Math.round((completed / states.length) * 100) : 0,
  };
}

/** Anything recorded at all, in any store: the learner has been here before. */
export function hasHistory(evidence: Evidence) {
  return [evidence.visits.activities, evidence.learning.lessons, evidence.progress.missions, evidence.network.missions, evidence.architecture.lessons, evidence.architecture.challenges].some((records) => Object.keys(records).length > 0);
}

/** The track the learner touched most recently; networking when nothing is dated. */
export function activeTrack(evidence: Evidence): LearningTrack {
  let best = tracks[0];
  let bestAt = "";
  for (const track of tracks) {
    for (const activity of activitiesOf(track)) {
      const at = lastActive(activity, evidence);
      if (at > bestAt) [best, bestAt] = [track, at];
    }
  }
  // Undated records (older saves) still count: a track with recorded progress beats one with none.
  if (!bestAt && !trackProgress(tracks[0], evidence).started) best = tracks.find((track) => trackProgress(track, evidence).started) ?? tracks[0];
  return best;
}

export const recommendFor = (track: LearningTrack, evidence: Evidence) => recommend(evidence, track.stages);

/** The recommended step as a link, worded by what Kitab actually knows. */
export function nextLink(r: Recommendation, track: LearningTrack = tracks[0]) {
  if (r.kind === "done") {
    if (track.id === "networking") return { label: "Open the Playground", path: "/practice/network" };
    if (track.id === "system-design") return { label: "Open the Architecture Playground", path: "/practice/architecture" };
    return { label: "Browse the Library", path: "/learn/library" };
  }
  const label = {
    start: `Start: ${r.activity.title}`,
    continue: `Continue: ${r.activity.title}`,
    next: `Next: ${r.activity.title}`,
    mastery: `Work towards mastery: ${r.activity.title}`,
  }[r.kind];
  return { label, path: r.activity.path };
}

/** What kind of step an activity is, in the learner's words. */
export function kindOf(activity: Activity): "Lesson" | "Reading" | "Explore" | "Predict" | "Troubleshoot" | "Challenge" | "Design" {
  if (activity.track === "lesson" || activity.track === "architecture-lesson" || activity.id === "hello-tcp") return "Lesson";
  if (activity.track === "architecture-challenge") return "Design";
  if (activity.track === "network-mission") return "Troubleshoot";
  if (activity.track === "mission") return activity.id.endsWith("-lab") ? "Challenge" : "Predict";
  if (activity.id.startsWith("concept:")) return "Reading";
  return "Explore";
}
