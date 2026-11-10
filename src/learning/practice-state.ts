// One learner-facing progress model for every practice mission, networking and TCP alike.
export type PracticeState = "not-started" | "in-progress" | "completed" | "mastered";
export const practiceLabels: Record<PracticeState, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  completed: "Completed",
  mastered: "Mastered",
};
