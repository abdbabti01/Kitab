# Lesson experience

**One learning journey, one primary progression control, contextual tools only when needed.**

## Hierarchy

Track → Unit → Lesson → Step.

| Level | Where it is shown | Moves the learner? |
|---|---|---|
| Track, Unit | The course bar under the header (`StepBar`): `Track › Unit n: title › this activity`, and "Lesson · 2 of 3 in this unit" with the unit's status dots | No. The track and unit links go back to the roadmap. |
| Lesson (any activity in a unit: lesson, reading, mission, lab, challenge) | The page's `h1` | At its end only: every activity ends with the same "Next step" (`PathNext`) to the unit's next activity. |
| Step (inside a `/learn/:id` lesson) | One progress indicator, "Step n of m" (`LessonProgress`), and one Previous / Next area (the step controls) | Yes: the only control that moves through the lesson. |
| Chapter (a group of steps) | The lesson outline (`LessonOutline`), folded under "Chapter n of m: title" | Jumps to a chapter's first step; never a second way through. |
| Level (Program / Array / Memory, Bits / Mask, …) | A marker under the step title showing the step's level among the lesson's levels; "About the levels" holds each level's introduction | No. |

Before this change a lesson offered the course bar's Previous/Next (between activities), a chapter strip, a level
rail whose "explore" mode re-scoped Next/Back to one level, the step controls, and the completion card's Next, with
three different counts ("Step 1 of 3", "step 1 of 2", "1 / 11").

### Why levels are a marker, not tabs

Every step is bound to exactly one level (`step.level`, or the engine frame's level). A level is therefore where a
step happens, not a way of viewing it: there is no "Memory view" of a "Program" step to switch to. Tabs would promise
something the content cannot show. The marker states the step's level; the introductions stay one click away.

## The lesson shell

`src/ui/LessonShell.tsx` holds the shared pieces:
- `LessonProgress`: the one progress indicator.
- `LessonOutline`: the parts in order, with done and current marked.

Both are used by `/learn/:id` lessons (steps and chapters) and by System Design concept units (checks answered right,
and concepts as in-page anchors). Layout of a `/learn/:id` lesson:

1. Course bar: context only.
2. Lesson title, step progress and the chapter outline.
3. The step: title, level marker, who acts, the chapter's goal on its first step.
4. The diagram, with "Change the example" attached to it.
5. Beside it (or under it on phones): the step controls, then what happens and why, the selected object, and
   Kitab's guide with the optional AI question folded away.
6. Reference: the key term, every lesson term, the levels and "About this example".

On stacked layouts (≤ 860 px) the step controls are fixed to the bottom of the screen; the page reserves their height
and a focused control is always scrolled clear of them.

## Progress and state: what maps to what

Nothing stored changed. `kitab.learning.v1` records are read and written exactly as before, and lesson, chapter,
step and mission ids are unchanged.

| Stored or old UI state | New experience |
|---|---|
| `position.stepId`, `position.track`, `position.journeyStepId`, `position.params` | Restored as before; the progress indicator and the outline are derived from the restored step. |
| `seen`, `chaptersSeen` | The outline marks seen chapters as done. Completion still needs the last step and every chapter seen. |
| `completedAt`, `visits`, `lastVisitedAt`, `experimentsCompleted` | Unchanged; a completed lesson keeps its date. |
| Level rail "open" / "explore" (`NavState.level`) | Never saved (`restoreNav` always reset it), so nothing to migrate. The reducer actions remain; the page no longer offers them. |
| Chapter strip jump (`GOTO_CHAPTER`) | The outline dispatches the same action. |
| Course bar Previous / Next | Removed; the activity's own end-of-page "Next step" leads on, and the unit link leads back. |

Opening the outline, the level introductions, the example controls or the AI question changes neither the step nor
progress, and never completes a lesson; lessons never write mission practice or mastery.

## Verified by

- `e2e/lesson-experience.spec.ts`:
  - one progression system on every lesson;
  - old progress resumed and kept, and completion dates kept;
  - panels never move or complete the lesson;
  - lesson → Playground → back;
  - 1440 to 320 px.
- `e2e/lessons.spec.ts`: Previous/Next walk every step in order, and the level marker follows each step.
- `e2e/accessibility.spec.ts`: the outline is operable from the keyboard and the level marker is not a control.
- `e2e/lesson-layout.spec.ts`: the bar never covers content or focus, on every step of every lesson.
- `tests/packet-journey.test.ts`: the static Packet Journey page carries the same course bar.
