// One learner-facing progress model for every activity: lessons, explorations and missions alike.
// "Opened" is only ever a visit: it never counts towards completion and never moves the recommended next step.
export type PracticeState = "not-started" | "visited" | "in-progress" | "completed" | "mastered";
export const practiceLabels: Record<PracticeState, string> = {
  "not-started": "Not started",
  visited: "Opened",
  "in-progress": "In progress",
  completed: "Completed",
  mastered: "Mastered",
};
