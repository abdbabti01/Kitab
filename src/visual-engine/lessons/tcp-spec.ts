import { parseLessonSpec } from "../core/lesson-spec.ts";

export const tcpLessonSpec = parseLessonSpec({
  version: 1,
  slug: "tcp",
  title: "How TCP delivers a web request",
  family: "Networks",
  level: "Beginner → Intermediate",
  engine: "protocol.tcp",
  verified: true,
  summary:
    "Follow one byte stream through TCP, IP and the link layer, then observe acknowledgment and recovery.",
  objectives: [
    "Explain why TCP uses sequence and acknowledgment numbers.",
    "Distinguish a TCP segment, IP packet and link-layer frame.",
    "Describe what happens when data is lost or arrives out of order.",
  ],
  glossary: [
    {
      term: "Sequence number",
      definition: "The position of the first data byte carried by a segment.",
    },
    {
      term: "Acknowledgment number",
      definition: "The next contiguous byte the receiver expects.",
    },
    {
      term: "MSS",
      definition: "The maximum TCP application-data bytes placed in one segment.",
    },
    {
      term: "Receive window",
      definition: "How much unacknowledged data the receiver currently permits.",
    },
  ],
  chapters: [
    {
      id: "orient",
      title: "Meet the connection",
      summary: "Identify the two endpoints and the state each side owns.",
    },
    {
      id: "handshake",
      title: "Open the connection",
      summary: "Synchronize sequence spaces in both directions.",
    },
    {
      id: "encapsulate",
      title: "Wrap the bytes",
      summary: "Add the information required by each network layer.",
    },
    {
      id: "deliver",
      title: "Cross the network",
      summary: "Forward the packet and unwrap it at the destination.",
    },
    {
      id: "reliability",
      title: "Prove delivery",
      summary: "Acknowledge contiguous bytes and recover gaps.",
    },
    {
      id: "finish",
      title: "Connect the ideas",
      summary: "Review what every layer contributed.",
    },
  ],
  checkpoints: [
    {
      id: "ack-meaning",
      eventId: "syn-ack-at-client",
      prompt: "What does ACK 1001 mean?",
      choices: [
        "The next client sequence expected is 1001",
        "Exactly 1001 packets arrived",
        "Port 1001 should open",
      ],
      correctIndex: 0,
      explanation:
        "Acknowledgments name the next contiguous byte or sequence-space position expected—not a packet count.",
    },
    {
      id: "router-layer",
      eventId: "data-router",
      prompt: "Which address does the router primarily use to choose the next hop?",
      choices: ["Destination IP address", "TCP destination port", "HTTP path"],
      correctIndex: 0,
      explanation:
        "A normal IP router forwards using the destination IP. The TCP port is interpreted at the endpoint.",
    },
  ],
  defaultParameters: {
    payloadBytes: 3500,
    mssBytes: 1460,
    receiveWindowSegments: 3,
    latencyMs: 45,
    scenario: "normal",
  },
});

