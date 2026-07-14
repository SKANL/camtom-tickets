# Design: Dashboard Max Enhancements

## Technical Approach

Five independent enhancement areas built on existing polling + SSE architecture. Backend extends `linear-client.ts` with 6 new GQL queries served via single aggregated `/api/metadata` endpoint with server cache. Poller gains assignee-change detection with server-side `assignedAt` timestamps. Client gets `FilterBar`, tabbed `SettingsPanel`, `useMetadata` hook, and CSS-only visual overhaul. All additions are backward-compatible — new fields optional, SSE ignores unknown keys, CSS has fallbacks.

## Architecture Decisions

### Metadata API: Aggregated vs Individual Endpoints

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Aggregated `GET /api/metadata`** | Single round-trip, one cache entry, simpler routing. Larger payload but fetched once per session. | **Chosen** — 6 queries in parallel on cold miss, 5+ min TTL, invalidated on `PUT /api/config`. |
| Individual `/api/metadata/{type}` | Granular caching, smaller payloads. 6 round-trips from client, more routes, more code. | Rejected — adds complexity for no real benefit when metadata is a session-level fetch. |

### Timer-on-Assign: Server Tracking vs Alternatives

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Server-side Map in poller** | Leverages existing polling. Lost on restart (mitigated by stamping all as "now"). Single source of truth. | **Chosen** — extends `computeDiff` for assignee change detection. |
| Webhook-based | Real-time. Requires public endpoint, webhook registration, rate-limit concerns. | Rejected — over-engineered for LAN/TV dashboard. |
| Client-side tracking | No server changes. Inconsistent across clients, lost on refresh. | Rejected — timestamps must be authoritative. |

### Filtering: Client-side vs Server-side

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Client-side `useMemo`** | Instant feedback, works with SSE, no server changes. Doesn't scale past ~thousands. | **Chosen** — spec confirms <200 issues per team. |
| Server-side filtered queries | Efficient at scale. Adds query params, cache invalidation, contradicts "all issues anyway" model. | Rejected — polling already fetches all issues; filtering server-side adds no value. |

### Settings Expansion: Tabbed Panel vs Alternatives

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Tabbed modal overlay** | 5 tabs within existing overlay. Compact, organized, direct access to sections. | **Chosen** — maintains existing UX pattern. |
| Accordion (scroll) | No tab state. Forces scrolling through all sections to find one option. | Rejected — poor UX with 5+ sections. |
| Separate `/settings` route | Full page. Requires navigation, breaks modal pattern, complicates state flow. | Rejected — no route management needed. |

### Visual Enhancements: CSS-only vs JS Library

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Pure CSS (keyframes + custom properties)** | Zero dependencies, 60fps GPU compositing, declarative. Limited animation complexity. | **Chosen** — 60fps requirement on TV browser demands GPU-only paths (`transform`, `opacity`). |
| GSAP / Framer Motion | Complex sequencing, spring physics. Runtime cost, new dependency, JS thread contention. | Rejected — siren/burnt/urgent effects are straightforward CSS. |

## Data Flow

```
                              ┌──────────────────────┐
                              │    Linear GraphQL     │
                              │  api.linear.app/gql   │
                              └──────┬───────────────┘
                                     │ 6 parallel queries (teams, projects,
                                     │ users, workflowStates, labels, cycles)
                                     ▼
┌──────────┐   GET /api/metadata   ┌──────────────────────┐ ┌───────────────┐
│  Client  │ ◄─────────────────── │  server/src/routes/   │ │ metadataCache │
│ (App.tsx) │                      │   metadata.ts         │◄│ TTL ≥5min     │
│          │   SSE delta w/        └──────────────────────┘ └───────────────┘
│          │   assignmentTimestamps     ▲
│          │ ◄──────────────────────┐  │
│          │                        │  │
│          │   PUT /api/config      │  │
│          │ ──────────────────────►│  │
└──────────┘                        │  │
                                    │  │
  ┌──────────────────┐              │  │
  │  poller.ts        │─────────────┘  │
  │  computeDiff()    │ extends diff   │
  │  detects assignee │ to detect      │
  │  changes          │ assignee swap  │
  └──────────────────┘                │
       │ assignedAt Map<id,epoch>     │
       ▼                              │
  ┌──────────────┐                    │
  │  sse.ts      │────────────────────┘
  │  broadcast   │ emits delta with
  │  DeltaPayload│ assignmentTimestamps
  └──────────────┘

  Client-side filter flow:
  App.tsx (FilterState) ──useMemo──► filteredIssues ──► Dashboard

  Settings flow:
  SettingsPanel ──localStorage──► overrides ──PUT──► /api/config ──► YAML files
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `shared/src/types.ts` | Modify | Add `SelectOption`, `MetadataCatalog`, `DisplayOptions`, extend `Issue` with `assignedAt?`, extend `SSEEvent.data` with `assignmentTimestamps?` |
| `server/src/linear-client.ts` | Modify | Add 6 GQL query functions: `fetchTeams`, `fetchProjects`, `fetchUsers`, `fetchWorkflowStates`, `fetchLabels`, `fetchCycles`. Shared `executeGraphQL`. |
| `server/src/routes/metadata.ts` | **Create** | `GET /api/metadata` — calls 6 parallel queries, wraps in `MetadataCatalog`, sets cache entry. Partial on individual failure (null for that array). |
| `server/src/poller.ts` | Modify | Extend `computeDiff` to detect `prev.assignee?.id !== current.assignee?.id`. Track `assignmentTimestamps: Map<string, number>`. Emit in SSE delta. |
| `server/src/cache.ts` | Modify | Export `metadataCache` with 5+ min TTL. Invalidate on config save. |
| `server/src/index.ts` | Modify | Register metadata router. Invalidate metadata cache on config reload. |
| `client/src/hooks/useMetadata.ts` | **Create** | Fetch `GET /api/metadata`, localStorage 5min cache, stale-while-revalidate. |
| `client/src/hooks/useIssues.ts` | Modify | Merge `assignmentTimestamps` from SSE delta into issue map. |
| `client/src/hooks/useSLA.ts` | Modify | Use `assignedAt ?? createdAt` as anchor for `computeDeadline`. |
| `client/src/App.tsx` | Modify | Add `useMetadata`, `FilterState`, `useMemo` filter chain. Pass `filteredIssues` to Dashboard. |
| `client/src/components/FilterBar.tsx` | **Create** | 6 filter controls (project, assignee, state, label, priority, text). Collapsible, active count badge, localStorage state. |
| `client/src/components/Dashboard.tsx` | Modify | Accept `filteredIssues` instead of `issues` prop. |
| `client/src/components/TicketCard.tsx` | Modify | Add siren/animation class bindings from `TimerState`. Arrival glow animation on mount. Receipt clip-path. Burnt opacity. Clickable URL. |
| `client/src/components/SLATimer.tsx` | Modify | Add bar mode (alternative to circle) via `timerStyle` prop. Gradient coloring, tick marks. Accelerating tick animation on WARNING. |
| `client/src/components/PriorityGroup.tsx` | Modify | Add temperature gauge gradient strip per column header. |
| `client/src/components/SettingsPanel.tsx` | Modify | Major restructure: tabbed layout (General, Display, SLA, Labels & Phrases, Sounds). SLA rule CRUD (add/edit/remove). Display: timerStyle, column visibility, animationIntensity. |
| `client/src/styles/animations.css` | Modify | Add `@keyframes siren-flash`, `arrival-glow`, `arrival-bounce`, `burnt-fade`, `urgent-pulse`. Animation classes. |
| `client/src/styles/variables.css` | Modify | Add `--timer-bar-height`, `--siren-border-color`, `--arrival-duration`, `--burnt-opacity-min`, `--gauge-{priority}` vars. |
| `config/dashboard.yaml` | Modify | Add optional `displayOptions` with `timerStyle`, `animationIntensity`. |

## Interfaces / Contracts

```typescript
// shared/src/types.ts — additions

export interface SelectOption {
  id: string;
  name: string;
}

export interface MetadataCatalog {
  teams: SelectOption[];
  projects: SelectOption[];
  users: SelectOption[];
  workflowStates: SelectOption[];
  labels: SelectOption[];
  cycles: (SelectOption & { completedAt?: string })[];
}

export interface DisplayOptions {
  columnOrder?: number[];
  columnVisibility?: Record<number, boolean>;
  timerStyle?: 'circle' | 'bar';
  animationIntensity?: 'off' | 'subtle' | 'full';
}

// Extend Issue
export interface Issue {
  // ...existing fields
  assignedAt?: string;  // NEW — ISO timestamp, set on assignee change
}

// Extend SSEEvent.data
export interface SSEEventData {
  // ...existing fields
  assignmentTimestamps?: Record<string, string>; // issueId → ISO timestamp
}

// Extend DashboardConfig
export interface DashboardConfig {
  // ...existing fields
  displayOptions?: DisplayOptions;  // NEW
}

// Client-side filter state
export interface FilterState {
  projects: string[];     // selected IDs
  assignees: string[];
  states: string[];
  labels: string[];
  priorities: number[];
  textSearch: string;
}
```

```typescript
// GET /api/metadata response
interface MetadataResponse {
  catalog: MetadataCatalog;
  cached: boolean;
  errors?: Record<string, string>; // failed query → error msg
}
```

```typescript
// Server-side assignment tracking
interface AssignmentTracker {
  private timestamps: Map<string, number>; // issueId → epoch ms
  
  stamp(issueId: string): void;
  stampAll(issues: Issue[]): void; // initial poll
  getTimestamps(): Record<string, string>; // returns ISO strings for SSE
  
  onAssigneeChange(prev: Issue | null, current: Issue): string | null;
  // returns issueId if assignee changed, null otherwise
}
```

## Implementation Phases

All phases within single PR (800-line budget):

| Phase | Scope | Files | Est. Lines |
|-------|-------|-------|------------|
| **P1: Types & Server Metadata** | New types, 6 GQL queries, `GET /api/metadata`, metadata cache | types.ts, linear-client.ts, metadata.ts, cache.ts | ~180 |
| **P2: Assignment Tracking** | `AssignmentTracker`, poller diff extension, SSE delta emission | poller.ts, sse.ts, useIssues.ts, useSLA.ts | ~100 |
| **P3: Client Filtering** | `useMetadata`, `FilterBar`, App filter state, Dashboard prop | useMetadata.ts, FilterBar.tsx, App.tsx, Dashboard.tsx | ~150 |
| **P4: Settings Expansion** | Tabbed layout, SLA CRUD, Display options, Sounds tab | SettingsPanel.tsx (restructure) | ~180 |
| **P5: Visual Overhaul** | All CSS anims, SLATimer bar mode, siren/burnt/receipt/urgent/gauge | animations.css, variables.css, TicketCard.tsx, SLATimer.tsx, PriorityGroup.tsx | ~190 |

**Budget check**: ~800 lines total (within 800-line budget, borderline). If overshoot: P4 and P5 each can be trimmed by deferring Sounds tab and gauge strips.

## Testing Strategy

No test runner detected (per `openspec/config.yaml`). Manual verification via browser:

| Area | What to Verify | How |
|------|---------------|-----|
| Metadata API | `GET /api/metadata` returns 6 populated arrays <2s cold | Browser DevTools Network tab |
| Metadata cache | Subsequent hit returns <100ms | Same |
| Assignment timestamps | SSE delta includes `assignmentTimestamps` for changed issues | Console log on delta event |
| FilterBar | All 6 controls intersect correctly | Manual combinations |
| Settings | Tab switch, SLA CRUD, display options applied | UI interaction |
| Visual | All animations run at 60fps via GPU-only properties | DevTools Performance tab, Layers panel |

## Migration / Rollout

No migration required. All additions are backward-compatible: new optional fields (`assignedAt`, `displayOptions`, `assignmentTimestamps`), CSS fallbacks, SSE ignores unknown event fields.

## Open Questions

- [ ] PriorityGroup gauge: solid strip per column header vs gradient between adjacent priorities?
  → Lean toward solid per priority (simpler, matches existing `priorityLabels.color`).
- [ ] Bar timer: should tick marks be static or dynamic (accelerating on WARNING)?
  → Spec says accelerating tick — `--tick-interval` duration shortening via JS.

## Key Learnings

- The existing `Cache<T>` class is generic and reusable; `metadataCache` follows the same pattern with longer TTL.
- Poller's `computeDiff` already iterates all issues; adding assignee detection is O(n) with no extra fetch cost.
- SSE `DeltaPayload` already flexible — adding `assignmentTimestamps` extends without breaking existing clients.
- SettingsPanel is the largest single file (541 lines); restructuring to tabs must avoid state fragmentation between overrides and server config.
