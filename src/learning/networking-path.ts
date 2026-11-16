// The networking path: existing lessons, playground starters and missions in teaching order. Data and pure
// functions only. Progress is read from the existing lesson, mission and networking-mission records and the
// visit store; the path itself stores nothing. Nothing is locked: every activity stays open, and the playground
// stays free to use.
import { HTTP_WALKTHROUGH_PATH } from "../app/routes.ts";
import { chapters } from "../content/chapters.ts";
import { findLesson, packetJourney } from "./lessons/catalog.ts";
import { lessonStatus, loadLearning, type Learning } from "./lessons/progress.ts";
import { findMission } from "./missions/catalog.ts";
import { loadProgress, practiceState, type Progress } from "./progress.ts";
import type { PracticeState } from "./practice-state.ts";
import { loadVisits, type Visits } from "./visits.ts";
import { loadMissionStore, missionState, type MissionStore } from "../practice/network/mission-progress.ts";
import { challengeRecordFor, loadArchitectureProgress, type ArchitectureProgress } from "../architecture/progress.ts";
import { labRecordFor, labState, loadLabProgress, type LabProgress } from "../architecture/labs/progress.ts";

export type Activity = {
  /** Unique across tracks: a lesson or mission id, an explorer ("connections", "subnet-explorer"), "starter:<starter id>" or "concept:<chapter slug>". */
  id: string;
  title: string;
  /** What the learner does or sees there, in one line. */
  detail: string;
  path: string;
  /**
   * Where completion is recorded; absent when the activity records only visits (exploration, playground, concept,
   * Packet Journey). System Design lessons complete when their experiment has been run; challenges when passed.
   */
  track?: "lesson" | "mission" | "network-mission" | "architecture-lesson" | "architecture-challenge" | "architecture-lab";
  /** Networking missions and design challenges are loaded with their engine, so their version is repeated here (a test keeps it in step). */
  version?: string;
  /** Path activities to do first. Shown as links, never enforced. */
  needs?: string[];
};
/** A System Design activity's lesson or challenge id ("sd:fundamentals" → "fundamentals"). */
export const architectureId = (activity: Activity) => activity.id.slice(activity.id.indexOf(":") + 1);

export type Stage = { id: string; title: string; objective: string; learn: Activity[]; practise: Activity[] };

export const lesson = (id: string, detail: string): Activity => ({ id, title: findLesson(id)!.title, detail, path: `/learn/${id}`, track: "lesson" });
export const mission = (id: string, detail: string, needs?: string[]): Activity => ({ id, title: findMission(id)!.title, detail, path: `/missions/${id}`, track: "mission", needs });
const networkMission = (id: string, title: string, version: string, detail: string, needs?: string[]): Activity => ({
  id, title, version, detail, path: `/practice/missions/${id}`, track: "network-mission", needs,
});
const starter = (id: string, title: string, detail: string): Activity => ({ id: `starter:${id}`, title, detail, path: `/practice/network?starter=${id}` });
export const concept = (slug: string, detail: string): Activity => ({ id: `concept:${slug}`, title: chapters.find((c) => c.slug === slug)!.title, detail, path: `/concepts/${slug}` });

export const networkingPath: Stage[] = [
  {
    id: "home",
    title: "Your home connection",
    objective: "What each box at home does, and how Wi-Fi, Ethernet and your provider's line carry a message.",
    learn: [{ id: "connections", title: "How your home connects", detail: "Choose DSL, cable or fiber and follow one message from your laptop to a website.", path: "/practice/connections" }],
    practise: [],
  },
  {
    id: "lan",
    title: "Inside your LAN",
    objective: "How devices on one network find each other with MAC addresses, ARP and a switch, and how a phone joins Wi-Fi and gets an address from DHCP.",
    learn: [
      starter("lan", "Your first LAN", "Send a ping between two computers and watch ARP and the switch deliver it."),
      starter("wifi", "A wireless home", "Join Wi-Fi, then watch DHCP hand the phone an address."),
    ],
    practise: [networkMission("no-connection", "No connection", "1.0.0", "Find the broken link, port or Wi-Fi setting that keeps two devices apart.", ["starter:lan", "starter:wifi"])],
  },
  {
    id: "addresses",
    title: "IPv4 addresses and subnets",
    objective: "Read an address and its prefix, find the block it belongs to, and decide with a device's own prefix what is local.",
    learn: [
      lesson("ipv4-subnets", "Address bits, prefixes and masks, network and broadcast addresses, and the same-subnet decision."),
      { id: "subnet-explorer", title: "Explore subnets", detail: "Any address and prefix: its bits, its block, and predictions with feedback.", path: "/practice/subnets" },
    ],
    practise: [
      mission("ipv4-network-address", "Find the network address for boundaries inside the second, third and fourth octets.", ["ipv4-subnets"]),
      mission("ipv4-local-or-remote", "Decide with a device's own prefix whether it sends directly or through its gateway.", ["ipv4-subnets"]),
      networkMission("neighbours", "Neighbours that look remote", "1.0.0", "A wrong mask makes a local server look remote.", ["ipv4-subnets"]),
      // Joining Wi-Fi and DHCP are met in stage 2; troubleshooting DHCP needs subnets, so it comes after the lesson.
      networkMission("join-and-address", "Join and get an address", "1.0.0", "Troubleshoot Wi-Fi and DHCP: the pool must hold free addresses in the LAN's subnet.", ["starter:wifi", "ipv4-subnets"]),
    ],
  },
  {
    id: "routing",
    title: "Gateways, routing and NAT",
    objective: "Follow a packet to its gateway and through a router, see which addresses change at each hop, and bring replies home through NAT.",
    learn: [
      lesson("local-delivery-routing", "Next hop and ARP, frames and packets, a router's decision, NAT, and three experiments that break one setting."),
      starter("routed", "Two connected LANs", "Watch a router forward between two subnets using gateways."),
    ],
    practise: [
      mission("gateway-or-direct", "Predict whose MAC goes on the frame: the destination's or the gateway's.", ["local-delivery-routing"]),
      networkMission("leave-the-lan", "Leave your LAN", "1.0.0", "Fix gateways and routes so traffic can leave its network and come back.", ["local-delivery-routing", "starter:routed"]),
      networkMission("bring-reply-home", "Bring the reply home", "1.0.0", "Websites don't load: find what stops the reply on its way back through NAT.", ["local-delivery-routing"]),
    ],
  },
  {
    id: "internet",
    title: "Across the Internet",
    objective: "Follow a web request: DNS finds the server's address, TCP delivers the bytes reliably and HTTP carries the page.",
    learn: [
      // DNS comes before the first activity that depends on it; earlier stages request servers by IP address.
      concept("dns", "How a name such as kitab.test becomes the IP address a request is sent to."),
      starter("internet", "A request across the Internet", "Load a page over Wi-Fi, your router, the provider and DNS."),
      { id: packetJourney.id, title: packetJourney.title, detail: "Follow GET /hello through sockets, TCP and IP in a recorded C# run.", path: HTTP_WALKTHROUGH_PATH },
    ],
    practise: [
      mission("tcp-lost-segment", "Predict the acknowledgment when a segment is lost.", [packetJourney.id]),
      mission("tcp-send-window", "Predict how much data can be in flight before an acknowledgment returns.", [packetJourney.id]),
      networkMission("missing-segment", "A segment goes missing", "1.0.0", "Explain a slow page from the evidence of a TCP retransmission.", ["tcp-lost-segment"]),
    ],
  },
  {
    id: "mastery",
    title: "Show mastery",
    objective: "Count TCP transmissions in an open lab, and master each mission by solving a second version with a different cause.",
    learn: [],
    practise: [mission("tcp-lab", "Change loss, window and size, and predict every transmission.", ["tcp-lost-segment", "tcp-send-window"])],
  },
];

const steps = networkingPath.flatMap((stage) => [...stage.learn, ...stage.practise].map((activity) => ({ stage, activity })));
export const findActivity = (id: string) => steps.find((step) => step.activity.id === id)?.activity;

/** The progress records the path reads: the lesson, mission and networking stores, and the visit store. */
export type Evidence = { learning: Learning; progress: Progress; network: MissionStore; visits: Visits; architecture: ArchitectureProgress; labs: LabProgress };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/**
 * Reads every progress store without ever writing. The loaders set damaged data aside when they find it; here
 * that is suppressed, so showing progress (in the header, on any page) can never move or remove a record. The
 * page that owns a store still repairs it when the learner uses that page, as before.
 */
export function loadEvidence(storage: Pick<Storage, "getItem">): Evidence {
  const readOnly: StorageLike = { getItem: (key) => storage.getItem(key), setItem: () => {}, removeItem: () => {} };
  return { learning: loadLearning(readOnly).learning, progress: loadProgress(readOnly).progress, network: loadMissionStore(readOnly), visits: loadVisits(readOnly), architecture: loadArchitectureProgress(readOnly), labs: loadLabProgress(readOnly) };
}

/** Lessons and missions record completion; explorations, starters, readings and Packet Journey record only visits. */
export const isRequired = (activity: Activity) => activity.track !== undefined;

/**
 * Every activity's state from what was recorded. A visit alone is "visited": never in progress, never completed.
 * A lesson part-way through is in progress; a lesson only opened, or last opened in an earlier version, is visited.
 */
export function activityState(activity: Activity, evidence: Evidence): PracticeState {
  let state: PracticeState = "not-started";
  if (activity.track === "lesson") {
    const status = lessonStatus(evidence.learning, findLesson(activity.id)!).state;
    state = status === "completed" ? "completed" : status === "learning" ? "in-progress" : status === "visited" ? "visited" : "not-started";
  } else if (activity.track === "mission") {
    const found = findMission(activity.id)!;
    state = practiceState(evidence.progress, found.id, found.version);
  } else if (activity.track === "network-mission") {
    state = missionState(evidence.network.missions[activity.id], { version: activity.version! });
  } else if (activity.track === "architecture-lesson") {
    // A lesson with an experiment completes when it has been run; a concept unit when every check is answered right.
    const unit = evidence.labs.units[architectureId(activity)];
    state = evidence.architecture.lessons[architectureId(activity)] || unit?.completedAt ? "completed" : unit ? "in-progress" : "not-started";
  } else if (activity.track === "architecture-lab") {
    state = labState(labRecordFor(evidence.labs, architectureId(activity), activity.version!));
  } else if (activity.track === "architecture-challenge") {
    const record = challengeRecordFor(evidence.architecture, architectureId(activity), activity.version!);
    state = record?.passedAt ? "completed" : record ? "in-progress" : "not-started";
  }
  return state === "not-started" && evidence.visits.activities[activity.id] ? "visited" : state;
}

/** Missions and labs can be mastered; lessons and design challenges can only be completed. */
export const canMaster = (activity: Activity) => activity.track === "mission" || activity.track === "network-mission" || activity.track === "architecture-lab";

const done = (state: PracticeState) => state === "completed" || state === "mastered";
const started = (state: PracticeState) => state === "in-progress" || done(state);

/** Lessons and missions decide completion; explorations are counted apart and never complete a stage. */
export function stageProgress(stage: Stage, evidence: Evidence) {
  const all = [...stage.learn, ...stage.practise];
  const states = all.filter(isRequired).map((activity) => activityState(activity, evidence));
  const explorations = all.filter((activity) => !isRequired(activity));
  return {
    tracked: states.length,
    completed: states.filter(done).length,
    mastered: states.filter((state) => state === "mastered").length,
    explorations: explorations.length,
    explored: explorations.filter((activity) => activityState(activity, evidence) !== "not-started").length,
  };
}

/** The latest moment any record shows the learner on this activity, as an ISO time ("" if never). */
export function lastActive(activity: Activity, evidence: Evidence): string {
  const times = [evidence.visits.activities[activity.id]?.last ?? ""];
  if (activity.track === "lesson") times.push(evidence.learning.lessons[activity.id]?.lastVisitedAt ?? "");
  if (activity.track === "mission") {
    const item = evidence.progress.missions[activity.id];
    times.push(item?.lastVisitedAt ?? "", ...(item?.attempts ?? []).map((a) => a.at));
  }
  if (activity.track === "network-mission") {
    for (const a of evidence.network.missions[activity.id]?.attempts ?? []) times.push(a.startedAt, a.completedAt ?? "");
  }
  if (activity.track === "architecture-lesson") {
    times.push(evidence.architecture.lessons[architectureId(activity)]?.experimentAt ?? "");
    for (const answer of Object.values(evidence.labs.units[architectureId(activity)]?.answers ?? {})) times.push(answer.at);
  }
  if (activity.track === "architecture-lab") times.push(evidence.labs.labs[architectureId(activity)]?.lastAt ?? "");
  if (activity.track === "architecture-challenge") times.push(evidence.architecture.challenges[architectureId(activity)]?.lastAt ?? "");
  // Only ISO times compare; placeholders such as "earlier" (migrated challenges) count as never.
  return times.filter((t) => /^\d{4}-/.test(t)).sort().at(-1) ?? "";
}

/**
 * What to do next, from recorded progress only. Deterministic, in this order:
 * 1. "continue": the most recently active lesson or mission in progress, or a lesson that was opened. A mission
 *    only opened is not in progress and is not offered here.
 * 2. "start" / "next": from the furthest lesson or mission with real progress (the frontier), the first later
 *    activity still to do: a lesson or mission not completed, or an exploration not yet opened. Explorations
 *    behind the frontier are not offered again, so progress in Stage 3 never sends a learner back to Stage 1,
 *    and opening something out of order never moves the frontier.
 * 3. "next": a lesson or mission skipped earlier on the path, in path order.
 * 4. "mastery": every lesson and mission completed; the first mission not yet mastered.
 * 5. "done": every mission mastered.
 */
export type Recommendation = { kind: "start" | "continue" | "next" | "mastery" | "done"; activity: Activity; stage: Stage };

export function recommend(evidence: Evidence, path: Stage[] = networkingPath): Recommendation {
  const list = path.flatMap((stage) => [...stage.learn, ...stage.practise].map((activity) => ({ stage, activity })));
  const states = list.map((step) => activityState(step.activity, evidence));
  const at = (kind: Recommendation["kind"], index: number): Recommendation => ({ kind, ...list[index] });

  let resume = -1;
  let resumeAt = "";
  list.forEach((step, index) => {
    const open = states[index] === "in-progress" || (step.activity.track === "lesson" && states[index] === "visited");
    if (!open) return;
    const when = lastActive(step.activity, evidence);
    if (resume === -1 || when > resumeAt) [resume, resumeAt] = [index, when];
  });
  if (resume !== -1) return at("continue", resume);

  let frontier = -1;
  list.forEach((step, index) => {
    if (isRequired(step.activity) && started(states[index])) frontier = index;
  });
  const ahead = list.findIndex((step, index) => index > frontier && (isRequired(step.activity) ? !done(states[index]) : states[index] === "not-started"));
  if (ahead !== -1) return at(frontier === -1 && states.every((state) => state === "not-started") ? "start" : "next", ahead);
  const skipped = list.findIndex((step, index) => isRequired(step.activity) && !done(states[index]));
  if (skipped !== -1) return at("next", skipped);
  const notMastered = list.findIndex((step, index) => canMaster(step.activity) && states[index] === "completed");
  return notMastered === -1 ? at("done", list.length - 1) : at("mastery", notMastered);
}

/** Where an activity sits: its stage and number, the next activity in path order, and what to do first. */
export function pathPosition(id: string) {
  const index = steps.findIndex((step) => step.activity.id === id);
  if (index === -1) return undefined;
  const { stage, activity } = steps[index];
  return {
    stage,
    stageNumber: networkingPath.indexOf(stage) + 1,
    activity,
    next: steps[index + 1]?.activity,
    needs: (activity.needs ?? []).map((need) => findActivity(need)!),
  };
}
