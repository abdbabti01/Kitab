import { useState, type FormEvent } from "react";
import { sendFeedback, type FeedbackTarget } from "../app/api.ts";

/** Version- and frame-specific feedback. The target is captured when the form is submitted. */
export function FeedbackForm({ target, frameTitle }: { target: FeedbackTarget; frameTitle: string }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!rating) return;
    setStatus("sending");
    try {
      await sendFeedback(target, rating, comment.trim());
      setStatus("sent");
      setMessage("Thanks — your feedback is linked to this exact step and version.");
      setComment("");
      setRating(0);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? `${error.message} Your note was not sent.` : "Your note was not sent.");
    }
  }

  return (
    <details className="feedback">
      <summary>Feedback on this step</summary>
      <form onSubmit={submit}>
        <p className="muted small">About: “{frameTitle}”</p>
        <fieldset>
          <legend>How clear was this step?</legend>
          <div className="rating">
            {[1, 2, 3, 4, 5].map((value) => (
              <label key={value}>
                <input type="radio" name="rating" value={value} checked={rating === value} onChange={() => setRating(value)} />
                <span>{value}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>What was wrong or unclear? (optional)</span>
          <textarea value={comment} maxLength={1000} rows={3} onChange={(event) => setComment(event.target.value)} />
        </label>
        <button type="submit" className="button" disabled={!rating || status === "sending"}>{status === "sending" ? "Sending…" : "Send feedback"}</button>
        <p role="status" className={`small ${status === "error" ? "error-text" : ""}`}>{message}</p>
      </form>
    </details>
  );
}
