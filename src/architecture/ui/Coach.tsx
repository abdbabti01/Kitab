import { useEffect, useId, useRef, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { askArchitectureCoach, type TutorReply } from "../../app/api.ts";
import { buildCoachContext, fallbackCoach, type CoachRequest } from "../coach.ts";
import type { Challenge, Evaluation } from "../challenges.ts";
import type { Design } from "../model.ts";

/** What the coach is told about the last check: booleans per check and the normal run's numbers, nothing else. */
function requestFor(challenge: Challenge, design: Design, result: Evaluation | null, hintsSeen: number, question: string): CoachRequest {
  const summary = result?.outcomes.normal?.[0]?.summary;
  let busiest: { node: string; utilisation: number } | null = null;
  for (const [node, n] of Object.entries(summary?.nodes ?? {})) {
    const peak = n.utilisation ? Math.max(...n.utilisation) : null;
    if (peak !== null && (!busiest || peak > busiest.utilisation)) busiest = { node, utilisation: Math.min(1, peak) };
  }
  return {
    challengeId: challenge.id,
    challengeVersion: challenge.version,
    design,
    checks: result ? result.checks.map((c) => ({ id: c.id, passed: c.passed })) : null,
    run: summary ? { successRate: summary.successRate, p95: summary.p95, failed: summary.failed, retries: summary.retries, timeouts: summary.timeouts, busiest } : null,
    hintsSeen,
    question,
  };
}

/** Ask about your design. Optional: the checks, not the coach, decide whether a design passes. */
export function Coach({ challenge, design, result, hintsSeen }: { challenge: Challenge; design: Design; result: Evaluation | null; hintsSeen: number }) {
  const id = useId();
  const [question, setQuestion] = useState("");
  const [reply, setReply] = useState<(TutorReply & { offline?: boolean }) | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRequest = useRef<AbortController | null>(null);
  // A reply to an older version of the design is dropped.
  useEffect(() => () => pendingRequest.current?.abort(), [design]);

  const ask = async () => {
    const text = question.trim();
    if (text.length < 3) return;
    pendingRequest.current?.abort();
    const controller = new AbortController();
    pendingRequest.current = controller;
    setPending(true);
    const request = requestFor(challenge, design, result, hintsSeen, text);
    try {
      const answer = await askArchitectureCoach(request, controller.signal);
      if (!controller.signal.aborted) setReply(answer);
    } catch {
      if (!controller.signal.aborted) setReply({ response: fallbackCoach(buildCoachContext(request)), source: "fallback", reason: "OFFLINE", offline: true });
    } finally {
      if (pendingRequest.current === controller) setPending(false);
    }
  };

  return (
    <section className="coach" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}><MessagesSquare aria-hidden="true" /> Ask the coach</h2>
      <p className="muted">Ask about your design's trade-offs. The coach sees your design and your last check's results, and must use only their numbers. It never decides whether you pass.</p>
      <form onSubmit={(event) => (event.preventDefault(), ask())}>
        <label htmlFor={`${id}-q`}>Your question</label>
        <textarea id={`${id}-q`} value={question} maxLength={300} rows={2} onChange={(event) => setQuestion(event.target.value)} placeholder="Why is my database still the bottleneck?" />
        <button type="submit" className="button" disabled={pending || question.trim().length < 3}>{pending ? "Thinking…" : "Ask"}</button>
      </form>
      {reply && (
        <div className="coach-reply" role="status">
          <p>{reply.response.explanation}</p>
          <small>{reply.source === "ai" ? "AI answer, checked against your design's facts. It can still be wrong: trust the simulator's runs." : "Kitab's reviewed hint (the AI coach is unavailable right now)."}</small>
        </div>
      )}
    </section>
  );
}
