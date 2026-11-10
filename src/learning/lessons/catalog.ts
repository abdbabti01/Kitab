import { ipAddressing } from "./ip-addressing.ts";
import { parseLesson, type Lesson } from "./schema.ts";

/**
 * Reviewed beginner journeys. Every value shown comes from the engine through {fact:…}, {param.…} or
 * {outcome.…}; the prose explains purpose and cause. validateLessonContent() checks every reachable scenario.
 */
const reviewed = { status: "reviewed" as const, note: "Values computed by Kitab's engines; explanations reviewed against the model." };

const arrayInsert = {
  schemaVersion: 1,
  id: "array-insert",
  version: "1.0.0",
  title: "Make room in an array",
  question: "What happens in memory when you insert a value into the middle of an array?",
  summary: "Meet values, indexes and side-by-side memory slots, then watch every value move to make room for a new one.",
  topic: "Data structures",
  review: reviewed,
  engine: { id: "data-structures", version: "2.0.0" },
  scenario: { kind: "array", operation: "insert", value: 9, index: 1 },
  scope: [
    "One array of five whole numbers, each stored in a 4-byte slot.",
    "Kitab assumes the array has spare room for one more slot at the end.",
  ],
  prerequisites: "None.",
  levels: [
    { id: "program", name: "Program", short: "What the code asks for", intro: "The program's view: a request such as “put 9 at index 1”, and the values it expects to read afterwards." },
    { id: "array", name: "Array", short: "Values in numbered positions", intro: "The array's view: an ordered row of values, each at an index counted from 0." },
    { id: "memory", name: "Memory", short: "Slots side by side at addresses", intro: "The machine's view: each value sits in a fixed-size slot at an address, with no gaps between slots. Moving a value means copying it into another slot." },
  ],
  glossary: [
    { id: "array", term: "Array", definition: "Values kept in one row of equal-size slots, side by side in memory." },
    { id: "value", term: "Value", definition: "A piece of data stored in a slot: here, a whole number." },
    { id: "index", term: "Index", definition: "A position in the array, counted from 0." },
    { id: "address", term: "Address", definition: "A number naming a place in memory. Each slot starts at its own address." },
    { id: "contiguous", term: "Contiguous", definition: "Side by side with no gaps: slot i + 1 starts right where slot i ends." },
    { id: "shift", term: "Shift", definition: "Copying a value one slot over to make room." },
  ],
  kinds: {
    slot: { represents: "One 4-byte slot of the array: an index, an address and the value stored there.", matters: "Its address follows from its index; inserting means values must be copied between slots." },
  },
  controls: [
    { key: "index", label: "Insert position", control: "choice", options: [{ value: 1, label: "Index 1" }, { value: 3, label: "Index 3" }], help: "Choose where the new value goes; the engine recomputes every copy." },
  ],
  chapters: [
    {
      id: "values",
      title: "A row of values",
      goal: "An array keeps several values in one numbered row.",
      steps: [
        { id: "values", title: "Five values in a row", frame: "frame-0", level: "array", actor: "The array", focus: ["array-0", "array-1", "array-2", "array-3", "array-4"], terms: ["array", "value"], what: "This array holds {fact:length} whole numbers: {fact:values}.", why: "Programs use arrays to keep related values together and reach any one of them quickly." },
        { id: "indexes", title: "Indexes count from 0", frame: "frame-0", level: "array", actor: "The array", focus: ["array-2"], terms: ["index"], what: "Each position has an index, counting from 0. Index 2 holds {fact:slot-2}.", why: "The index, not the value, says where something is. The first value is at index 0, not 1." },
      ],
    },
    {
      id: "memory",
      title: "Stored side by side",
      goal: "In memory, the slots sit right next to each other. That makes reading fast and inserting slow.",
      steps: [
        { id: "slots", title: "Each slot is 4 bytes", frame: "frame-0", level: "memory", actor: "Memory", focus: ["array-0", "array-1"], terms: ["address", "contiguous"], what: "Each value is a 4-byte number in its own slot. Index 0 starts at address {fact:addr-0} and index 1 at {fact:addr-1}.", why: "There are no gaps: each slot starts exactly 4 bytes after the one before it." },
        { id: "formula", title: "Finding any slot by calculation", frame: "frame-0", level: "memory", actor: "Memory", focus: ["array-3"], what: "So any index's address is the start address + index × 4. Index 3 is at {fact:addr-3}.", why: "One calculation reaches any index directly. The cost: there is no space between slots for a new value to slip into." },
      ],
    },
    {
      id: "insert",
      title: "Insert {param.value} at index {param.index}",
      goal: "The program wants a new value at index {param.index}. Every later value must move one slot first.",
      steps: [
        { id: "request", title: "The request: insert {param.value} at index {param.index}", frame: "frame-0", level: "program", actor: "The program", focus: ["array-{param.index}"], terms: ["shift"], what: "The program asks to put {param.value} at index {param.index}, which already holds {fact:slot-{param.index}}.", why: "Writing there now would destroy {fact:slot-{param.index}}. So every value from index {param.index} onward moves one slot right, into the spare slot at the end." },
        { id: "shift", each: { chapter: "READ + WRITE" }, level: "memory", actor: "The program, copying one slot", what: "{frame.narration} Values now: {fact:values}.", why: "Copy from the right end first. Each value lands in a slot that is free or already copied, so nothing is lost." },
        { id: "write", each: { chapter: "WRITE" }, level: "memory", actor: "The program", what: "{frame.narration} Index {param.index} now holds {fact:slot-{param.index}}.", why: "Only now is the slot safe to overwrite: its old value already sits one slot to the right." },
      ],
    },
    {
      id: "result",
      title: "What it cost",
      goal: "Count the work the engine did.",
      steps: [
        { id: "summary", title: "Count the work", each: { chapter: "WRITE" }, level: "program", actor: "The program", what: "{outcome.shifts} values moved one slot right, then one write placed {param.value}. The array now holds {fact:values}, length {fact:length}.", why: "The nearer the front you insert, the more values must move. That is why inserting into an array can take time proportional to its length." },
      ],
    },
  ],
  practice: [{ missionId: "array-insert-shift", why: "Predict how many values move for a new insert position before you watch." }],
  sources: [
    { id: "array-contiguous", text: "Array slots are contiguous: the address of index i is the start address + i × element size, so any index is reached with one calculation." },
    { id: "array-insert", text: "To insert at index i, every element from i to the end is copied one slot right, starting from the end, then the new value is written at i." },
  ],
};

export const lessons: Lesson[] = [ipAddressing, arrayInsert].map((item) => parseLesson(item));

/**
 * A standalone page served as a file (public/learn/<id>.html) with a full page load, not rendered by
 * LessonPage. Packet Journey is the original C# HttpWalkthrough export: 130 recorded events with source.
 */
export type Walkthrough = { kind: "walkthrough"; id: string; title: string; summary: string; topic: string; steps: number; practice: Lesson["practice"] };
export const packetJourney: Walkthrough = {
  kind: "walkthrough",
  id: "hello-tcp",
  title: "Packet Journey",
  summary: "Follow GET /hello through sockets, TCP, IPv4 and a router in a recorded C# simulation, with the source line behind every step.",
  topic: "Networks",
  steps: 130,
  practice: [
    { missionId: "tcp-lost-segment", why: "Predict which acknowledgment the receiver sends when a segment is lost." },
    { missionId: "tcp-send-window", why: "Predict how much data can be in flight before an acknowledgment returns." },
  ],
};

/** Home's learning journeys, in order: IP addressing leads into Packet Journey. */
export const journeys: (Lesson | Walkthrough)[] = [lessons[0], packetJourney, lessons[1]];

export function findLesson(id: string) {
  return lessons.find((lesson) => lesson.id === id);
}

/** A lesson or walkthrough, for links such as "Next lesson". */
export function findJourney(id: string) {
  return journeys.find((journey) => journey.id === id);
}

/** Lessons and walkthroughs that teach the fundamentals before a mission practises them. */
export function lessonsForMission(missionId: string) {
  return journeys.filter((journey) => journey.practice.some((item) => item.missionId === missionId));
}
