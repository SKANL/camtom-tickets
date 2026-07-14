# Tasks: Dashboard Max Enhancements

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~800 |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR (budget 800 lines per session config) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Medium

---

## Phase 1: Shared Types & Backend — Metadata API

- [x] 1.1 Add `SelectOption`, `MetadataCatalog`, `DisplayOptions`, `FilterState` interfaces to `shared/src/types.ts`
- [x] 1.2 Add `assignedAt?: string` to `Issue` and `assignmentTimestamps?: Record<string, string>` to `SSEEvent.data` in `shared/src/types.ts`
- [x] 1.3 Add `displayOptions?: DisplayOptions` to `DashboardConfig` in `shared/src/types.ts`
- [x] 1.4 Add `displayOptions?` field to `RawDashboardFile` in `server/src/config.ts`
- [x] 1.5 Add 6 GQL query functions (`fetchTeams`, `fetchProjects`, `fetchUsers`, `fetchWorkflowStates`, `fetchLabels`, `fetchCycles`) to `server/src/linear-client.ts`
- [x] 1.6 Export `metadataCache` (TTL 5+ min) from `server/src/cache.ts`
- [x] 1.7 Create `server/src/routes/metadata.ts` — `GET /api/metadata` with 6 parallel GQL calls and cache layer
- [x] 1.8 Mount metadata router and invalidate cache on config reload in `server/src/index.ts`

## Phase 2: Backend — Timer-on-Assign

- [x] 2.1 Create `AssignmentTracker` class (Map-backed, `stamp`, `stampAll`, `getTimestamps`, `onAssigneeChange` methods) in `server/src/poller.ts`
- [x] 2.2 Extend `computeDiff` in `poller.ts` to detect `prev.assignee?.id !== current.assignee?.id` and stamp changes
- [x] 2.3 Add `assignmentTimestamps?: Record<string, number>` to `DeltaPayload` in `server/src/sse.ts`
- [x] 2.4 Emit `assignmentTimestamps` in `broadcastDelta` from poller's tracked map
- [x] 2.5 Stamp all current issues as `now` on initial poll (restart recovery)
- [x] 2.6 Merge `assignmentTimestamps` from SSE delta into issue map in `client/src/hooks/useIssues.ts`
- [x] 2.7 Update `useSLA.ts` to use `assignedAt ?? createdAt` as anchor for `computeDeadline`

## Phase 3: Client — Filter Infrastructure

- [x] 3.1 Create `client/src/hooks/useMetadata.ts` — fetches `/api/metadata`, localStorage 5min cache, stale-while-revalidate
- [x] 3.2 Create `client/src/components/FilterBar.tsx` — 6 filter controls (project, assignee, state, label, priority, text), collapsible with active count badge, localStorage persistence
- [x] 3.3 Add `useMetadata` hook invocation and `FilterState` + `useMemo` filter chain to `client/src/App.tsx`
- [x] 3.4 Pass `filteredIssues` instead of raw `issues` to `Dashboard` in `App.tsx`
- [x] 3.5 Update `Dashboard.tsx` to accept `filteredIssues` prop
- [x] 3.6 Add temperature gauge strip per column header to `PriorityGroup.tsx`

## Phase 4: Client — Settings Panel Expansion

- [x] 4.1 Refactor `SettingsPanel.tsx` to tabbed layout with 5 tabs: General, Display, SLA, Labels & Phrases, Sounds
- [x] 4.2 Add Display tab controls: `timerStyle` (circle/bar), `animationIntensity` (off/subtle/full), column visibility toggles
- [x] 4.3 Add SLA rules tab: list/edit/add/remove SLA rules with validation (maxMinutes ≥1, at least one applicable priority)
- [x] 4.4 Add Sounds tab: volume sliders, auto-mute toggle, preview buttons
- [x] 4.5 Wire `displayOptions` overrides through localStorage and `PUT /api/config` write-back in SettingsPanel
- [x] 4.6 Ensure `saveConfig` in `server/src/config.ts` handles `displayOptions` field in YAML serialization

## Phase 5: Client — Visual Overhaul + Timer-on-Assign Integration

- [x] 5.1 Add `@keyframes siren-flash` (0.5s), `arrival-glow` (2s), `arrival-bounce` (0.4s), `burnt-fade`, `urgent-pulse` (1.5s) to `client/src/styles/animations.css`
- [x] 5.2 Add CSS custom properties `--timer-bar-height`, `--siren-border-color`, `--arrival-duration`, `--burnt-opacity-min`, `--gauge-{priority}` vars to `variables.css`
- [x] 5.3 Update `TicketCard.tsx` — siren flash on BREACHED, burnt opacity fade near breach, receipt clip-path polygon, arrival glow+bounce on mount, clickable URL
- [x] 5.4 Update `SLATimer.tsx` — add bar mode (`timerStyle='bar'`), gradient coloring, tick marks, accelerating tick animation on WARNING
- [x] 5.5 Add optional `displayOptions` section to `config/dashboard.yaml`
