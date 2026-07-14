# Archive Report: dashboard-refined-view

**Archived**: 2026-07-14
**Change**: dashboard-refined-view
**Project**: camtom-tickets
**Status**: success

## Summary

The `dashboard-refined-view` change refined the TV dashboard with default filter behavior (exclude Done/Pull Request Sent states, default "ticket" label), auto-provisioned Linear label creation on server startup, and a cleaner TicketCard layout with title-first hierarchy. All 12 tasks were implemented across 7 files, build is clean, and all 71 tests pass.

## What Was Done

### Phase 1: Foundation
- Added `excludeStates: string[]` to `FilterState` in `shared/src/types.ts`
- Added `IconPerson` SVG component to `client/src/components/Icons.tsx`

### Phase 2: Server — Linear Label Auto-Provisioning
- Added `IssueLabelCreate` GQL mutation and `ensureLabel(name)` helper to `server/src/linear-client.ts` — existence check via `fetchLabels`, idempotent create
- Wired non-blocking startup probe after `startPolling()` in `server/src/index.ts` — `try/catch` around `ensureLabel('ticket')`, log/warn only

### Phase 3: Client — Default Filters & FilterBar
- Added two-phase default resolution `useEffect` in `App.tsx` — on metadata ready, resolve exclude state IDs and ticket label ID, merge with current filter state via `setFilter`, guard with `useRef`
- Added exclusion filter step after state include in `useMemo` — exclusion wins over inclusion
- Updated `emptyFilter()`, `loadFilter()`, `countActive()` in `FilterBar.tsx`

### Phase 4: TicketCard Refactor
- Restructured `TicketCard.tsx` layout — title at top (`var(--text-lg)`, 3-line clamp), identifier below (`var(--text-xs)`, clickable)
- Replaced assignee display — `IconPerson(size={14})` + name, hidden when unassigned, no "Unassigned" text
- Build clean, all 71 tests pass (31 client + 40 server)

## Spec Compliance

All requirements verified:
- **F8/F8a/F8b**: Default filter initialization with metadata-driven ID resolution
- **F9/F9a/F9b**: Filter chain exclusion step (exclusion wins over inclusion)
- **DF1-DF4**: Default filter behavior (exclude states, label filter, merge, precedence)
- **LM1-LM4**: Label management (existence check, idempotent, non-blocking, graceful degradation)
- **TC1-TC4**: TicketCard layout (title-first, identifier placement, assignee display, stability)

## Files Changed

| File | Change |
|------|--------|
| `shared/src/types.ts` | Added `excludeStates` to `FilterState` |
| `client/src/App.tsx` | Two-phase default resolution, exclusion filter step, metadata ID resolution |
| `client/src/components/FilterBar.tsx` | Updated `emptyFilter()`, `loadFilter()`, `countActive()` |
| `client/src/components/TicketCard.tsx` | Title-first layout, assignee cleanup with `IconPerson` |
| `client/src/components/Icons.tsx` | Added `IconPerson` SVG component |
| `server/src/linear-client.ts` | Added `createLabel` mutation + `ensureLabel` helper |
| `server/src/index.ts` | Non-blocking startup probe for label creation |

## Architecture Decisions

- **AD1**: Case-insensitive substring state name matching for portability across workspaces
- **AD2**: Non-blocking startup probe with existence check for idempotent label creation
- **AD3**: Two-phase default resolution with localStorage merge (metadata-driven)
- **AD4**: Exclusion as separate filter chain step (exclusion wins over inclusion)

## Main Spec Updated

The delta spec from `specs/dashboard/spec.md` was merged into `openspec/specs/dashboard/spec.md`. Modified rows (F4, F5, F7) were updated and new rows (F8/F8a/F8b, F9/F9a/F9b) were added to the Client-Side Filtering section.

## Risks & Mitigations

All identified risks were addressed — state name mismatch handled via substring matching, label creation race handled via graceful degradation, localStorage conflicts handled via empty-check merge. No residual risks remain.
