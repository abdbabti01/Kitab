import { packetChapters } from "../engines/packet-journey.ts";
import { ipAddressing } from "./ip-addressing.ts";
import { parseLesson, type Lesson } from "./schema.ts";

/**
 * Reviewed beginner journeys. Every value shown comes from the engine through {fact:…}, {param.…} or
 * {outcome.…}; the prose explains purpose and cause. validateLessonContent() checks every reachable scenario.
 */
const reviewed = { status: "reviewed" as const, note: "Values computed by Kitab's engines; explanations reviewed against the model." };

const packetJourney = {
  schemaVersion: 1,
  id: "hello-tcp",
  version: "2.0.0",
  title: "Packet Journey",
  question: "How does an HTTP request travel from a browser to a server and back?",
  summary: "Follow GET /hello through sockets, TCP, IPv4 and a router. Look inside each device and watch the headers go on and come off.",
  topic: "Networks",
  review: { status: "reviewed", note: "A recorded C# simulation with step explanations and source lines." },
  engine: { id: "packet-journey", version: "1.0.0" },
  scenario: {},
  scope: [
    "A browser, a server and one router. This is one recorded run of the C# simulator.",
    "TCP uses small chunks so you can see how the HTTP message is split. Both headers use the model's 20-byte sizes.",
    "The example uses plain HTTP and a known IP address. The practice missions explore loss and flow control.",
  ],
  prerequisites: "None. Start with the listening socket and follow one operation at a time.",
  levels: [
    { id: "application", name: "HTTP", short: "Browser and server app", intro: "The browser makes a request. The server reads it and builds a response. HTTP supplies the method, headers and body." },
    { id: "socket", name: "Socket", short: "How apps ask the OS to send or receive", intro: "Apps use sockets to request a connection and hand bytes to or take bytes from the operating system. A server listens on a port, then accepts a connected socket." },
    { id: "transport", name: "TCP", short: "Connection, segments and acknowledgments", intro: "TCP runs on the two end computers. It opens the connection, splits the byte stream into segments and tracks which bytes have arrived." },
    { id: "network", name: "IPv4", short: "Packets, routes and the router", intro: "Routers work at this level. They look at the destination IP, find the next hop and lower the TTL before forwarding." },
  ],
  glossary: [
    { id: "socket", term: "Socket", definition: "An app's interface to the operating system for network connections." },
    { id: "port", term: "Port", definition: "A number the operating system uses to identify a network endpoint." },
    { id: "http", term: "HTTP", definition: "The format the browser and server use for requests and responses." },
    { id: "syn", term: "SYN", definition: "The TCP flag that starts a connection and announces a starting sequence number." },
    { id: "ack", term: "ACK", definition: "The acknowledgment names the next sequence number expected." },
    { id: "sequence", term: "Sequence number", definition: "TCP uses this number to place bytes in the stream." },
    { id: "segment", term: "Segment", definition: "A TCP header and the bytes it carries." },
    { id: "packet", term: "Packet", definition: "An IPv4 header and the TCP segment it carries in this example." },
    { id: "ttl", term: "TTL", definition: "A hop limit in the IPv4 header. Each forwarding router subtracts one." },
    { id: "payload", term: "Payload", definition: "The data carried inside a header. A TCP segment can carry HTTP bytes." },
    { id: "buffer", term: "Buffer", definition: "Memory that holds bytes until an app reads them." },
  ],
  kinds: {
    device: { represents: "The client, server or router in this run.", matters: "The highlighted device is where the current operation takes place." },
    payload: { represents: "The application bytes, or an empty payload for a TCP control segment.", matters: "TCP can split these bytes. The receiving app reads the assembled message." },
    "tcp-header": { represents: "TCP's ports, flags, sequence number and acknowledgment.", matters: "These fields help the receiving endpoint interpret and order what arrived." },
    "ip-header": { represents: "IPv4 source and destination addresses and TTL.", matters: "A router uses the destination to decide where to send the packet next." },
  },
  chapters: packetChapters.map(({id, title, goal, terms}) => ({
    id, title, goal, steps: [{id, each: {chapter: id}, what: "{frame.narration}", why: "{fact:reason}", terms}],
  })),
  practice: [
    { missionId: "tcp-lost-segment", why: "Predict which acknowledgment the receiver sends when a segment is lost." },
    { missionId: "tcp-send-window", why: "Predict how much data can be in flight before an acknowledgment returns." },
  ],
  sources: [
    { id: "recording", text: "The Packet Journey example comes from a C# simulator run and follows its HTTP request and response through the two endpoints and one router." },
    { id: "tcp-service", text: "TCP establishes a connection, numbers the byte stream and uses cumulative acknowledgments naming the next expected sequence number. SYN consumes one sequence number." },
    { id: "ip-forwarding", text: "The router chooses a next hop by looking up the destination IP and lowers the packet's TTL by one. TCP endpoints handle acknowledgments and retransmission." },
  ],
};

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

export const lessons: Lesson[] = [ipAddressing, packetJourney, arrayInsert].map((item) => parseLesson(item));

export function findLesson(id: string) {
  return lessons.find((lesson) => lesson.id === id);
}

/** Lessons that teach the fundamentals before a mission practises them. */
export function lessonsForMission(missionId: string) {
  return lessons.filter((lesson) => lesson.practice.some((item) => item.missionId === missionId));
}
