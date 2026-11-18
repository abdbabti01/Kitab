# Predict → Experiment → Explain — checkpoint

Branch `feature/predict-experiment-explain` from `origin/main` @ `180855f` (Learning Clarity #87 and Reliability #86
merged). Worktree: `../Kitab-pee`.

## Audit (what already predicts)

| Where | Prediction today | Gap |
|---|---|---|
| Missions (TCP, DS, recursion, IP) | Full predict → run → evidence → mastery | none: unchanged |
| Architecture labs | Prediction + fix + explanation | none: unchanged |
| Network Playground | "Predict as you go" checkpoints from trace events | no guided question with a reason and a variation |
| System Design lessons | Experiment runs, "What to notice" after a run | no prediction, no evidence-based explanation |
| Data Structures Playground | Guided experiments set up a run | no prediction, answer visible at once |

## Plan

- `src/learning/cycle.ts`: pure cycle model + reducer (ready → running → observed → explained → completed; `again`
  starts a new attempt, `vary` a variation trial). Results carry attempt + trial; a stale result is ignored.
  Outcome, supported reason and comparison direction are computed from the real run, never fixed.
- `src/learning/cycle-progress.ts`: `kitab.experiments.v1` via keyed-store, one record per `id@version`, no event
  streams. Resume re-runs the deterministic engine and checks the stored outcome still matches.
- `src/ui/PredictCycle.tsx` + `cycle.css`: one panel for all subjects; hosts render their own simulator view.
- Content: `src/architecture/cycles.ts` (lesson experiments), `src/structures/cycles.ts` (Playground guided
  experiments), `src/practice/network/cycles.ts` (Network Playground `?experiment=`).
- Hosts: System Design lesson experiment (Guided / Explore freely), Structures Playground (`?experiment=`),
  Network Playground (`?experiment=`), PathNext links, Architecture Playground list.
- Mastery and existing stores unchanged.

## Status

- [x] core + tests
- [x] system design (5 experiments, lesson pages)
- [x] data structures (5 experiments, Playground ?experiment=)
- [x] networking (3 experiments, Network Playground ?experiment=)
- [x] launch points, docs (docs/GUIDED-EXPERIMENTS.md)
- [x] e2e + full verification (unit 644, Playwright 1303/1304 per project; 1 tablet flake passes 27/27 on repeat)
