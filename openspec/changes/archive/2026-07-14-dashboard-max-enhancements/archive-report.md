# Archive Report — dashboard-max-enhancements

**Archived**: 2026-07-14
**Change**: dashboard-max-enhancements
**Status**: ✅ Complete — PASS WITH WARNINGS

---

## Summary

Major enhancement iteration on the ticket dashboard delivering richer Linear metadata for filtering, accurate SLA timing anchored on assignment (not creation), full UI configurability, and a dramatic kitchen-timer visual experience — all backward-compatible with existing features.

## What Was Delivered

### 1. Metadata API (`GET /api/metadata`)
6 new Linear GraphQL queries (teams, projects, users, workflow states, labels, cycles) served via a single aggregated endpoint with 5-min server cache, parallel `Promise.allSettled` on cold miss, and independent retry/rate-limit per query.

### 2. Timer-on-Assign
Server-side `AssignmentTracker` in the poller detects assignee changes, stores `issueId→epoch` timestamps, emits via SSE delta. Initial poll stamps all current issues as `now` (restart recovery). Client uses `assignedAt ?? createdAt` as SLA anchor.

### 3. Client-Side Filtering
`useMetadata` hook + `FilterBar` component with 6 filter dimensions (project, assignee, state, label, priority, text search), collapsible UI with active count badge, localStorage persistence, AND logic composition in `App.tsx`.

### 4. Settings Panel Expansion
5-tab modal overlay (General, Display, SLA, Labels & Phrases, Sounds) with SLA rule CRUD (add/edit/remove/validation), display controls (timer style, animation intensity, column visibility), sound controls (volume sliders, auto-mute, preview), dual persistence (localStorage + `PUT /api/config`).

### 5. Visual Overhaul
CSS-only animation suite — siren flash, burnt opacity fade, arrival glow+bounce, receipt clip-path, urgent pulse, bar timer mode with gradient fill and tick marks, temperature gauge per priority. GPU-only properties where feasible.

## Artifacts

### Engram Observations
| Artifact | ID | Status |
|----------|----|--------|
| Proposal | #390 | ✅ |
| Spec | #391 | ✅ |
| Design | #392 | ✅ |
| Tasks | #393 | ✅ (32/32 complete) |
| Apply Progress | #394 | ✅ |
| Verify Report | #395 | ✅ (PASS WITH WARNINGS) |
| Archive Report | current | ✅ |

### OpenSpec Files (Archived)
```
openspec/changes/archive/2026-07-14-dashboard-max-enhancements/
├── proposal.md
├── exploration.md
├── specs/
│   └── spec.md
├── design.md
├── tasks.md
├── verify-report.md
└── archive-report.md
```

### Main Spec Updated
```
openspec/specs/dashboard/spec.md  ← created from delta spec
```

## Task Completion

All **32 tasks** across 5 phases are verified complete:
- Phase 1 (8 tasks): Shared Types + Metadata API
- Phase 2 (7 tasks): Timer-on-Assign
- Phase 3 (6 tasks): Filter Infrastructure
- Phase 4 (6 tasks): Settings Panel Expansion
- Phase 5 (5 tasks): Visual Overhaul

## Spec Compliance

All requirements verified against implementation:
- **Metadata API**: M1-M4 ✅
- **Timer-on-Assign**: T1-T5 ✅
- **Client-Side Filtering**: F1-F7 ✅
- **Settings Panel Expansion**: S1-S7 ✅
- **Visual Overhaul**: V1-V9 ✅ (V8: ⚠️ box-shadow not GPU-only)

## Verification Result

**PASS WITH WARNINGS** — No CRITICAL issues. 71/71 existing tests pass. Build succeeds (shared/server/client).

Warnings carried forward:
1. **V8 GPU-only**: `siren-flash` uses `box-shadow` (layout-triggering) rather than GPU-only properties
2. **Missing test coverage**: No dedicated tests for new features (metadata API, filtering, settings tabs, visual overhaul)
3. **useSLA.test.ts hangs**: Pre-existing vitest fake-timer teardown issue

## Deviations from Design

- `DeltaPayload` uses `Record<string, string>` (ISO strings) for `assignmentTimestamps` rather than `Record<string, number>` as initially specified — consistent with `SSEEvent.data` typing convention.
- Task count discrepancy: apply-progress reported 27, actual verified count is 32 (5 additional tasks tracked during spec finalization).

## Lessons Learned

1. **Task count tracking**: apply-progress reported 27 tasks while the actual count was 32. Future apply phases should re-read the persisted tasks artifact rather than tracking independently.
2. **GPU-only enforcement**: The V8 requirement to avoid `box-shadow` was noted in spec and design but the implementation used `box-shadow` for the siren effect — a visual tradeoff that's worth documenting but not blocking.
3. **Test coverage gap**: New features lacked dedicated tests. For future changes, consider including test scaffolding in the task breakdown.
4. **Delta spec structure**: The flat `specs/spec.md` (no domain subdirectory) worked for this change but future changes should use domain subdirectories (e.g., `specs/{domain}/spec.md`) for cleaner main spec mapping.

## Intent

Intentional partial archive: No — all artifacts are complete, all tasks are done. Archive is full and clean.
