# Kitab missions & guide — design note

## Learning loop
inspect → predict → run → explain → retry. A mission shows the initial frame,
collects a prediction (choice or number) before playback, runs the engine
trace, asks an evidence question, then offers a retry on a *different variant*
so the second answer cannot be copied from the first run.

Mastery = correct prediction **and** correct evidence choice in one attempt.
Visiting, autoplay, Next clicks, skipped predictions and free-text reflection
never grant mastery. Reflection is labelled optional.

## Layers
```
engine (pure TS)  →  adapter (validate params, frames, facts, outcome)
                      ↓ registry.buildTrace(engineId, params)
mission (validated config: prompt, options → engine facts, evidence, hints)
                      ↓
mission controller (phase/attempt)   playback reducer (index/speed/status)
                      ↓
MissionShell (generic) + Scene[engineId] + Inspector + KitabGuide
```
- Every visible number (scene, narration, inspector, prediction check, tutor
  context) is read from the same `LearningFrame`/`outcome` objects.
- Options reference outcome facts or literals; mission tests assert exactly one
  option matches the computed answer for every variant.
- A new scenario = a new mission object. A new mechanism = adapter + scene.

## Guide
Topic-independent reducer driven by an event contract (`mission-opened`,
`object-selected`, `prediction-submitted`, `run-*`, `hint-requested`,
`misconception-identified`, `retry-started`, `tutor-*`, `mastered`). Domain
text comes from the mission/adapter; the avatar only renders mood + message +
an optional entity id to point at.

Art direction: a compact code-native SVG "book spirit" — an open cobalt book
whose spread forms a face, with a ribbon bookmark that acts as the pointer.
Moods map to eye shape, page posture, ribbon angle and a small accent. CSS
keyframes only; reduced motion keeps static poses. Text is always rendered
beside it, never only in animation.

## AI boundaries
- Drafts: schema-bound semantic content, always labelled draft/illustrative.
- Tutor: server rebuilds the trace, derives facts up to the current frame,
  withholds outcome before prediction, validates the strict response
  (unknown keys, lengths, evidence ids, attention ids, numeric grounding,
  adapter contradiction rules, topic vocabulary). Fallback is the reviewed
  hint/narration. AI never grades.
