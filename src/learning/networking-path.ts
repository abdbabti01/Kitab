// The networking path: existing lessons, playground starters and missions in teaching order. Data and pure
// functions only. Progress is read from the existing lesson, mission and networking-mission records; the path
// stores nothing. Nothing is locked: every activity stays open, and the playground stays free to use.
import { HTTP_WALKTHROUGH_PATH } from "../app/routes.ts";
import { findLesson, packetJourney } from "./lessons/catalog.ts";
import { lessonStatus, type Learning } from "./lessons/progress.ts";
import { findMission } from "./missions/catalog.ts";
import { practiceState, type Progress } from "./progress.ts";
import type { PracticeState } from "./practice-state.ts";
import { missionState, type MissionStore } from "../practice/network/mission-progress.ts";

export type Activity = {
  /** Unique in the path: a lesson or mission id, "connections", or "starter:<starter id>". */
  id: string;
  title: string;
  /** What the learner does or sees there, in one line. */
  detail: string;
  path: string;
  /** Where completion is recorded; absent when the activity records none (exploration, playground, Packet Journey). */
  track?: "lesson" | "mission" | "network-mission";
  /** Networking missions are loaded with the engine, so their version is repeated here (a test keeps it in step). */
  version?: string;
  /** Path activities to do first. Shown as links, never enforced. */
  needs?: string[];
};
export type Stage = { id: string; title: string; objective: string; learn: Activity[]; practise: Activity[] };

const lesson = (id: string, detail: string): Activity => ({ id, title: findLesson(id)!.title, detail, path: `/learn/${id}`, track: "lesson" });
const mission = (id: string, detail: string, needs?: string[]): Activity => ({ id, title: findMission(id)!.title, detail, path: `/missions/${id}`, track: "mission", needs });
const networkMission = (id: string, title: string, version: string, detail: string, needs?: string[]): Activity => ({
  id, title, version, detail, path: `/practice/missions/${id}`, track: "network-mission", needs,
});
const starter = (id: string, title: string, detail: string): Activity => ({ id: `starter:${id}`, title, detail, path: `/practice/network?starter=${id}` });

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
    title: "Addresses, subnets and routes",
    objective: "Read an address and its mask, decide what is local, and follow traffic through a gateway and NAT.",
    learn: [
      lesson("ip-addressing", "Read an IPv4 address, split a subnet, choose a next hop and follow NAT."),
      starter("routed", "Two connected LANs", "Watch a router forward between two subnets using gateways."),
    ],
    practise: [
      networkMission("neighbours", "Neighbours that look remote", "1.0.0", "A wrong mask makes a local server look remote.", ["ip-addressing"]),
      // Joining Wi-Fi and DHCP are met in stage 2; troubleshooting DHCP needs subnets, so it comes after the lesson.
      networkMission("join-and-address", "Join and get an address", "1.0.0", "Troubleshoot Wi-Fi and DHCP: the pool must hold free addresses in the LAN's subnet.", ["starter:wifi", "ip-addressing"]),
      networkMission("leave-the-lan", "Leave your LAN", "1.0.0", "Fix gateways and routes so traffic can leave its network and come back.", ["ip-addressing", "starter:routed"]),
      networkMission("bring-reply-home", "Bring the reply home", "1.0.0", "Websites don't load: find what stops the reply on its way back through NAT.", ["ip-addressing"]),
    ],
  },
  {
    id: "internet",
    title: "Across the Internet",
    objective: "Follow a web request: DNS finds the server's address, TCP delivers the bytes reliably and HTTP carries the page.",
    learn: [
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

/** The existing progress records the path reads. */
export type Evidence = { learning: Learning; progress: Progress; network: MissionStore };

/** Recorded progress, or null when the activity records none: never read as completed. */
export function activityState(activity: Activity, evidence: Evidence): PracticeState | null {
  if (activity.track === "lesson") {
    const state = lessonStatus(evidence.learning, findLesson(activity.id)!).state;
    return state === "completed" ? "completed" : state === "new" ? "not-started" : "in-progress";
  }
  if (activity.track === "mission") {
    const found = findMission(activity.id)!;
    return practiceState(evidence.progress, found.id, found.version);
  }
  if (activity.track === "network-mission") return missionState(evidence.network.missions[activity.id], { version: activity.version! });
  return null;
}

const done = (state: PracticeState | null) => state === "completed" || state === "mastered";

/** Tracked activities only: exploration never counts towards completion. Lessons have no mastery. */
export function stageProgress(stage: Stage, evidence: Evidence) {
  const states = [...stage.learn, ...stage.practise].map((activity) => activityState(activity, evidence)).filter((state) => state !== null);
  return { tracked: states.length, completed: states.filter(done).length, mastered: states.filter((state) => state === "mastered").length };
}

/**
 * What to do next, from recorded progress only:
 * - "start": nothing recorded yet, so the path's first activity.
 * - "suggested": an untracked activity after the last completed tracked one and before the next unfinished one.
 *   It may already have been done; the path cannot know, so it is offered, never marked done or skipped silently.
 * - "continue": the first tracked activity not completed is in progress (it wins over a suggestion before it).
 * - "next": the first tracked activity not completed, not started yet.
 * - "mastery": everything tracked is completed; the first mission not yet mastered.
 * - "done": every mission mastered.
 */
export type Recommendation = { kind: "start" | "suggested" | "continue" | "next" | "mastery" | "done"; activity: Activity; stage: Stage };

export function recommend(evidence: Evidence): Recommendation {
  const states = steps.map((step) => activityState(step.activity, evidence));
  const at = (kind: Recommendation["kind"], index: number): Recommendation => ({ kind, ...steps[index] });
  const unfinished = states.findIndex((state) => state !== null && !done(state));
  if (unfinished === -1) {
    const notMastered = states.findIndex((state, index) => state === "completed" && steps[index].activity.track !== "lesson");
    return notMastered === -1 ? at("done", steps.length - 1) : at("mastery", notMastered);
  }
  if (states[unfinished] === "in-progress") return at("continue", unfinished);
  let lastTracked = -1;
  for (let index = 0; index < unfinished; index++) if (states[index] !== null) lastTracked = index;
  if (lastTracked + 1 < unfinished) {
    const nothingYet = states.every((state) => state === null || state === "not-started");
    return at(nothingYet && lastTracked === -1 ? "start" : "suggested", lastTracked + 1);
  }
  return at("next", unfinished);
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
