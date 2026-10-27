import { parseLesson, type Lesson } from "./schema.ts";

/**
 * Reviewed beginner journeys. Every value shown comes from the engine through {fact:…}, {param.…} or
 * {outcome.…}; the prose explains purpose and cause. validateLessonContent() checks every reachable scenario.
 */
const reviewed = { status: "reviewed" as const, note: "Values computed by Kitab's engines; explanations reviewed against the model." };

const hello = {
  schemaVersion: 1,
  id: "hello-tcp",
  version: "1.0.0",
  title: "Follow HELLO",
  question: "How does HELLO travel from one program to another?",
  summary: "Follow one chat message from your keyboard to another computer: bytes, a TCP connection, IP packets, link frames, two routers and back up again.",
  topic: "Networks",
  review: reviewed,
  engine: { id: "message-journey", version: "1.0.0" },
  scenario: { message: "HELLO", lose: "none" },
  scope: [
    "Two chat programs on two computers, connected through two routers and three cables.",
    "One short message. You can change it; the engine recomputes every value.",
    "Kept simple on purpose: every link is Ethernet, devices already know their neighbours' link addresses, there is no encryption, and sequence numbers start at readable values.",
  ],
  prerequisites: "None. Every term is introduced when it is first needed.",
  levels: [
    { id: "application", name: "Application", short: "The program and its data", intro: "Where programs live. Program A turns your text into bytes; program B turns bytes back into text. Programs don't choose routes or touch cables: they hand bytes to TCP and read bytes from it." },
    { id: "transport", name: "Transport", short: "TCP's connection and reliable byte stream", intro: "TCP runs only on the two end computers. It sets up a connection, numbers every byte, confirms what arrived with acknowledgments and resends what was lost, so the programs see an exact, ordered stream of bytes." },
    { id: "network", name: "Network", short: "IP addressing and forwarding", intro: "IP gives each computer an address and moves packets toward their destination, one router at a time. Routers work at this level: they read the destination address, pick the next hop and lower the TTL. They never read TCP's numbers." },
    { id: "link", name: "Link", short: "Communication over the current local connection", intro: "The link layer carries a frame across one cable between two neighbours, using local (MAC) addresses and a checksum. At every router the old frame is removed and a new one is built for the next cable." },
  ],
  glossary: [
    { id: "program", term: "Program", definition: "Software running on a computer. Here, two chat programs: A sends, B receives." },
    { id: "message", term: "Message", definition: "The text one program wants the other to show: in this example, what you typed into program A." },
    { id: "network", term: "Network", definition: "Devices joined by cables (or radio) so they can pass data along. Data may cross several devices before it arrives." },
    { id: "encoding", term: "Encoding", definition: "An agreed rule for turning characters into numbers and back. Sender and receiver must use the same one." },
    { id: "utf8", term: "UTF-8", definition: "The most common text encoding. Basic English letters and digits take one byte each; other characters take two, three or four bytes." },
    { id: "bit", term: "Bit", definition: "The smallest piece of data: a 0 or a 1." },
    { id: "byte", term: "Byte", definition: "Eight bits. A byte holds a number from 0 to 255." },
    { id: "tcp", term: "TCP", definition: "Transmission Control Protocol: software in each end computer that delivers a program's bytes completely, in order, and resends what goes missing." },
    { id: "port", term: "Port", definition: "A number that tells TCP which program on a computer a piece of data is for." },
    { id: "connection", term: "Connection", definition: "The shared state two TCPs keep about one conversation: starting numbers, what has been sent and what has arrived." },
    { id: "syn", term: "SYN", definition: "“Synchronize”: a TCP flag that opens a connection and announces a starting sequence number." },
    { id: "sequence-number", term: "Sequence number", definition: "TCP's number for a byte's position in the stream. The receiver uses it to put bytes in order and to notice gaps." },
    { id: "ack", term: "ACK", definition: "Acknowledgment: the number of the next byte the receiver expects. It confirms every byte before it." },
    { id: "segment", term: "Segment", definition: "A TCP header plus a piece of the byte stream. TCP's unit of sending." },
    { id: "header", term: "Header", definition: "Labels a level adds in front of the data so the matching level on the other side knows what to do with it." },
    { id: "ip-address", term: "IP address", definition: "A computer's address on the network, used to deliver packets across many networks." },
    { id: "packet", term: "Packet", definition: "An IP header plus what it carries (here, a TCP segment). Routers forward packets." },
    { id: "router", term: "Router", definition: "A device that connects networks and forwards packets toward their destination address." },
    { id: "forwarding", term: "Forwarding", definition: "A router's job: look up the destination address in its table and send the packet out toward the next hop." },
    { id: "ttl", term: "TTL", definition: "Time to live: a counter in the IP header that each router lowers by one. A packet reaching 0 is discarded, so mistakes cannot loop forever." },
    { id: "mac", term: "Link address (MAC)", definition: "The address of a network interface on one local link. It only has meaning on that link." },
    { id: "frame", term: "Frame", definition: "A link header, the packet, and a checksum trailer: what actually crosses one cable." },
    { id: "checksum", term: "Checksum", definition: "A value computed from the frame's bits. If the receiver computes a different value, the frame was damaged." },
    { id: "in-order", term: "In-order delivery", definition: "TCP hands bytes to the program in sequence-number order, holding back any that arrive early." },
    { id: "retransmission", term: "Retransmission", definition: "Sending the same bytes again, with the same sequence numbers, when no acknowledgment arrives in time." },
  ],
  kinds: {
    program: { represents: "A chat program: the software you use. It only ever sees text and bytes.", matters: "It is where the message starts and where it must arrive unchanged." },
    character: { represents: "One character of your message, as a Unicode code point.", matters: "Each character must become one or more bytes before it can be sent." },
    byte: { represents: "One byte of the encoded message: eight bits, a number from 0 to 255.", matters: "Bytes are what TCP numbers, sends and confirms. TCP never sees letters." },
    endpoint: { represents: "The TCP software on one of the two end computers.", matters: "Reliability lives here: numbering, acknowledging and resending happen only at the two ends." },
    router: { represents: "A router between networks. It has interfaces, addresses and a forwarding table, but no chat program and no TCP connection.", matters: "It decides the next hop from the destination IP address alone." },
    link: { represents: "One cable between two neighbouring devices.", matters: "A frame crosses exactly one link; each link needs its own frame." },
    "message-bytes": { represents: "The message as bytes, handed from program A to TCP.", matters: "From here on, every level sees only bytes." },
    segment: { represents: "A TCP segment: TCP header plus data (or no data, for SYN and ACK).", matters: "Its ports and sequence number let the other TCP deliver bytes to the right program, in order." },
    packet: { represents: "An IP packet: IP header plus the TCP segment inside.", matters: "Its destination address is what every router reads." },
    frame: { represents: "A link frame: link header, the IP packet, padding if needed, and a checksum.", matters: "It gets the packet across the current cable, and only that cable." },
    "tcp-header": { represents: "The labels TCP adds: ports, sequence number, acknowledgment number and flags.", matters: "Only the two end TCPs read it." },
    "ip-header": { represents: "The labels IP adds: source and destination addresses, TTL and which protocol is inside.", matters: "Routers read the destination and lower the TTL; the addresses stay the same end to end." },
    "link-header": { represents: "The labels the link layer adds: the link addresses of this hop's sender and receiver.", matters: "They change at every router, because each cable has different neighbours." },
  },
  controls: [
    { key: "message", label: "Your message", control: "text", maxLength: 16, help: "Type your own message. Characters outside basic English, such as é or 👋, take more than one byte." },
  ],
  chapters: [
    {
      id: "your-message",
      title: "Your message",
      goal: "Meet the two programs and the one message we will follow from start to finish.",
      steps: [
        { id: "meet-programs", frame: "programs-ready", level: "application", focus: ["program-a", "program-b"], terms: ["program", "message"], what: "Chat program A on Computer A shows your message: “{fact:message-text}”. Chat program B runs on Computer B and is waiting for messages.", why: "We will follow this one message the whole way, so at every step you can see what is moving and who is moving it.", kitab: "Hi, I'm Kitab. We'll follow “{fact:message-text}” all the way to program B. Press Next when you're ready." },
        { id: "the-problem", title: "The problem: no direct wire", frame: "programs-ready", level: "application", actor: "The network between them", focus: ["r1", "r2"], terms: ["network"], what: "The two computers are not wired to each other. Between them are two routers, R1 and R2, and three cables.", why: "This is the problem to solve: get exactly “{fact:message-text}” across several devices, in order, even if something goes wrong on the way." },
      ],
    },
    {
      id: "letters-to-bytes",
      title: "From letters to bytes",
      goal: "Cables carry signals and computers store numbers, so the letters must become numbers first.",
      steps: [
        { id: "letters-are-not-sent", title: "Letters can’t travel as letters", frame: "programs-ready", level: "application", actor: "Program A", focus: ["char-0"], terms: ["encoding"], what: "A computer cannot send the shape of a letter. It can only store and send numbers.", why: "So program A needs a rule that turns each character into numbers, and program B must use the same rule to turn them back." },
        { id: "utf8", frame: "text-encoded", level: "application", focus: ["program-a"], terms: ["utf8", "byte"], what: "Program A uses UTF-8. “{fact:message-text}” has {fact:message-characters} characters and becomes {fact:message-bytes} bytes: {fact:message-byte-values}.", why: "A byte is the unit computers store and send. From now on, the message is these bytes." },
        { id: "bits", title: "Eight bits make a byte", frame: "text-encoded", level: "application", actor: "Program A", focus: ["byte-0"], terms: ["bit"], what: "Each byte is eight bits, each a 0 or a 1. The first byte, {fact:byte-0}, is {fact:byte-0-bits} in bits ({fact:byte-0-hex} in hexadecimal).", why: "Bits are what the cable will actually carry. Eight bits give 256 possible values, 0 to 255.", kitab: "Select any character or byte to see its exact value and bits." },
        { id: "not-one-byte-each", title: "Not always one byte per character", frame: "text-encoded", level: "application", actor: "Program A", focus: ["char-0"], what: "Here the first character, “{fact:char-0}”, takes {fact:char-0-byte-count} byte(s). Basic English letters take one byte each in UTF-8, but other characters take two, three or four.", why: "So bytes and characters are not always the same count. TCP counts bytes, never characters. Try typing é or 👋 in the message box." },
      ],
    },
    {
      id: "tcp-connection",
      title: "A TCP connection",
      goal: "Before any message bytes are sent, the two TCPs agree on starting numbers so that missing or out-of-order bytes can be noticed.",
      steps: [
        { id: "why-tcp", title: "Why the programs need TCP", frame: "text-encoded", level: "transport", actor: "TCP on each computer", focus: ["endpoint-a", "endpoint-b"], terms: ["tcp"], what: "Each computer's operating system runs TCP. Program A will hand its bytes to TCP instead of putting them on the cable itself.", why: "The network can lose, damage or reorder data. TCP numbers every byte, confirms what arrived and resends what didn't, so program B gets exactly the bytes A sent, in order." },
        { id: "ports", title: "Ports: which program is it for?", frame: "text-encoded", level: "transport", actor: "B's TCP", focus: ["endpoint-b"], terms: ["port"], what: "B's TCP is listening on port {fact:b-port} for program B. A's TCP will use port {fact:a-port} for program A.", why: "A computer runs many programs at once. The port tells TCP which program a piece of data belongs to." },
        { id: "syn", frame: "syn-sent", focus: ["hdr-tcp", "endpoint-a"], terms: ["syn", "sequence-number", "connection"], what: "A's TCP sends a SYN from port {fact:tcp-src-port} to port {fact:tcp-dst-port} with sequence number {fact:tcp-seq}. A's state becomes {fact:a-state}.", why: "TCP numbers bytes. By announcing a starting number, A lets B notice later if any byte is missing or arrives twice." },
        { id: "syn-travels", frame: "syn-in-transit", focus: ["hdr-ip"], what: "The SYN travels inside an IP packet addressed to {fact:ip-dst}.", why: "Every TCP segment rides inside an IP packet. “Across the network” opens up this trip step by step." },
        { id: "syn-received", frame: "syn-received", focus: ["endpoint-b"], what: "B's TCP accepts the SYN. B's state: {fact:b-state}. B now expects A's next byte to be numbered {fact:b-rcv-nxt}.", why: "B has learned A's starting number, but A doesn't yet know that B heard it." },
        { id: "syn-ack", frame: "syn-ack-sent", focus: ["hdr-tcp"], terms: ["ack"], what: "B replies with SYN-ACK: acknowledgment {fact:tcp-ack} confirms A's SYN, and sequence number {fact:tcp-seq} is B's own starting number.", why: "One segment does two jobs: it confirms A's number and announces B's." },
        { id: "syn-ack-travels", frame: "syn-ack-in-transit", focus: ["hdr-ip"], what: "The SYN-ACK travels back in an IP packet addressed to {fact:ip-dst}.", why: "Replies need their own packets; the network carries data in both directions." },
        { id: "a-established", frame: "syn-ack-received", focus: ["endpoint-a"], what: "A's TCP sees its SYN confirmed. A's state: {fact:a-state}. A expects B's bytes to start at {fact:a-rcv-nxt}.", why: "A now knows both starting numbers." },
        { id: "final-ack", frame: "ack-sent", focus: ["hdr-tcp"], what: "A sends ACK {fact:tcp-ack}, confirming B's SYN.", why: "Three messages are enough for both sides to announce a starting number and hear it confirmed." },
        { id: "final-ack-travels", frame: "ack-in-transit", focus: ["hdr-ip"], what: "The ACK travels to {fact:ip-dst}.", why: "B is still waiting for this confirmation." },
        { id: "established", frame: "connection-established", focus: ["endpoint-a", "endpoint-b"], what: "B's state: {fact:b-state}. Both sides are connected and know each other's numbers.", why: "Now the message bytes can be sent, and every one of them will be numbered." },
      ],
    },
    {
      id: "sending",
      title: "Sending the data",
      goal: "On Computer A, each level adds what it needs, from the program down to the cable.",
      steps: [
        { id: "write", frame: "program-writes", focus: ["unit-data", "program-a"], what: "Program A hands its {fact:program-a-written} bytes to TCP.", why: "From here on, no level sees letters. TCP, IP and the link carry bytes." },
        { id: "segment", frame: "segment-built", focus: ["hdr-tcp"], terms: ["segment", "header"], what: "TCP adds its header ({fact:tcp-header-bytes}): ports {fact:tcp-src-port} → {fact:tcp-dst-port}, sequence number {fact:tcp-seq}. All {outcome.bytes} bytes fit in one segment of {fact:unit-size}.", why: "Ports name the programs; the sequence number says where these bytes go in the stream. TCP only splits data that is larger than one segment can carry." },
        { id: "copy-and-timer", title: "TCP keeps a copy, just in case", frame: "segment-built", focus: ["endpoint-a"], terms: ["retransmission"], what: "TCP keeps a copy of {fact:a-unacked} and starts a retransmission timer ({fact:a-timer}).", why: "Until B confirms these bytes, A must be able to send them again." },
        { id: "packet", frame: "packet-built", focus: ["hdr-ip"], terms: ["ip-address", "packet", "ttl"], what: "IP adds its header: from {fact:ip-src} to {fact:ip-dst}, TTL {fact:ip-ttl}. The packet is {fact:ip-length}.", why: "Routers need a destination address to choose a direction. The TTL counts down at each router so that a routing mistake can't loop forever." },
        { id: "first-hop", title: "A’s first decision: send it to R1", frame: "packet-built", focus: ["endpoint-a"], terms: ["router"], what: "B isn't on A's local network. A's best matching route is {fact:decision-matched}, so the next hop is {fact:decision-next-hop}.", why: "A can only reach its neighbours directly. Anything farther goes to a router first." },
        { id: "frame", frame: "frame-built", focus: ["hdr-link"], terms: ["mac", "frame"], what: "The link layer wraps the packet in a frame addressed to R1's interface, {fact:link-dst}. With {fact:link-padding} padding byte(s), the frame is {fact:unit-size}.", why: "A cable only connects neighbours, so the frame names the next device, while the IP address inside still names B. Ethernet frames have a minimum size, which is why short packets get padding." },
        { id: "wire-1", frame: "on-link-1", focus: ["link-1"], what: "The frame crosses link 1 as a stream of bits.", why: "This is the only moment something physically moves: signals on a cable." },
      ],
    },
    {
      id: "across-the-network",
      title: "Across the network",
      goal: "Routers move the packet toward B using only the IP header. TCP stays at the two ends.",
      steps: [
        { id: "r1-receives", frame: "r1-receives", focus: ["r1", "hdr-link"], terms: ["checksum"], what: "R1's link layer checks the frame: it is addressed to R1's interface ({fact:link-dst}) and the checksum {fact:link-checksum}. It removes the frame.", why: "A frame's job ends at the end of its cable." },
        { id: "r1-forwards", frame: "r1-forwards", focus: ["r1", "hdr-ip"], terms: ["forwarding"], what: "R1 looks up {fact:decision-destination}. The best match is {fact:decision-matched}, so the next hop is {fact:decision-next-hop}. TTL is now {fact:ip-ttl}.", why: "Forwarding is IP's job at every router. R1 doesn't read the sequence number or the message, and keeps no copy." },
        { id: "r1-new-frame", frame: "r1-new-frame", focus: ["hdr-link"], what: "R1 builds a new frame for link 2, from {fact:link-src} to {fact:link-dst}. Inside, the IP addresses are unchanged: {fact:ip-src} → {fact:ip-dst}.", why: "Link addresses change at every hop; IP addresses stay the same from end to end." },
        { id: "wire-2", frame: "on-link-2", focus: ["link-2"], what: "The new frame crosses link 2.", why: "Each cable gets its own frame." },
        { id: "r2-receives", frame: "r2-receives", focus: ["r2"], what: "R2's link layer runs the same check (checksum {fact:link-checksum}) and removes the frame.", why: "Every router repeats the same small set of jobs." },
        { id: "r2-forwards", frame: "r2-forwards", focus: ["r2", "hdr-ip"], what: "R2's best match for {fact:decision-destination} is {fact:decision-matched}, a network R2 is directly connected to, so the next hop is B itself: {fact:decision-next-hop}. TTL is now {fact:ip-ttl}.", why: "The last router delivers directly instead of passing the packet to another router." },
        { id: "r2-new-frame", frame: "r2-new-frame", focus: ["hdr-link"], what: "R2 builds a frame for link 3, addressed to B's interface: {fact:link-dst}.", why: "Only now does the link address match B." },
        { id: "wire-3", frame: "on-link-3", focus: ["link-3"], what: "The frame crosses link 3 to Computer B.", why: "Last cable, last frame." },
      ],
    },
    {
      id: "receiving",
      title: "Receiving the message",
      goal: "Computer B unwraps the layers in reverse order, until program B reads the text.",
      steps: [
        { id: "b-link", frame: "b-link", focus: ["hdr-link", "endpoint-b"], what: "B's link layer sees its own address ({fact:link-dst}) and a checksum that {fact:link-checksum}. It removes the frame and any padding.", why: "The same checks as at each router, now for the final cable." },
        { id: "b-network", frame: "b-network", focus: ["hdr-ip"], what: "B's IP layer sees its own address, {fact:ip-dst}. The TTL arrived as {fact:ip-ttl}: lowered once by each router. IP removes its header and hands the segment to TCP.", why: "IP's job ends when the packet reaches the computer it was addressed to." },
        { id: "b-transport", frame: "b-transport", focus: ["hdr-tcp", "endpoint-b"], terms: ["in-order"], what: "B's TCP matches port {fact:tcp-dst-port} to program B's connection. Sequence {fact:tcp-seq} is exactly the byte B expected, so the bytes go into the receive buffer in order. B now expects {fact:b-rcv-nxt}.", why: "If a later byte had arrived first, TCP would hold it back until the gap was filled. Programs always get bytes in order." },
        { id: "b-ack", frame: "b-acknowledges", focus: ["hdr-tcp"], what: "B's TCP sends ACK {fact:tcp-ack}: “I have every byte before {fact:tcp-ack}.”", why: "Without this ACK, A couldn't know the bytes arrived and would keep resending them." },
        { id: "b-reads", frame: "program-reads", focus: ["program-b"], what: "Program B reads the bytes from TCP and decodes them with UTF-8: “{fact:program-b-read}”.", why: "Both programs used the same rule, so the same text comes out." },
        { id: "a-acked", frame: "ack-received", focus: ["endpoint-a"], what: "The ACK reaches A. Unacknowledged bytes: {fact:a-unacked}. Timer: {fact:a-timer}.", why: "A can now forget its copy: B confirmed every byte." },
        { id: "done", frame: "delivered", level: "application", focus: ["program-b"], what: "“{outcome.delivered}” arrived in order, exactly once. The data was sent {outcome.transmissions} time(s) and passed {outcome.routers} routers.", why: "Each level did one job: the programs chose the bytes, TCP numbered and confirmed them, IP chose the route, and each link carried a frame across one cable.", kitab: "That's the whole journey. Try the experiment: what happens if the data is damaged on the way?" },
      ],
    },
  ],
  experiments: [
    {
      id: "lose-data",
      title: "What if the data is lost?",
      question: "The frame carrying the message is damaged on link 2. Who notices, and who fixes it?",
      params: { lose: "data" },
      startFrame: "on-link-2",
      chapters: [
        {
          id: "x-loss",
          title: "Losing the data",
          goal: "Same message, same network. This time the frame carrying the data is damaged on link 2.",
          steps: [
            { id: "x-damage", frame: "on-link-2", focus: ["hdr-link"], what: "Noise flips some bits while the frame is on link 2. Its checksum now {fact:link-checksum}.", why: "Real cables and radio links are imperfect: frames are sometimes damaged or dropped." },
            { id: "x-discard", frame: "r2-discards", focus: ["r2"], terms: ["checksum"], what: "R2's link layer finds the bad checksum and throws the frame away.", why: "Damaged data can't be trusted. R2 doesn't tell A, and keeps no copy: noticing and fixing loss is TCP's job at the ends." },
            { id: "x-timer", frame: "timer-expires", focus: ["endpoint-a"], terms: ["retransmission"], what: "B received nothing, so B sent no ACK. A's timer ran out ({fact:a-timer}) with {fact:a-unacked} still unconfirmed.", why: "This is why TCP kept a copy: no ACK in time means “assume it was lost”." },
            { id: "x-resend", frame: "retransmit", focus: ["hdr-tcp"], what: "A's TCP sends the same bytes again with the same sequence number, {fact:tcp-seq}. Times sent: {fact:a-transmissions}.", why: "Keeping the same numbers lets B put the bytes in the right place and recognise them if they ever arrived twice." },
          ],
        },
        {
          id: "x-recover",
          title: "Recovery",
          goal: "The copy takes the normal path, and B can't tell anything went wrong.",
          steps: [
            { id: "x-path", each: { id: "retry-.*" }, what: "{frame.narration}", why: "Routers handle the copy like any other packet. They have no record of the lost one." },
            { id: "x-unwrap", each: { id: "b-link|b-network" }, what: "{frame.narration}", why: "Exactly the same unwrapping as in the normal run." },
            { id: "x-b-tcp", frame: "b-transport", focus: ["endpoint-b"], what: "B's TCP gets sequence {fact:tcp-seq}, the byte it expected, and buffers the bytes. B now expects {fact:b-rcv-nxt}.", why: "B never saw the damaged frame, so nothing is duplicated." },
            { id: "x-ack", frame: "b-acknowledges", focus: ["hdr-tcp"], what: "B sends ACK {fact:tcp-ack}.", why: "The same acknowledgment as in the normal run: B confirms bytes, not attempts." },
            { id: "x-read", frame: "program-reads", focus: ["program-b"], what: "Program B reads “{fact:program-b-read}”.", why: "The program never learns about the loss. Hiding it is exactly TCP's service." },
            { id: "x-acked", frame: "ack-received", focus: ["endpoint-a"], what: "A's timer stops ({fact:a-timer}) and its copy is released.", why: "The ACK ends A's responsibility for these bytes." },
            { id: "x-compare", frame: "delivered", level: "transport", actor: "Compare the two runs", focus: ["program-b"], what: "Program B got the same text and A received the same final ACK as in the normal run. Only the number of transmissions and the waiting time differ.", why: "Reliability came from the endpoints, through TCP's numbers, acknowledgments and timer. The network only forwarded, and dropped one damaged frame.", kitab: "Compare the two runs below: same result, one extra transmission." },
          ],
        },
      ],
      compare: [
        { outcome: "delivered", label: "Text program B read" },
        { outcome: "finalAck", label: "Final ACK at A" },
        { outcome: "segments", label: "TCP segments" },
        { outcome: "transmissions", label: "Times the data was sent" },
      ],
    },
  ],
  practice: [
    { missionId: "tcp-lost-segment", why: "Predict the acknowledgment when one of several segments is lost: a new scenario with 3,500 bytes." },
    { missionId: "tcp-send-window", why: "Predict how many segments can be in flight before an ACK returns." },
  ],
  sources: [
    { id: "utf8", text: "UTF-8 encodes each Unicode character as one to four bytes. Characters in the ASCII range, such as basic English letters and digits, take one byte with the same value as in ASCII." },
    { id: "tcp-service", text: "TCP runs on the two end computers. It numbers every byte with sequence numbers, acknowledges what arrived with cumulative ACKs naming the next expected byte, and retransmits unacknowledged bytes after a timeout." },
    { id: "handshake", text: "A TCP connection opens with three segments: SYN (announces the client's starting sequence number), SYN-ACK (confirms it and announces the server's), and ACK (confirms the server's)." },
    { id: "ip-forwarding", text: "Routers forward IP packets by matching the destination address against a forwarding table, choosing the longest matching prefix, and lower the TTL by one. They do not run the endpoints' TCP and do not retransmit." },
    { id: "link-frames", text: "A link-layer frame carries a packet across one link. At every router the frame is removed and a new one is built for the next link; the IP addresses inside stay the same. Ethernet pads payloads shorter than 46 bytes." },
    { id: "hello-scope", text: "Kitab's example uses Ethernet on every link, already-known neighbour link addresses, no TCP or IP options, readable starting sequence numbers and timeout-based recovery." },
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

export const lessons: Lesson[] = [hello, arrayInsert].map((item) => parseLesson(item));

export function findLesson(id: string) {
  return lessons.find((lesson) => lesson.id === id);
}

/** Lessons that teach the fundamentals before a mission practises them. */
export function lessonsForMission(missionId: string) {
  return lessons.filter((lesson) => lesson.practice.some((item) => item.missionId === missionId));
}
