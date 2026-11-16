// Lab: an order spans three services (reserve stock, charge the card, book a courier). No transaction covers them:
// a saga runs each step as its own local transaction and, if a later step fails, runs compensations for the earlier
// ones. Compensations must be retried until they succeed, progress must survive a crash, and steps re-sent after a
// crash must be idempotent.
// Modelled: one order; an orchestrator; three services with fixed latencies; scenario failures that are permanent
// (a declined card, no courier), transient (a refund that times out twice) or a crash of the orchestrator.
import { Timeline, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { compensation: "none" | "once" | "retry"; state: "memory" | "log" | "events"; stepKeys: boolean };

const NET = 20;
const WORK = 50;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const tl = new Timeline();
  const ref = "order-7";
  const ledger = { reserved: 0, charges: 0, refunds: 0, shipped: 0 };
  const seenKeys = new Map<string, boolean>();
  let refundFailures = 0;
  let crashed = false;
  let up = true;
  let finished = false;
  type Step = "reserve" | "charge" | "ship";
  // What a durable log records: each step requested, and each result.
  const log: { step: Step | "release" | "refund"; status: "requested" | "done" | "failed" }[] = [];
  const durable = c.state !== "memory";
  const record = (step: (typeof log)[number]["step"], status: (typeof log)[number]["status"]) => {
    log.push({ step, status });
    if (durable) tl.log({ actor: "orchestrator", kind: "note", text: c.state === "log" ? `Saga log: ${step} ${status}.` : `Event stored via outbox: ${step} ${status}.`, tone: "info", ref });
  };

  const service = { reserve: "inventory", charge: "payments", ship: "shipping", release: "inventory", refund: "payments" } as const;

  /** Calls a service; `outcome` decides at the service. */
  function call(step: keyof typeof service, then: (ok: boolean) => void) {
    const key = `order-7:${step}`;
    const to = service[step];
    const text = { reserve: "Reserve 1 lamp", charge: "Charge $80", ship: "Book a courier", release: "Release the lamp (compensation)", refund: "Refund $80 (compensation)" }[step];
    tl.log({ actor: "orchestrator", kind: "message", to, text: `${text}${c.stepKeys ? `, key ${key}` : ""}`, tone: step === "release" || step === "refund" ? "warn" : "info", ref });
    tl.after(NET, () => {
      if (c.stepKeys && seenKeys.has(key)) {
        tl.log({ actor: to, kind: "note", text: `Key ${key} already handled: returns the original result, changes nothing.`, tone: "good", ref });
        const ok = seenKeys.get(key)!;
        return tl.after(NET, () => up && then(ok));
      }
      tl.after(WORK, () => {
        let ok = true;
        if (step === "reserve") ledger.reserved++;
        if (step === "charge") {
          if (p.declined) ok = false;
          else ledger.charges++;
        }
        if (step === "ship" && p.noCourier) ok = false;
        if (step === "ship" && ok) ledger.shipped++;
        if (step === "release") ledger.reserved--;
        if (step === "refund") {
          if (refundFailures < (p.refundGlitches ?? 0)) {
            refundFailures++;
            tl.log({ actor: to, kind: "note", text: "The refund times out inside the payments service (a transient fault). Nothing changed.", tone: "bad", ref });
            return tl.after(NET, () => up && then(false));
          }
          ledger.refunds++;
        }
        if (c.stepKeys) seenKeys.set(key, ok);
        const outcome = !ok ? (step === "charge" ? "The card is declined." : "No courier is available for this address.") : { reserve: "Lamp reserved.", charge: ledger.charges > 1 ? "Card charged $80 again: a second charge." : "Card charged $80.", ship: "Courier booked.", release: "Lamp released.", refund: "Refunded $80." }[step];
        tl.log({ actor: to, kind: "effect", text: outcome, tone: !ok ? "bad" : step === "charge" && ledger.charges > 1 ? "bad" : "good", ref, data: step === "charge" && ok ? { charges: 1 } : step === "refund" ? { refunds: 1 } : {} });
        if (p.crashAfterCharge && step === "charge" && !crashed) {
          crashed = true;
          up = false;
          tl.after(NET, () => {
            tl.log({ actor: "orchestrator", kind: "fault", text: "The orchestrator crashes just before it records the charge's result. It restarts 1 s later.", tone: "bad", ref });
            tl.after(1000, restart);
          });
          return;
        }
        tl.after(NET, () => up && then(ok));
      });
    });
  }

  function finish(outcome: "completed" | "cancelled" | "stuck") {
    if (finished) return;
    finished = true;
    tl.log({ actor: "orchestrator", kind: "note", text: outcome === "completed" ? "Order 7 is complete." : outcome === "cancelled" ? "Order 7 is cancelled; everything done has been undone." : "The saga gave up on a compensation: order 7 is stuck half-done and needs a human.", tone: outcome === "stuck" ? "bad" : outcome === "completed" ? "good" : "info", ref, data: { [outcome]: 1 } });
  }

  function compensate(steps: ("release" | "refund")[]) {
    const step = steps[0];
    if (!step) return finish("cancelled");
    if (c.compensation === "none") return finish("stuck");
    let attempt = 0;
    const tryIt = () => {
      attempt++;
      record(step, "requested");
      call(step, (ok) => {
        record(step, ok ? "done" : "failed");
        if (ok) return compensate(steps.slice(1));
        if (c.compensation === "retry") {
          const wait = 200 * 2 ** (attempt - 1);
          tl.log({ actor: "orchestrator", kind: "note", text: `The ${step} failed; retrying in ${wait} ms. Compensations must eventually succeed.`, tone: "warn", ref });
          tl.after(wait, tryIt);
        } else finish("stuck");
      });
    };
    tryIt();
  }

  const forward: Step[] = ["reserve", "charge", "ship"];
  const undo: Record<Step, ("release" | "refund")[]> = { reserve: [], charge: ["release"], ship: ["refund", "release"] };
  function run(from: number) {
    const step = forward[from];
    if (!step) return finish("completed");
    record(step, "requested");
    call(step, (ok) => {
      record(step, ok ? "done" : "failed");
      if (ok) return run(from + 1);
      if (c.compensation === "none") {
        tl.log({ actor: "orchestrator", kind: "note", text: `The ${step} failed. No compensations are defined: earlier steps stay done.`, tone: "bad", ref });
        return finish("stuck");
      }
      compensate(undo[step]);
    });
  }

  function restart() {
    up = true;
    if (!durable) {
      tl.log({ actor: "orchestrator", kind: "note", text: "Back up, with no memory of order 7: its saga is forgotten.", tone: "bad", ref });
      return;
    }
    // Resume from the log: the last step requested without a result is sent again.
    const last = log.at(-1)!;
    tl.log({ actor: "orchestrator", kind: "note", text: `Back up. The ${c.state === "log" ? "saga log" : "stored events"} show ${last.step} ${last.status} with no result: it sends ${last.step} again.`, tone: "warn", ref });
    run(forward.indexOf(last.step as Step));
  }

  tl.at(0, () => {
    tl.log({ actor: "orchestrator", kind: "note", text: "Order 7 (one lamp, $80) starts its saga.", tone: "info", ref });
    run(0);
  });
  tl.drain(30_000);
  if (!finished) tl.log({ actor: "orchestrator", kind: "note", text: "Order 7 never reached a final state.", tone: "bad", ref, data: { stuck: 1 } });
  const consistent = (ledger.reserved === 1 && ledger.charges - ledger.refunds === 1 && ledger.shipped === 1) || (ledger.reserved === 0 && ledger.charges - ledger.refunds === 0 && ledger.shipped === 0);
  tl.log({ actor: "orchestrator", kind: "note", text: `Final state: ${ledger.reserved ? "lamp reserved" : "no lamp held"}, net charge $${(ledger.charges - ledger.refunds) * 80}, ${ledger.shipped ? "courier booked" : "no courier"}.${consistent ? "" : " That's a half-finished order."}`, tone: consistent ? "info" : "bad", ref, data: { reservedEnd: ledger.reserved, netCharges: ledger.charges - ledger.refunds, shippedEnd: ledger.shipped, inconsistent: consistent ? 0 : 1 } });
  return tl.events;
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["charges", "refunds", "completed", "cancelled", "stuck", "inconsistent", "netCharges", "reservedEnd", "shippedEnd"]);
  return { ...f, netDollars: f.netCharges * 80 };
}

const scenarios: LabScenario[] = [
  { id: "declined", title: "The card is declined", description: "The lamp is reserved, then the payment service declines the card.", seed: 1, params: { declined: 1 } },
  { id: "no-courier", title: "No courier", description: "Stock is reserved and the card charged, then shipping finds no courier for the address.", seed: 1, params: { noCourier: 1 } },
  { id: "refund-glitch", title: "The refund hiccups", description: "No courier, as before, and the first two refund attempts time out inside the payment service.", seed: 1, params: { noCourier: 1, refundGlitches: 2 } },
  { id: "crash", title: "The orchestrator crashes", description: "The orchestrator crashes after the card is charged, before it records the result, and restarts 1 s later.", seed: 1, params: { crashAfterCharge: 1 } },
];

const checksFor = (s: LabScenario) => [
  { id: `${s.id}:consistent`, scenario: s.id, requirement: "The order ends all done or all undone (no half-finished order)", passed: (f: Facts) => f.inconsistent === 0, observed: (f: Facts) => (f.inconsistent ? `ended half-done: ${f.reservedEnd ? "lamp held" : "no lamp"}, net charge $${f.netCharges * 80}, ${f.shippedEnd ? "courier booked" : "no courier"}` : f.completed ? "completed" : "cleanly cancelled") },
  { id: `${s.id}:charged-once`, scenario: s.id, requirement: "The card is never charged more than once", passed: (f: Facts) => f.charges <= 1, observed: (f: Facts) => `${f.charges} ${f.charges === 1 ? "charge" : "charges"}` },
  { id: `${s.id}:final`, scenario: s.id, requirement: "The order reaches a final state without a human", passed: (f: Facts) => f.completed + f.cancelled === 1 && f.stuck === 0, observed: (f: Facts) => (f.completed ? "completed" : f.cancelled ? "cancelled" : "stuck") },
];

export const sagaLab: Lab = {
  id: "saga",
  version: "1",
  title: "Design a resilient order-processing system",
  summary: "An order reserves stock, charges the card and books a courier: three services, no shared transaction. Make every order end all done or all undone, through declines, failed refunds and a crash.",
  story: [
    "Inventory, payments and shipping each own their database. An order needs a step in each, in order. If shipping fails after the card was charged, nothing rolls the charge back automatically: there's no transaction across services.",
    "A saga makes the undo explicit: each step has a compensation (release the stock, refund the card), run in reverse order when a later step fails. Then the hard parts appear: a compensation can fail too, the coordinator can crash halfway, and a step re-sent after a crash must not happen twice.",
  ],
  unit: "data-across-services",
  view: { kind: "sequence", lanes: [{ id: "orchestrator", label: "Order orchestrator" }, { id: "inventory", label: "Inventory" }, { id: "payments", label: "Payments" }, { id: "shipping", label: "Shipping" }] },
  controls: [
    { id: "compensation", type: "select", label: "When a step fails", help: "What happens to the steps already done.", options: [
      { value: "none", label: "Stop (no compensations)" },
      { value: "once", label: "Run compensations once" },
      { value: "retry", label: "Run compensations, retrying each until it succeeds" },
    ] },
    { id: "state", type: "select", label: "Where the saga's progress lives", help: "What survives if the coordinator crashes.", options: [
      { value: "memory", label: "In the orchestrator's memory" },
      { value: "log", label: "A durable saga log (orchestration)" },
      { value: "events", label: "Events stored through each service's outbox (choreography)" },
    ] },
    { id: "stepKeys", type: "toggle", label: "Idempotency key on every step", help: "Each call carries order id + step; services return the original result for a repeat." },
  ],
  starter: { compensation: "none", state: "memory", stepKeys: false },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "charges", label: "Charges" },
    { key: "refunds", label: "Refunds" },
    { key: "netCharges", label: "Net charges" },
    { key: "inconsistent", label: "Half-finished", bad: "above-zero" },
    { key: "stuck", label: "Stuck", bad: "above-zero" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "dollars",
    answer: "netDollars",
    variants: [
      { id: "no-comp", question: "Shipping finds no courier after the card was charged $80. The saga has no compensations. What is the customer's net charge, in dollars?", scenario: scenarios[1] },
      { id: "once-glitch", question: "Compensations run once. Shipping fails, and the first refund attempt times out (twice, in fact). What is the customer's net charge, in dollars?", scenario: scenarios[2], config: { compensation: "once" } },
      { id: "crash-nokey", question: "Progress is in a durable log, but steps carry no idempotency key. The orchestrator crashes after the charge, before recording it, then resumes. What is the customer's net charge, in dollars?", scenario: scenarios[3], config: { compensation: "retry", state: "log" } },
    ],
  },
  questions: [
    {
      id: "acid",
      prompt: "Does a saga give you an ACID transaction across the three services?",
      options: [
        { text: "Yes: compensations make it atomic and isolated.", why: "Compensations restore consistency eventually, but there's no isolation." },
        { text: "No: it is eventually all-or-nothing, but in between other requests can see the half-done state (a reserved lamp, a charge not yet refunded).", correct: true, why: "Right. Sagas trade isolation for availability; designs add countermeasures such as a PENDING status (a semantic lock) that others respect." },
        { text: "Only with choreography.", why: "Choreography or orchestration, a saga has no global isolation." },
      ],
    },
    {
      id: "retry-comp",
      prompt: "Why must compensations be retried until they succeed (and be idempotent)?",
      options: [
        { text: "A compensation that gives up leaves the system half-done for good; retries mean repeats, so a repeated refund must not refund twice.", correct: true, why: "Right. A compensation is a promise; it has to be kept, safely." },
        { text: "To make the saga faster.", why: "Retries make it slower; they make it correct." },
        { text: "They needn't be: a failed compensation can be ignored.", why: "Then the customer stays charged for an order that was cancelled." },
      ],
    },
    {
      id: "resume",
      prompt: "After a crash, the orchestrator resumes and re-sends the step it had no result for. What makes that safe?",
      options: [
        { text: "Nothing needed: the crash means the step didn't happen.", why: "The step may have completed just before the crash; that's the ambiguous case." },
        { text: "Idempotency keys on steps: if the step already happened, the service returns its original result.", correct: true, why: "Right. Resuming from a log is at-least-once; idempotent steps make it effectively once." },
        { text: "Waiting longer before resuming.", why: "Waiting doesn't tell you whether the step happened." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    const parts: string[] = [];
    if (f.charges > 1) parts.push(`The card was charged ${f.charges} times: after the crash, the resumed saga sent the charge again and the payment service treated it as new.`);
    if (f.inconsistent) parts.push(`The order ended half-done: ${f.reservedEnd ? "the lamp stayed reserved" : "no lamp held"}, a net charge of $${f.netCharges * 80}, ${f.shippedEnd ? "a courier booked" : "no courier"}.${c.state === "memory" && f.stuck ? " The crash erased the saga's progress, so nothing finished or undid it." : c.compensation === "once" ? " A compensation failed once and was never tried again." : c.compensation === "none" ? " Nothing undid the steps already done." : ""}`);
    else if (f.stuck) parts.push("The order never reached a final state.");
    if (!parts.length) parts.push(f.completed ? `Completed, with ${f.charges} charge.` : `Cancelled cleanly: ${f.refunds ? `refunded after ${f.charges} charge, ` : ""}stock released, nothing left half-done.`);
    return parts.join(" ");
  },
  hints: [
    "When shipping fails, what has already happened in the other services, and who undoes it?",
    "An undo can fail too. Then what?",
    "If the coordinator dies mid-saga, where is the record of what's done? And if it re-sends a step that had actually completed?",
  ],
  assumptions: [
    "One order. Calls take 20 ms each way and 50 ms of work. Declines and “no courier” are permanent; the refund glitch fails the first two attempts only.",
    "A failed step leaves nothing behind in its own service (it's a local transaction). Compensations run in reverse order: refund, then release.",
    "Retried compensations wait 200 ms, then double. A durable log or stored events record each step before it's sent and after its result; a restarted coordinator re-sends the last step that has no result.",
    "Both durable options behave alike here; they differ in where the flow is defined (one orchestrator, or each service reacting to events), which the lesson covers.",
  ],
  notModelled: [
    "Other requests seeing the intermediate state (no isolation), and countermeasures such as a PENDING status.",
    "Steps that can't be compensated (an email already sent), and choosing the order of steps around them.",
    "Timeouts on forward steps, and services that are down rather than refusing.",
  ],
};

