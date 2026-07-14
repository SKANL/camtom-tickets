# Design: Dashboard Refined View

**Change**: `dashboard-refined-view`
**Project**: camtom-tickets
**Stack**: Node.js/Express + React/Vite SPA + Linear GraphQL API
**Date**: 2026-07-14

---

## 1. Architecture Decisions

### AD1: State Name Matching via Case-Insensitive Substring

**Decision**: Resolve default `excludeStates` IDs by matching workflow state names against "Done" and "Pull Request Sent" using case-insensitive substring matching (`name.toLowerCase().includes(keyword)`).

**Rationale**: State IDs are Linear workspace-specific and cannot be hardcoded. Name matching is the most portable approach — it works across workspaces without configuration. Case-insensitive substring matching tolerates minor naming variations (e.g., "Pull Request Sent" vs "PR Sent" vs "pull request sent").

**Tradeoff**: If a workspace renames "Done" to "Completed" or "Pull Request Sent" to "In Review", the name match fails and defaults are not applied. Mitigated by: (a) substring matching catches partial names, (b) users can manually filter via FilterBar once excludeStates gains UI controls.

### AD2: Non-Blocking Startup Probe with Existence Check

**Decision**: Add a lightweight startup probe in `server/src/index.ts` that runs asynchronously after `startPolling()`. The probe calls `fetchLabels()` to check for the "ticket" label, creates it only if missing. Wrapped in `try/catch` — any failure is logged but does not block server startup.

**Rationale**: Following the TV-dashboard "just works" ethos — zero manual setup. The existence check + create pattern is idempotent: on restart, the probe sees the label exists and does nothing. Non-blocking ensures the server is available immediately even if the Linear API is slow or unreachable.

**Tradeoff**: Adds ~1-2 RTT to background startup activity. The label may not exist in the first metadata fetch (client-side grace period). Mitigated by graceful degradation: if the label doesn't exist, the default `labels` filter is `[]` and all tickets pass the label filter.

### AD3: Two-Phase Default Resolution with localStorage Merge

**Decision**: Apply default filter values in a `useEffect` that runs when `metadata` resolves, merging resolved defaults with current filter state. A `useRef` guard prevents re-application after the first resolution.

- Phase 1 (mount): Initialize `FilterState` with all-empty arrays including `excludeStates: []`
- Phase 2 (metadata ready): Resolve default IDs, merge with current state:
  - `excludeStates`: apply defaults if currently empty AND IDs resolved
  - `labels`: apply "ticket" label default if currently empty AND label exists in metadata

**Rationale**: Metadata is loaded asynchronously (localStorage cache or network fetch), so default IDs cannot be resolved at mount time. The two-phase approach ensures defaults are applied as soon as metadata is available, without clobbering any user-set values from localStorage.

### AD4: Exclusion as Separate Filter Chain Step

**Decision**: Add `excludeStates` filtering as a new step in the `useMemo` filter chain, positioned immediately after the `states` include filter. The exclusion step runs independently and always applies — if a ticket's state is in `excludeStates`, it is removed regardless of inclusion.

**Rationale**: DF4 requires exclusion to win over inclusion. A separate step after inclusion maintains clarity and enables independent toggling. Placing it after the include filter means the include pass can narrow the set, and the exclude pass can carve out specific states from the remaining results.

---

## 2. Technical Approach per Capability

### 2.1 Dashboard Filters — Default Filter Behavior

#### Files Changed

| File | Change |
|------|--------|
| `shared/src/types.ts` | Add `excludeStates: string[]` to `FilterState` |
| `client/src/App.tsx` | Two-phase default resolution + exclusion filter step |
| `client/src/components/FilterBar.tsx` | Update `emptyFilter()`, `loadFilter()`, `countActive()` for new field |

#### Type Change

```typescript
// shared/src/types.ts
export interface FilterState {
  projects: string[];
  assignees: string[];
  states: string[];        // include filter
  labels: string[];
  priorities: number[];
  textSearch: string;
  excludeStates: string[];  // NEW: exclude filter (wins over include)
}
```

#### Default Resolution Flow

```
App mount
  │
  ├─ Phase 1: useState({ ...allEmpty, excludeStates: [] })
  │
  ├─ FilterBar mount → loadFilter() from localStorage
  │   │
  │   └─ if saved filter has active values → onChange(saved)
  │      (saved filter won't have excludeStates yet → defaults to [])
  │
  ├─ useMetadata() fetches /api/metadata
  │   │
  │   ├─ localStorage cache hit (fresh) → immediate catalog
  │   └─ network fetch → catalog
  │
  └─ Phase 2: useEffect [metadata] runs
      │
      ├─ Resolve "Done" state ID:
      │   metadata.workflowStates.find(s => s.name.toLowerCase().includes('done'))
      │
      ├─ Resolve "Pull Request Sent" state ID:
      │   metadata.workflowStates.find(s => s.name.toLowerCase().includes('pull request'))
      │
      ├─ Resolve "ticket" label ID:
      │   metadata.labels.find(l => l.name.toLowerCase() === 'ticket')
      │
      └─ Merge with current filter state:
          │
          ├─ excludeStates: if current === [] AND resolved IDs exist → set resolved IDs
          ├─ labels: if current === [] AND ticket label resolved → set [ticketLabelId]
          └─ Mark defaultsAppliedRef = true (no re-application)
```

#### Filter Chain (Updated)

```
Raw issues
  │
  ├─ [1] Priority include
  ├─ [2] Project include
  ├─ [3] State include  (existing)
  ├─ [4] EXCLUDE by excludeStates  ← NEW: runs after state include, independent
  ├─ [5] Assignee include
  ├─ [6] Label include
  └─ [7] Text search
       │
       └─ filteredIssues → Dashboard
```

**Key behavior**: Step 4 checks `filter.excludeStates` independently. A ticket whose state is in `excludeStates` is removed even if its state also matches `filter.states`. Exclusion takes precedence.

```typescript
// Exclusion step in App.tsx useMemo
if (filter.excludeStates.length > 0) {
  result = result.filter((i) => !filter.excludeStates.includes(i.state.id));
}
```

#### FilterBar Compatibility

The `emptyFilter()` function gains the new field. The `loadFilter()` function spreads parsed values over an `emptyFilter()` base to handle old saved filters that lack `excludeStates`:

```typescript
function loadFilter(): FilterState {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return emptyFilter();
    const parsed = JSON.parse(raw);
    return { ...emptyFilter(), ...parsed };  // ← merge ensures excludeStates: []
  } catch {
    return emptyFilter();
  }
}
```

The `countActive()` function does NOT count `excludeStates` as an active filter — it's an invisible default, not a user-facing control.

### 2.2 Linear Label Management — Auto-Provisioning

#### Files Changed

| File | Change |
|------|--------|
| `server/src/linear-client.ts` | Add `createLabel` GQL mutation, `ensureLabel()` helper |
| `server/src/index.ts` | Add non-blocking startup probe after poller |

#### GraphQL Mutation

```graphql
mutation IssueLabelCreate($name: String!, $color: String) {
  issueLabelCreate(input: { name: $name, color: $color }) {
    success
    issueLabel {
      id
      name
      color
    }
  }
}
```

#### `ensureLabel` Helper

```
ensureLabel(name: string): Promise<boolean>
  │
  ├─ 1. Call fetchLabels() → get existing labels
  ├─ 2. Search for case-insensitive match by name
  │     │
  │     ├─ Found → return true (existed)
  │     └─ Not found → proceed to create
  │
  ├─ 3. Call createLabel(name) mutation
  │     │
  │     ├─ Success → return true
  │     └─ Failure → throw (caught by caller)
  └─ 4 (implicit): Linear handles dedup at API level too
```

#### Startup Probe Sequence

```
start()
  │
  ├─ loadConfig()
  ├─ watchConfig()
  ├─ startPolling()
  │     │
  │     ├─ sseManager.startHeartbeat()
  │     ├─ pollOnce() immediately
  │     └─ setInterval(pollOnce, interval)
  │
  ├─ app.listen(PORT)  ← server is already accepting requests
  │
  └─ NON-BLOCKING PROBE (async, no await)
        │
        └─ try {
        │     const ok = await ensureLabel('ticket');
        │     if (ok) log('"ticket" label is ready');
        │   } catch (err) {
        │     log.warn('Failed to ensure label:', err.message);
        │   }
        │   // Server continues regardless
```

#### Sequence Diagram: Label Creation Startup Probe

```
┌──────────┐    ┌──────────────┐    ┌───────────┐    ┌──────────┐
│ index.ts │    │ linear-client│    │ Linear API│    │ metadata │
│ (server) │    │              │    │           │    │  cache   │
└────┬─────┘    └──────┬───────┘    └─────┬─────┘    └────┬─────┘
     │                 │                  │               │
     │ start()         │                  │               │
     │─────▶           │                  │               │
     │                 │                  │               │
     │ startPolling()  │                  │               │
     │─────▶           │                  │               │
     │                 │                  │               │
     │ app.listen()    │                  │               │
     │─────▶           │                  │               │
     │                 │                  │               │
     │ (async)         │                  │               │
     │ ensureLabel()   │                  │               │
     │────────────────▶│                  │               │
     │                 │                  │               │
     │                 │ fetchLabels()    │               │
     │                 │─────────────────▶│               │
     │                 │   labels[]       │               │
     │                 │◀─────────────────│               │
     │                 │                  │               │
     │                 │ [check: "ticket" │               │
     │                 │  exists? → No]   │               │
     │                 │                  │               │
     │                 │ createLabel()    │               │
     │                 │─────────────────▶│               │
     │                 │   { success }    │               │
     │                 │◀─────────────────│               │
     │                 │                  │               │
     │   true          │                  │               │
     │◀────────────────│                  │               │
     │                 │                  │               │
     │ [later]         │                  │               │
     │ GET /api/metadata│                 │               │
     │───────────────────────────────────────────────────▶│
     │                 │                  │               │
     │                 │   fetchLabels()  │               │
     │                 │   (now includes  │               │
     │                 │    "ticket")     │               │
     │                 │                  │               │
```

**Note**: There is a small window between label creation and metadata cache refresh where the client's `useMetadata` won't see the "ticket" label. This is acceptable — the client gracefully falls back to `labels: []` (no label filter) until the next metadata refresh. On the first metadata fetch after label creation, the "ticket" label appears and the default kicks in.

### 2.3 Ticket Card — Refined Layout

#### Files Changed

| File | Change |
|------|--------|
| `client/src/components/TicketCard.tsx` | Full layout restructure |
| `client/src/components/Icons.tsx` | Add `IconPerson` component |

#### Component Layout (Element Order)

```
┌─────────────────────────────────────┐
│ [●] URGENT         [✓] Done        │ ← Priority dot + label, State icon + label
│─────────────────────────────────────│
│ Auth failure in production          │ ← TITLE: var(--text-lg), var(--font-display)
│ (wraps naturally, max 3 lines)      │   topmost text element, 3-line clamp
│─────────────────────────────────────│
│ TICK-42                             │ ← IDENTIFIER: var(--text-xs), secondary color
│   ─────────────────────────────     │   clickable link to Linear
│ [bug][auth][high]                   │ ← LABELS: color-coded pills (max 3 + overflow)
│─────────────────────────────────────│
│ 🧑 Alice                           │ ← ASSIGNEE: person icon + name
│                                     │   HIDDEN if unassigned (no vertical space)
│─────────────────────────────────────│
│  ⏱ Responder  ⏱ Resolver          │ ← TIMERS (if any)
│  ████████████  ████████            │
│─────────────────────────────────────│
│ ════════════════════════════════════│ ← Decorative clip-path bottom
└─────────────────────────────────────┘
```

#### Layout Changes Summary

| Element | Current | Target |
|---------|---------|--------|
| **Title** | `var(--text-sm)`, 2-line clamp, below identifier | `var(--text-lg)`, 3-line clamp, **topmost text** |
| **Identifier** | `var(--text-xl)`, prominent, top of card | `var(--text-xs)`, below title, secondary |
| **Assignee** | `chefHat` icon + name or "Unassigned" | `person` icon + name only; **hidden if unassigned** |
| **Person icon** | `chefHat` (thematic, cooking) | New `IconPerson` (standard user silhouette) |
| **Clickable link** | Wraps priority+state+identifier | Wraps only identifier |

#### Assignee Display Logic

```tsx
{issue.assignee && (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--text-xs)' }}>
    <IconPerson size={14} />
    <span>{issue.assignee.name}</span>
  </div>
)}
```

Condition: render only when `issue.assignee` is truthy. No "Unassigned" text, no empty placeholder div.

---

## 3. Data Flow: Default Resolution When Metadata Loads

```
  ┌──────────────────┐
  │ App renders       │  filter = { allEmpty, excludeStates: [] }
  └────────┬─────────┘
           │
  ┌────────▼─────────┐
  │ FilterBar mounts  │  reads localStorage → onChange(saved)
  └────────┬─────────┘
           │
  ┌────────▼─────────┐
  │ useMetadata       │  async fetch /api/metadata
  │ returns catalog   │
  └────────┬─────────┘
           │
  ┌────────▼─────────────────────────────────────┐
  │ useEffect [metadata] — defaultsAppliedRef?   │
  │                                              │
  │ if false:                                    │
  │   doneId = workflowStates                     │
  │     .find(s => name.includes('done'))?.id     │
  │   prId = workflowStates                       │
  │     .find(s => name.includes('pull request'))?│
  │   excludeIds = [doneId, prId].filter(Boolean) │
  │   ticketLabelId = labels                      │
  │     .find(l => name === 'ticket')?.id         │
  │                                              │
  │   setFilter(prev => ({                        │
  │     ...prev,                                  │
  │     excludeStates: prev.excludeStates.length  │
  │       ? prev.excludeStates                    │
  │       : excludeIds,                           │
  │     labels: prev.labels.length                │
  │       ? prev.labels                           │
  │       : ticketLabelId ? [ticketLabelId] : [], │
  │   }))                                         │
  │   defaultsAppliedRef = true                   │
  └──────────────────────────────────────────────┘
           │
  ┌────────▼─────────┐
  │ useMemo filter    │  applies new excludeStates,
  │ chain recomputes  │  labels defaults with rest
  └──────────────────┘
```

### Edge Cases Handled

1. **Metadata not yet loaded**: `excludeStates: []` — no exclusion, all tickets visible
2. **No matching states**: `excludeStates: []` — graceful degradation
3. **Metadata fetch fails**: stale cache or `null` catalog — defaults not applied, `defaultsAppliedRef` stays `false`, retries on next metadata refresh cycle (5min)
4. **User has saved `labels: ["custom-id"]`**: `prev.labels.length > 0` → not replaced
5. **Label creation race**: label exists in Linear but not yet cached → metadata doesn't have it → `labels: []` → next metadata refresh picks it up → default applied

---

## 4. Filter Chain Changes Detail

### Current Filter Chain

```
issues → priority filter → project filter → state filter → assignee filter → label filter → text search → filteredIssues
```

### New Filter Chain

```
issues → priority → project → state (include) → EXCLUDE STATES → assignee → label → text search → filteredIssues
                                                                  ↑
                                                            NEW STEP
```

### Code Change in App.tsx

The existing `useMemo` block gains a new step after the state include filter:

```typescript
// Existing: State filter (include)
if (filter.states.length > 0) {
  result = result.filter((i) => filter.states.includes(i.state.id));
}

// NEW: Exclusion step — removes tickets whose state is in excludeStates
// Exclusion wins over inclusion (DF4)
if (filter.excludeStates.length > 0) {
  result = result.filter((i) => !filter.excludeStates.includes(i.state.id));
}
```

### Behavior Matrix

| States filter | excludeStates filter | Result for ticket in Done |
|--------------|---------------------|--------------------------|
| `[]` (none) | `[]` (none) | Included |
| `[]` (none) | `[doneId]` | Excluded |
| `[doneId, startedId]` | `[]` (none) | Included |
| `[doneId, startedId]` | `[doneId]` | **Excluded** (exclusion wins) |
| `[startedId]` | `[doneId]` | Excluded (Done not in include filter either) |

---

## 5. Component Layout: TicketCard Refactor

### Element Order (Top to Bottom)

```
┌─ priorityRow ─────────────────────────────────┐
│  [● PriorityName]           [↕ StateLabel]    │ ← row, flex, space-between
├───────────────────────────────────────────────┤
│  Title text (var(--text-lg), var(--font-display)) │ ← TITLE, 3-line clamp
├───────────────────────────────────────────────┤
│  #TICK-123 (var(--text-xs), clickable link)   │ ← IDENTIFIER, below title
├───────────────────────────────────────────────┤
│  [bug] [auth] [high]  +2                      │ ← LABELS (if any)
├───────────────────────────────────────────────┤
│  🧑 Alice                                     │ ← ASSIGNEE (only if assigned)
├───────────────────────────────────────────────┤
│  ⏱ Responder  ⏱ Resolver                     │ ← TIMERS (if any)
├───────────────────────────────────────────────┤
│  ═══════ clip-path decorative bottom ════════ │
└───────────────────────────────────────────────┘
```

### CSS/Visual Changes

- Title: `fontSize: 'var(--text-lg)'`, `fontFamily: 'var(--font-display)'`, `lineHeight: 1.3`, `display: '-webkit-box'`, `WebkitLineClamp: 3`, `minHeight: '3.9em'`
- Identifier: `fontSize: 'var(--text-xs)'`, `color: 'rgba(255,255,255,0.5)'`, `fontFamily: 'var(--font-mono)'` (optional)
- Assignee: render only when `issue.assignee` is truthy. `IconPerson` with `size={14}`

### Person Icon

New SVG icon `IconPerson` added to `Icons.tsx`:

```tsx
export function IconPerson({ size = 24, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width={size} height={size} className={className}>
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
    </svg>
  );
}
```

---

## 6. Testing Approach

### Unit Tests

| Area | Test | What to Verify |
|------|------|---------------|
| **Default resolution** | Match "Done" state name | Case-insensitive substring returns correct ID |
| **Default resolution** | Match "Pull Request Sent" state name | Substring "pull request" catches it |
| **Default resolution** | No match case | `excludeStates` remains `[]` |
| **Default resolution** | Ticket label match | Exact case-insensitive match returns correct ID |
| **Default resolution** | No ticket label | `labels` remains `[]` |
| **localStorage merge** | Old saved filter lacks `excludeStates` | `loadFilter()` returns `excludeStates: []` |
| **localStorage merge** | User has saved labels | Default ticket label does NOT override |
| **Filter chain** | Exclusion removes matching states | Ticket with `state.id` in `excludeStates` is removed |
| **Filter chain** | Exclusion wins over inclusion | Ticket in both `states` and `excludeStates` is excluded |
| **Filter chain** | Empty excludeStates | All tickets pass |
| **ensureLabel** | Label exists | Returns true, no mutation sent |
| **ensureLabel** | Label missing | Creates label, returns true |
| **ensureLabel** | API failure | Throws error |
| **TicketCard** | Assigned ticket | Person icon + name rendered |
| **TicketCard** | Unassigned ticket | No assignee element rendered at all |
| **TicketCard** | Title is topmost text | Title renders above identifier |
| **TicketCard** | Identifier size | Smaller than title font size |

### Integration Tests

| Scenario | Steps | Expected |
|----------|-------|----------|
| Server starts with label | Start server, check Linear API | No duplicate label created |
| Server starts without label | Delete "ticket" label, restart | Label is created |
| Metadata includes defaults | Load dashboard | Done/PRS tickets hidden, ticket label filter active |
| User clears filters | Click "Clear all" | All tickets visible, defaults overridden for session |
| Second load after clear | Refresh page | Defaults re-applied (exclude states active again) |

### Visual/Manual Testing

- Verify ticket card layout visually across dashboard widths (min 240px, max 340px, responsive)
- Verify long titles wrap correctly, identifier stays aligned
- Verify unassigned cards have no gap or artifact in assignee area
- Verify default exclude states correctly hides Done and Pull Request Sent tickets
- Verify old saved filters in localStorage don't break on upgrade

---

## 7. Rollback Strategy

### Immediate Rollback

```bash
git revert <merge-commit-hash>
```

No data migration needed — all changes are additive:
- `excludeStates` field in `FilterState` — old client code ignores unknown fields
- "ticket" label in Linear — persists as orphan metadata (harmless, no functional impact)
- FilterBar saved filter with `excludeStates` — old code's `loadFilter()` reads it but doesn't use it

### Reverse Deployment Steps

1. Revert the merge commit
2. Rebuild: `npm run build`
3. Restart server and client
4. Verify: Done tickets reappear on dashboard (pre-change behavior)

### State Cleanup

No cleanup of the "ticket" label in Linear is required — it is harmless orphan metadata. If desired, delete manually via Linear UI.

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| State name mismatch across workspaces | Low | Default exclude fails | Substring + case-insensitive matching; manual override path |
| Label creation race with metadata cache | Medium | Brief window without label default | Graceful fallback: no label filter until next metadata refresh |
| localStorage filter conflict | Medium | User labels overridden | Empty-check merge preserves user-set values |
| Linear API key lacks mutation perms | Low | Label creation fails | Startup probe wrapped in try/catch, degrades gracefully |
| TicketCard layout regression | Low | Visual confusion | Keep identifier visible (just smaller), test across viewports |
| Backward compat: old saved filters | Low | Missing `excludeStates` field | `loadFilter()` merges parsed values over `emptyFilter()` base |

---

## 9. Implementation Order

Recommended implementation sequence (each step independently testable):

1. **Types**: Add `excludeStates` to `FilterState` in `shared/src/types.ts`
2. **Linear mutations**: Add `createLabel` + `ensureLabel` in `linear-client.ts`
3. **Startup probe**: Wire `ensureLabel('ticket')` in `server/src/index.ts`
4. **Filter defaults**: Add two-phase default resolution in `App.tsx`
5. **Filter chain**: Add exclusion step in `useMemo`
6. **FilterBar compat**: Update `emptyFilter()`, `loadFilter()` for new field
7. **TicketCard**: Restructure layout, add `IconPerson`
8. **Build & test**: `npm run build`, manual verification, unit tests
