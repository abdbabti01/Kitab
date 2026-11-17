# Reliability hardening — checkpoint

Branch `fix/reliability-hardening` (worktree `Kitab-rel`), from origin/main e07b9b7 (= production build).

## Done
- 1acc6c8 busyArea crash: fold owns its design snapshot; Workspace run+source one state; foldAt pure + tests; challenge fixed settings shown. GitHub CI green on this commit.
- 865d0a2 Progress stores: keyed-store.ts (record by record, other-version read-only, whole backups, per-record saves); network named saves confirm replace/drop.
- 740eee4 Error recovery: stale-chunk reload, contained inspector/run failures, diagnostics + build id.
- (lab) Lab cursor owned by its run.
- 22ecaaf Designs: update-only autosave (no resurrection across tabs), versioned list never overwritten, import size before read.

## Verification
- npm run build: 627 unit tests pass, typecheck clean, build OK. Initial JS +1.8 KB, total +4.2 KB.
- Full Playwright (5 projects) locally: see final report.

## Known limits (not fixed)
- Two tabs editing the same record: last save wins.
- Lab page ignores `saved: false` from lab progress writes (no visible warning).
- Network workspace is one key: two tabs editing it, last save wins.
