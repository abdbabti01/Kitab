import type { Lesson } from "../lessons/schema.ts";

// The TCP ideas a learner needs before predicting in a TCP mission, in the order they build on each other.
// Byte numbers match Kitab's engines: the first data byte is 1001, so with an MSS of 1,460 B segment 2 starts at 2461.
// Where Kitab's model is simpler than real TCP, the term says so.
const terms = {
  mss: {
    id: "mss",
    term: "Maximum segment size (MSS)",
    definition: "The most application data one TCP segment may carry. Each side announces its limit when the connection opens; headers are not counted.",
    purpose: "Data larger than the MSS is split into several segments, each sent and acknowledged on its own.",
    example: "With an MSS of 1,460 B, 3,500 B of data needs three segments: 1,460 + 1,460 + 580 bytes.",
  },
  seq: {
    id: "seq",
    term: "Sequence number",
    definition: "Every byte TCP sends has a position number. A segment's sequence number is the position of its first byte.",
    purpose: "The receiver uses it to put bytes back in order and to notice a gap where bytes are missing.",
    example: "If segment 1 carries bytes 1001–2460 (1,460 bytes), segment 2's sequence number is 2461.",
  },
  ack: {
    id: "ack",
    term: "Cumulative acknowledgment",
    definition: "An ACK number is the next byte the receiver expects. It confirms every byte before it at once.",
    purpose: "It only moves past bytes that arrived in order, so it stops at the first missing byte even when later bytes have arrived.",
    example: "With an MSS of 1,460 B: bytes 1001–2460 arrived, bytes 2461–3920 were lost, and later bytes arrived. The receiver keeps sending ACK 2461.",
  },
  rwnd: {
    id: "rwnd",
    term: "Receive window",
    definition: "How much more data the receiver says it has room to buffer. It is advertised in every segment the receiver sends.",
    purpose: "It stops a fast sender from overwhelming the receiver. Real TCP counts it in bytes; Kitab counts it in segments.",
    example: "With a receive window of 2 segments, the sender may have at most 2 segments sent but not yet acknowledged.",
  },
  cwnd: {
    id: "cwnd",
    term: "Congestion window",
    definition: "The sender's own limit on unacknowledged data. It protects the network rather than the receiver, and the receiver never sees it.",
    purpose: "The sender may have at most the smaller of the two windows in flight. The congestion window grows as ACKs return and shrinks after a loss.",
    example: "In Kitab it starts at 10 segments and drops to 1 after a timeout. Receive window 3 and congestion window 10: at most 3 in flight.",
  },
  retransmission: {
    id: "retransmission",
    term: "Retransmission",
    definition: "Sending bytes again because no ACK confirmed them. The same bytes go out with the same sequence numbers.",
    purpose: "IP does not guarantee delivery, so the sender keeps a copy until it is acknowledged. Routers keep no copies and never resend.",
    example: "If bytes 2461–3920 are lost, only those bytes are sent again; bytes the receiver already buffered are not.",
  },
  dupack: {
    id: "dupack",
    term: "Duplicate ACK",
    definition: "An ACK that repeats the previous acknowledgment number, because data arrived after a gap.",
    purpose: "It tells the sender that later data is getting through but something before it is missing. Real TCP sends one for each segment that arrives after the gap; Kitab shows one for each batch.",
    example: "Bytes from 2461 are lost and a later segment arrives: the receiver repeats ACK 2461. After three duplicate ACKs, real TCP resends at once: fast retransmit.",
  },
  timeout: {
    id: "timeout",
    term: "Timeout recovery (Kitab's model)",
    definition: "The sender times unacknowledged data. If no ACK covers it before the retransmission timer runs out, the sender resends it.",
    purpose: "Real TCP recovers both ways: by timer, and often sooner by fast retransmit. Kitab's model always waits for the timer, so every loss recovers the same way and each step stays readable.",
    example: "Kitab shows the timer running out before every resend. Real TCP would often resend as soon as the third duplicate ACK arrived.",
  },
} satisfies Record<string, Lesson["glossary"][number]>;

// The network playground carries at most 96 bytes per segment and loses the PC's first data segment, so its
// examples use its own numbers.
const playground = {
  seq: { ...terms.seq, example: "Here a segment carries at most 96 bytes, so a longer request's first segment is bytes 1001–1096 and the next one's sequence number is 1097." },
  ack: { ...terms.ack, example: "When bytes 1001–1096 arrive, the server replies ACK 1097. While the segment starting at 1001 is missing, it can't acknowledge any of them." },
  retransmission: { ...terms.retransmission, example: "When the segment starting at 1001 is lost, the PC sends the same bytes again, still starting at sequence 1001." },
};

/** Key ideas for each TCP mission, shown before the learner predicts. */
export const keyIdeas: Record<string, Lesson["glossary"]> = {
  "tcp-lost-segment": [terms.mss, terms.seq, terms.ack, terms.dupack, terms.retransmission, terms.timeout],
  "tcp-send-window": [{ ...terms.mss, example: "This transfer is 5,000 B at an MSS of 1,200 B: four segments of 1,200 B and one of 200 B." }, terms.ack, terms.rwnd, terms.cwnd],
  "tcp-lab": Object.values(terms),
  // The network playground sends one segment at a time, so no duplicate ACKs appear there.
  "missing-segment": [playground.seq, playground.ack, playground.retransmission, terms.timeout],
};
