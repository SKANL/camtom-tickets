# Specifications: Dashboard Max Enhancements

## 1. Metadata API

**Types**: `MetadataCatalog { teams, projects, users, workflowStates, labels, cycles: SelectOption[] }`, `SelectOption { id, name }`.

**Endpoint**: `GET /api/metadata` returns `MetadataCatalog`. Server cache TTL ≥5min. 6 parallel Linear GQL on miss. Invalidate on `PUT /api/config`.

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| M1: 6 populated arrays | All populated | Empty = `[]`, not null |
| M2: sub-ms cached hit | Miss → fetch+return | — |
| M3: 6 parallel GQL <2s cold | All resolve | One fails → partial + null |
| M4: retry/rate-limit per query | — | Backs off independently |

## 2. Timer-on-Assign

**Types**: `Issue.assignedAt?: string`. `SSEEvent.data.assignmentTimestamps?: Record<issueId, ISO>`.

**Server**: Poller compares `prev.assignee?.id !== current.assignee?.id`. Stores `issueId→epoch` in `Map`. Initial poll stamps all current as `now`. Emits on SSE delta.

**Client**: `useIssues` merges timestamps. `computeDeadline` uses `assignedAt ?? createdAt`.

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| T1: detect assignee change | null→UserA, UserA→UserB | Same assignee→no op |
| T2: track assignedAt map | Updated on change | Restart→stamp all as now |
| T3: SSE delta payload | Entries in delta | Field absent→client ignores |
| T4: SLA uses `assignedAt ?? createdAt` | Deadline computed | Fallback to createdAt |
| T5: client merges delta | Merged in map | Unknown issue→discard |

## 3. Client-Side Filtering

**Hook**: `useMetadata()` fetches `/api/metadata`, localStorage 5min cache, stale-while-revalidate.

**Component**: `FilterBar` with 6 toggles (project, assignee, state, label, priority, text). Collapsible + active count badge. State in localStorage.

**Ownership**: `App.tsx` owns `FilterState`, `useMemo([filters,issues])` → `filteredIssues` → Dashboard.

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| F1: 6 controls | All render | No metadata→disabled, "Loading" |
| F2: collapse/expand | Badge when collapsed | Restored from localStorage |
| F3: active count badge | 2+1→"3 filters" | 0→no badge |
| F4: App owns state | Any filter recomputes | None→all pass |
| F5: AND logic | P1+Started=intersection | — |
| F6: text search (ci substring) | "auth" matches | Empty→all |
| F7: useMetadata fetch | Cache on success | Fail→stale; both fail→error |

## 4. Settings Panel Expansion

**Types added**: `DashboardConfig.displayOptions?: { columnOrder?, columnVisibility?, timerStyle?: 'circle'|'bar', animationIntensity?: 'off'|'subtle'|'full' }`.

**Layout**: 5 tabs (General, Display, SLA, Labels & Phrases, Sounds). SLA: list/edit/add/remove rules. Display: timer style, column visibility, animation intensity. Sounds: volumes, auto-mute. Persist: localStorage + `PUT /api/config`.

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| S1: 5 tabs | Pane switches | Unsupported→hide |
| S2: Display controls | "bar" live-updates | — |
| S3: SLA edit + validation | Save≥1 | Invalid→revert |
| S4: add/remove rules | Add gets UUID | — |
| S5: PUT writes YAML | 200 OK | 500, keep last-good |
| S6: sound sliders | Volume changes | — |
| S7: dual persistence | Server+local merge | — |

## 5. Visual Overhaul

**New**: `@keyframes siren-flash` (0.5s), `arrival-glow` (2s), `arrival-bounce` (0.4s), `burnt-fade`, `urgent-pulse` (1.5s). CSS vars: `--timer-bar-height`, `--siren-border-color`, `--arrival-duration`, `--burnt-opacity-min`.

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| V1: BREACHED = siren flash | Border flashes | GPU-only props |
| V2: new ticket = glow+bounce | Once on mount | Re-added replays |
| V3: burnt fade near breach | 10%→opacity 0.4 | Only opacity |
| V4: receipt clip-path | Polygon teeth | Unsupported→normal |
| V5: bar timer mode | 8px + gradient | — |
| V6: temp gauge per priority | P1=red, P4=blue | — |
| V7: WARNING = urgent pulse | Every 1.5s | Scale+opacity only |
| V8: GPU-only animations | — | No box-shadow/width |
| V9: intensity setting honored | off/subtle/full | Re-toggle activates |
