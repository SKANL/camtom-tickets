# Exploration: Dashboard Max Enhancements

> **Change**: `dashboard-max-enhancements`
> **Date**: 2026-07-14
> **Status**: Complete — ready for proposal

---

## Table of Contents
1. [Linear API Capabilities Audit](#1-linear-api-capabilities-audit)
2. [Timer-on-Assign Design](#2-timer-on-assign-design)
3. [Filter Architecture](#3-filter-architecture)
4. [Visual Enhancement Ideas](#4-visual-enhancement-ideas)
5. [Settings Panel Expansion](#5-settings-panel-expansion)
6. [Backend Changes Needed](#6-backend-changes-needed)
7. [File-by-File Impact](#7-file-by-file-impact)
8. [Risks and Mitigations](#8-risks-and-mitigations)

---

## 1. Linear API Capabilities Audit

### Current State

The `linear-client.ts` already fetches a rich set of issue fields in its GraphQL query:

```graphql
query Issues($teamId: ID!, $first: Int!, $after: String) {
  issues(filter: { team: { id: { eq: $teamId } } }, orderBy: updatedAt, first: $first, after: $after) {
    nodes {
      id, identifier, title, description, priority, priorityLabel,
      createdAt, updatedAt, dueDate,
      assignee { id, name, email }
      state { id, name, type }
      labels { nodes { id, name, color } }
      project { id, name }
      team { id, name }
      cycle { id, name }
      estimate
    }
    pageInfo { hasNextPage, endCursor }
  }
}
```

**What's already in the Issue type** (`shared/src/types.ts`): `id`, `identifier`, `title`, `description`, `priority`, `priorityLabel`, `createdAt`, `updatedAt`, `dueDate`, `assignee`, `state`, `labels`, `project`, `team`, `cycle`, `estimate`.

### What's Missing (that the user wants)

| Field / Query | Current Status | Value |
|---|---|---|
| **Issue `url`** | ❌ Not fetched | Direct link to click/open the issue in Linear |
| **Issue `subscribers`** | ❌ Not fetched | Who's watching the issue |
| **Issue `comments` count** | ❌ Not fetched | Conversation activity indicator |
| **Issue `parent` / `children`** | ❌ Not fetched | Sub-task / parent relationship |
| **Projects list** | ❌ No query exists | Needed for project filter dropdown |
| **Teams list** | ❌ No query exists | Needed for team switching |
| **Users list** | ❌ No query exists | Needed for assignee filter |
| **Workflow states list** | ❌ No query exists | Needed for state filter |
| **Issue labels catalog** | ❌ No query exists | Needed for label filter with colors |
| **Cycles list** | ❌ No query exists | Needed for sprint/cycle filter |
| **Issue with `assignee` history** | ❌ Not available | Linear doesn't expose `assignedAt` |

### New GraphQL Queries Required

#### Teams Query
```graphql
query Teams {
  teams { nodes { id, name, key, description, icon } }
}
```

#### Projects Query
```graphql
query Projects($teamId: ID) {
  projects(filter: { team: { id: { eq: $teamId } } }) {
    nodes { id, name, description, color, icon, state, url }
  }
}
```

#### Users Query
```graphql
query Users($teamId: ID) {
  team(id: $teamId) { members { nodes { id, name, email, displayName } } }
}
```

#### Workflow States Query
```graphql
query WorkflowStates($teamId: ID) {
  workflowStates(filter: { team: { id: { eq: $teamId } } }) {
    nodes { id, name, type, color, position }
  }
}
```

#### Issue Labels Query
```graphql
query IssueLabels($teamId: ID) {
  issueLabels(filter: { team: { id: { eq: $teamId } } }) {
    nodes { id, name, color, parent { id, name } }
  }
}
```

#### Cycles Query
```graphql
query Cycles($teamId: ID) {
  cycles(filter: { team: { id: { eq: $teamId } } }) {
    nodes { id, name, number, startsAt, endsAt, completedAt }
  }
}
```

### Additional Issue Fields to Add

```graphql
url                # Direct link - high value for TV click-to-open
comments {         # Count only for bandwidth
  nodes { id }
}
subscribers {
  nodes { id }
}
parent { id, identifier }
children { nodes { id, identifier } }
```

### Rate Limit Impact Assessment

| Query | Frequency | Cost |
|---|---|---|
| Issues poll | Every 30s (1/query) | Already exists |
| Teams | Once on client load, cache server-side | ~1/day |
| Projects | Once on client load, cache server-side | ~1/day |
| Users | Once on client load, cache server-side | ~1/day |
| Workflow States | Once on client load, cache server-side | ~1/day |
| Issue Labels | Once on client load, cache server-side | ~1/day |
| Cycles | Once on client load, cache server-side | ~1/day |

**Total additional cost**: ~6 queries per client cold load, cached server-side with long TTL (5+ min). Well within the 5,000 req/h limit.

### Caching Strategy

Create a separate `metadataCache` (or extend `cache.ts`) for catalog data that has longer TTL (5-30 minutes, or invalidated on manual refresh). Since this data changes infrequently, we can even cache it until the dashboard config changes.

---

## 2. Timer-on-Assign Design

### Problem

Currently, SLA timers compute `deadline = issue.createdAt + slaConfig.maxMinutes`. This means the SLA clock starts ticking the moment a ticket is created in Linear — not when it's actually assigned to a support agent.

The user wants: **SLA timer should start when an issue is ASSIGNED to someone**, not from `createdAt`.

### Challenge

Linear's GraphQL API does **not** expose an `assignedAt` or `firstAssignedAt` field on the `Issue` type. There is no way to query when the assignee was first set.

### Approaches

#### Approach A: Detect assignment in the poller, store assignedAt server-side

The poller already computes a diff between poll cycles. We can detect when an issue transitions from `assignee: null` to `assignee: { id, name }` and:

1. Record the **current server timestamp** as `assignedAt` in a new server-side Map (`assignmentTimestamps: Map<string, number>`)
2. Store this alongside the issues cache
3. Send it to the client as part of the SSE delta or a separate endpoint
4. Client uses `assignedAt` as the SLA start time instead of `createdAt`

**Pros**:
- Works without Linear API changes
- Server timestamp is authoritative
- Survives client refreshes (stored server-side)

**Cons**:
- Doesn't capture assignments that happened before the server started (need initial sync)
- Server restart loses assignment timestamps unless persisted
- Edge case: assigning → unassigning → reassigning (should restart timer?)

**Effort**: Medium

#### Approach B: Use issue `updatedAt` as proxy for assignment time

When the poller detects an assignee change, use the issue's `updatedAt` field (which Linear updates when any field changes) as the assignment time.

**Pros**:
- No extra server-side storage needed
- Survives restarts naturally

**Cons**:
- `updatedAt` may reflect other field changes (title, priority, etc.), not just assignment
- Might be slightly inaccurate if the issue was updated again immediately after assignment

**Effort**: Low

#### Approach C: Use Linear's `Issue` webhooks with `updatedFrom`

If webhooks are enabled, Linear's Issue webhook payload includes `updatedFrom` — the previous values of changed fields. When `updatedFrom.assignee` is `null` or different, we know the assignment changed.

**Pros**:
- Real-time, accurate
- `updatedFrom` gives exact previous state

**Cons**:
- Requires public HTTPS endpoint (same blocker as before)
- More complex setup

**Effort**: High

#### Approach D: Client-side assignment tracking

Send the current assignee state with each poll cycle. The client compares previous vs current assignee. When it detects a null→{id} transition, the client starts the SLA from the time it received the delta event.

**Pros**:
- Simplest implementation
- No server-side storage

**Cons**:
- Lost on page refresh (no persistence of "when was this assigned")
- Client clock used for timer start
- If assignment happened between polls, the time window is approximate

**Effort**: Low

### Recommendation

**Approach A** (server-side assignment timestamp tracking) is the most reliable. The implementation:

1. In `poller.ts`: extend `computeDiff` to also detect assignee changes (`prev.assignee?.id !== current.assignee?.id`)
2. Maintain a `Map<string, { assignedAt: number, previousAssigneeId: string | null }>` in memory
3. When first assignment detected (`prev.assignee === null`), record `Date.now()` as `assignedAt`
4. Include `assignmentTimestamps` in the SSE delta payload (keyed by issue ID)
5. On the client, `useSLA` uses `issue.assignedAt ?? issue.createdAt` as the anchor time

**For server restart recovery**: On initial poll, treat all currently-assigned issues as "assigned now" as a starting point. The first poll after restart stamps all issues with their current assignee as the reference. Assignee changes detected in subsequent polls use the detected timestamp.

---

## 3. Filter Architecture

### Current State

The dashboard shows all issues grouped by priority. There is no filtering beyond priority grouping. `Dashboard.tsx` simply maps `displayOrder` to priority buckets and renders `PriorityGroup` for each.

### Design

Add a **FilterBar** component above the dashboard (or collapsible on the side) with:

| Filter | Type | Source | Implementation |
|---|---|---|---|
| **Project** | Dropdown | `GET /api/projects` → `<select>` | Filter issues where `issue.project?.id === selected` |
| **Assignee** | Dropdown | `GET /api/users` → `<select>` | Filter issues where `issue.assignee?.id === selected` |
| **State** | Multi-select chips | `GET /api/workflow-states` | Filter issues where `issue.state.id` is in selected set |
| **Label** | Multi-select chips with colors | `GET /api/labels` | Filter issues where intersection with selected labels |
| **Priority** | Toggle checkboxes | Already available | Toggle which priority columns show |
| **Text search** | Search input | Client-side | `issue.title` + `issue.identifier` fuzzy match |

### Architecture: Client-Side Filtering

**Rationale**: TV dashboard displays a single team's issues (usually < 200). Client-side filtering avoids:
- Extra server load and API calls
- SSE delta complexity (filtered deltas are much harder)
- State sync issues between server and client

**Data Flow**:
```
Server fetches ALL issues for the team
  → Client receives all issues via SSE
    → FilterBar state (local React state)
      → useMemo to compute filteredIssues
        → Dashboard renders filteredIssues grouped by priority
```

### Filter State Shape

```typescript
interface FilterState {
  projectId: string | null;
  assigneeId: string | null;
  stateIds: Set<string>;
  labelIds: Set<string>;
  visiblePriorities: Set<number>; // default all 1,2,3,4,0
  searchQuery: string;
}
```

### Component Tree

```
App
├── FilterBar (new)
│   ├── ProjectSelect
│   ├── AssigneeSelect
│   ├── StateFilter
│   ├── LabelFilter
│   ├── PriorityToggles
│   └── SearchInput
├── Dashboard (filtered issues passed as props)
│   └── PriorityGroup
│       └── TicketCard
```

### Filter Persistence

- Current filters saved to `localStorage` (like settings overrides)
- Optional: save to server `dashboard.yaml` as default filter state

### Effort: Medium

---

## 4. Visual Enhancement Ideas

### Current State
The dashboard already has a strong Overcooked/fast-food theme:
- CSS custom properties with food color names
- Bangers (display) + Comic Neue (body) fonts
- Dashed borders on ticket cards
- Kitchen badge with rounded pills
- 3D comic shadow style
- Circular SVG kitchen timers
- Bouncy animations (pulseWarning, shakeBreach, bounceIn)
- Kitchen tile background pattern (subtle grid)
- Subtle radial gradient color spots

### Enhancement Opportunities

#### A. Dramatic Siren Effects for WARNING/BREACHED

```css
/* Flashing siren border for breached */
@keyframes sirenBorder {
  0%, 100% { border-color: var(--color-ketchup); box-shadow: 0 0 10px var(--color-ketchup); }
  50% { border-color: #FFD700; box-shadow: 0 0 20px #FFD700; }
}

@keyframes urgentPulse {
  0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(211, 47, 47, 0.7); }
  70% { transform: scale(1.02); box-shadow: 0 0 0 15px rgba(211, 47, 47, 0); }
  100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(211, 47, 47, 0); }
}

/* Progress bar that shifts color as it approaches breach */
@keyframes burntProgress {
  0% { background: var(--color-lettuce); }
  50% { background: var(--color-mustard); }
  100% { background: #3E2723; } /* burnt */
}
```

#### B. New Ticket Arrival Animation

Current `bounceIn` is already solid. Enhance with:
- **CSS glow effect**: `@keyframes arrivalGlow { 0% { box-shadow: 0 0 30px var(--color-tomato); } 100% { box-shadow: var(--shadow-card); } }`
- **Combine with sound**: `cuelume` sparkle sound already plays
- **Priority-1 specific**: Larger, more dramatic entrance (scale from 0.2, bounce twice)

#### C. Urgent Ticket Visual Density

Current urgent tickets already have the red color. Enhance:
- **Pulsing border** on urgent tickets (slow, menacing pulse)
- **Slightly larger card** for urgent (scale 1.05)
- **Priority-1 icon** (fire) should be animated (flickering flame SVG)
- **Background** of urgent cards could be slightly more red-tinted

#### D. Receipt/Order Ticket Aesthetic

The current card already has a tear-line at the bottom. Enhance:
- **Serrated top edge**: CSS `clip-path` with zigzag pattern
- **Receipt paper texture**: Subtle off-white/cream background (but keep dark theme)
- **Vertical receipt lines**: Faint repeating pattern on card sides
- **"Order #"** prefix styling: More prominent identifier, like a ticket stub number

#### E. Kitchen Countdown Timer

Current timer is a circular SVG with arc progress. Enhance:
- **Timer style option**: `circular` (current) vs `bar` (linear progress bar)
- **Kitchen timer visual**: Add tick marks around the circle (like a real kitchen timer)
- **Progress-based color shift**: Gradient from green → yellow → red → dark red as time decreases
- **"Burnt" effect**: As timer approaches breach, card background gets progressively darker / charred-looking via CSS custom property interpolation

#### F. Kitchen Pattern Background

Current background has a subtle tile grid. Enhance:
- **More visible tile pattern**: Increase opacity slightly, consider `repeating-linear-gradient` with a grout-like color
- **Steam/sizzle effect**: CSS pseudo-elements with animation for "hot" ticket groups
- **Temperature gauge strip**: Left edge of each priority column with a gradient from cool (blue) to hot (red) that correlates with priority

#### G. Progress-Based Urgency (Burnt Effect)

```typescript
// In TicketCard.tsx, compute burn level from timer state
const burnLevel = timers?.[0] ? Math.max(0, 1 - (timers[0].remaining / (timers[0].deadline - timers[0].remaining + timers[0].remaining))) : 0;
// Clamp: 0 = fresh, 1 = fully burnt
const cardOpacity = 1 - (burnLevel * 0.15);
const cardSaturation = 100 - (burnLevel * 40);
```

#### H. Sound Integration

Current sounds (via cuelume):
- `sparkle` on new urgent ticket
- `press` on breach
- `success` for Friday report
- `tick` for warning

Enhance:
- **Continuous warning "ticking"**: As timer approaches breach, tick speed increases
- **Siren sound on breach**: Continuous warning sound (not just one-shot `press`)
- **Order-up sound**: When ticket state changes to completed
- **Ambient kitchen sounds**: Subtle background (optional — might get annoying on a TV)

### Effort: High (CSS-heavy, many independent components)

---

## 5. Settings Panel Expansion

### Current Settings in `SettingsPanel.tsx`

| Setting | Storage | Persists? |
|---|---|---|
| Dashboard title | localStorage + PUT /api/config | ✅ Server YAML |
| Polling interval | localStorage + PUT /api/config | ✅ Server YAML |
| SLA window hours | localStorage + PUT /api/config | ✅ Server YAML |
| Team members | localStorage + PUT /api/config | ✅ Server YAML |
| Priority labels & colors | localStorage + PUT /api/config | ✅ Server YAML |
| Kitchen phrases | localStorage + PUT /api/config | ✅ Server YAML |

### New Settings to Add

#### A. SLA Configuration (from UI)

Currently SLA config is only editable by editing `config/sla.yaml` directly. The `PUT /api/config` route already supports `slas` in the body, so the plumbing exists.

**New UI in Settings Panel**:
- For each SLA rule: editable `maxMinutes`, `warningThreshold` sliders, `applicablePriorities` checkboxes
- "Add SLA Rule" button (new row with id, label, maxMinutes, warningThreshold, applicablePriorities)
- "Remove SLA Rule" button (with confirmation)
- Validation: maxMinutes > 0, warningThreshold 0-1

**Effort**: Medium

#### B. Display Options

- **Column order**: Drag-and-drop reordering of priority columns (currently in `dashboard.yaml` as `displayOrder` array). The existing `PUT /api/config` already merges `displayOrder`.
- **Column visibility toggle**: Checkboxes to show/hide each priority column (same as priority toggle filter)
- **Timer visual style**: Select between `circular` (default) and `bar` (linear progress bar). Store in `DashboardConfig`.

**Effort**: Medium

#### C. State Labels Configuration

The `DashboardConfig` already has `stateLabels`. Add a UI section to edit label and icon for each state.

**Effort**: Low

#### D. Theme Customization

- **Primary color palette overrides** (already partial via priority labels)
- **Background pattern toggle** (tile grid on/off)
- **Animation intensity**: `full` / `reduced` / `off`
- **Sound volume control** (not just mute)

**Effort**: Medium

### Settings Panel UI Restructuring

Current panel is a single flat list of sections. For the expanded version, consider:

```
┌─ Dashboard Settings ─────────────────────────┐
│                                              │
│ [General]        [Display]    [SLA] [Sounds] │  ← Tab navigation
│ ──────────────────────────────────────────── │
│                                              │
│ (content for selected tab)                   │
│                                              │
└──────────────────────────────────────────────┘
```

Tab structure:
1. **General**: Title, polling interval, team members
2. **Display**: Column order, visibility, timer style, background pattern, animation intensity
3. **SLA**: Per-rule config, add/remove rules
4. **Labels & Phrases**: Priority labels, state labels, kitchen phrases
5. **Sounds**: Volume, mute default, sound effects on/off per event type

**Effort**: High (significant UI restructuring)

---

## 6. Backend Changes Needed

### New API Endpoints

#### `GET /api/metadata` (Aggregated — recommended)
Returns all catalog data in one endpoint to minimize round-trips:

```typescript
interface MetadataResponse {
  teams: Team[];
  projects: Project[];
  users: User[];
  workflowStates: WorkflowState[];
  labels: IssueLabel[];
  cycles: Cycle[];
}
```

**Pros**: One endpoint, one cache, one fetch on client mount
**Cons**: Larger payload, some data may not be needed immediately

**Effort**: Medium

#### Individual endpoints (alternative)
```
GET /api/teams
GET /api/projects?teamId=<id>
GET /api/users?teamId=<id>
GET /api/workflow-states?teamId=<id>
GET /api/labels?teamId=<id>
GET /api/cycles?teamId=<id>
```

**Pros**: Granular caching, fetch only what's needed
**Cons**: 6 round-trips on client mount, more code

**Recommendation**: Use the aggregated `GET /api/metadata` endpoint with a single new `linear-client.ts` function `fetchAllMetadata()` that queries all catalog data in parallel (concurrent GraphQL requests).

### Modified Routes

#### `PUT /api/config`
Already exists in `routes/config.ts` and supports both `dashboard` and `slas` in the body. The `saveConfig` in `config.ts` already writes SLA updates back to YAML. No changes needed to the route itself — just need the Settings Panel to send SLA data.

#### `GET /api/issues`
Currently returns `{ issues, cached, serverTime }`. May need to also return `assignmentTimestamps` if using Approach A for timer-on-assign.

### New Server Files

| File | Purpose |
|---|---|
| `server/src/routes/metadata.ts` | `GET /api/metadata` — collects all catalog data |
| `server/src/assignment-timestamps.ts` | Module for tracking assignee changes (if Approach A) |
| (extend) `server/src/linear-client.ts` | Add queries for teams, projects, users, etc. |
| (extend) `server/src/cache.ts` | Add metadata cache (longer TTL) or separate MetadataCache |

### SSE Deltas Extension

The SSE `delta` event currently sends `{ added, updated, removed, serverTime }`. For timer-on-assign, extend:

```typescript
interface DeltaPayload {
  added?: Issue[];
  updated?: Issue[];
  removed?: string[];
  serverTime: number;
  // New:
  assignmentTimestamps?: Record<string, number>; // issueId → assignedAt epoch ms
}
```

---

## 7. File-by-File Impact

### Shared Types (`shared/src/types.ts`)

| Change | Details |
|---|---|
| Add `assignedAt?: string` to `Issue` | Optional field for assignment timestamp |
| Add `Team` type | `{ id, name, key, description?, icon? }` |
| Add `Project` type | `{ id, name, description?, color?, icon? }` |
| Add `User` type | `{ id, name, email?, displayName? }` |
| Add `WorkflowState` type | `{ id, name, type, color?, position? }` |
| Add `IssueLabel` type | `{ id, name, color? }` |
| Add `Cycle` type | `{ id, name, number, startsAt?, endsAt? }` |
| Add `MetadataResponse` type | Aggregated response for all catalog data |
| Add `TimerStyle` type | `'circular' \| 'bar'` (for settings) |
| Extend `DashboardConfig` | Optional: `timerStyle`, `animationIntensity`, `filterDefaults` |

### Server Files

#### `server/src/linear-client.ts` ⬆️ Major
- Add `fetchAllMetadata()` function that queries teams, projects, users, workflow states, labels, cycles in parallel
- Add individual query functions (or reuse `executeGraphQL` with different queries)
- Add `fetchIssuesWithAssignees()` variant that also detects assignee changes
- New env vars: `LINEAR_TEAM_ID` (already exists), optionally `LINEAR_ORG_ID` for cross-team queries

#### `server/src/poller.ts` ⬆️ Moderate
- Extend `computeDiff` to detect assignee changes
- Track `previousAssigneeMap: Map<string, { assignee: string | null, updatedAt: string }>`
- Include `assignmentTimestamps` in broadcast delta payload
- On initial poll, stamp all currently-assigned issues with the current time

#### `server/src/cache.ts` ⬆️ Minor
- Add `metadataCache` instance with 300s TTL (or create separate `MetadataCache`)
- Optional: Add persistent assignment timestamp map

#### `server/src/config.ts` ⬆️ Minor
- The `DashboardConfig` type changes (add new optional fields)
- No structural changes needed — dynamic YAML fields are additive

#### `server/src/routes/issues.ts` 🔷 Unchanged
- Still returns cached issues as before
- `assignmentTimestamps` can be sent via SSE, not this route

#### `server/src/routes/config.ts` 🔷 Unchanged
- Already supports `slas` in body — Settings Panel just needs to send it

#### `server/src/routes/events.ts` 🔷 Unchanged
- Still establishes SSE connection

#### `server/src/sse.ts` 🔷 Unchanged
- Already handles generic `broadcast` with any payload shape

#### **NEW** `server/src/routes/metadata.ts`
- `GET /api/metadata` — returns aggregated catalog data
- Fetches from `linear-client.ts` with metadata cache
- Returns `{ teams, projects, users, workflowStates, labels, cycles, serverTime }`

### Client Files

#### `client/src/App.tsx` ⬆️ Moderate
- Create `FilterState` as local state
- Add `FilterBar` component above `Dashboard`
- Pass filtered issues to `Dashboard` instead of raw issues
- Pass assignment timestamps to `useSLA` hook
- Fetch metadata on mount (or through a new `useMetadata` hook)

#### `client/src/components/Dashboard.tsx` ⬆️ Moderate
- Accept `filters` prop and `filteredIssues` instead of raw `issues`
- Apply client-side filtering (project, assignee, state, label, text search)
- Show/hide priority columns based on filter toggles

#### `client/src/components/TicketCard.tsx` ⬆️ Major
- Add "burnt" effect based on timer progress (CSS var interpolation)
- Add siren/pulsing border for breached/warning tickets
- Add receipt-style serrated edges (clip-path)
- Add kitchen timer visual (tick marks, color gradient)
- Support `timerStyle` config (circular vs bar)
- Animate urgent tickets differently (flickering fire icon, pulsing border)
- New arrival animation: glow + bounce for newly added tickets
- Add issue URL for click-to-open in Linear

#### `client/src/components/SLATimer.tsx` ⬆️ Major
- Add `style` prop: `circular` (current) or `bar` (linear progress bar)
- Bar mode: horizontal progress bar with gradient color shift
- Add tick marks around circle in circular mode
- Add "burnt" color gradient interpolation
- Support size variations (larger for urgent)
- Add label animations (shake on breach, pulse on warning)

#### **NEW** `client/src/components/FilterBar.tsx`
- Dropdowns for project, assignee
- Multi-select chips for state, label
- Checkbox toggles for priority visibility
- Text search input with debounce
- "Clear all filters" button
- Filter count badge showing active filter count
- Collapsible (toggle visibility to avoid cluttering the TV view)

#### **NEW** `client/src/hooks/useMetadata.ts`
- Fetches metadata from `GET /api/metadata`
- Caches in localStorage (long TTL)
- Returns `{ teams, projects, users, workflowStates, labels, cycles }`

#### `client/src/hooks/useIssues.ts` ⬆️ Minor
- Accept assignment timestamps from SSE delta payload
- Merge into issue data in `applyDelta`

#### `client/src/hooks/useSLA.ts` ⬆️ Moderate
- Accept `assignedAt` anchor point per issue (either from `issue.assignedAt` or SSE timestamp)
- Use `assignedAt ?? createdAt` as timer start time
- Support timer style preference

#### `client/src/hooks/useSound.ts` ⬆️ Minor
- Add continuous warning tick (accelerating as breach approaches)
- Add siren sound for prolonged breach
- Add order-up sound for completed status change

#### `client/src/components/SettingsPanel.tsx` ⬆️ Major
- Add SLA configuration tab/section
- Add display options (column order, visibility, timer style)
- Add state labels configuration
- Add animation intensity control
- Add timer visual style selector (circular vs bar)
- Restructure into tabbed layout
- Validation for SLA fields

#### `client/src/components/PriorityGroup.tsx` ⬆️ Minor
- Add temperature gauge strip on the left edge
- Show/hide based on filter toggles (already filtered upstream)

#### `client/src/styles/variables.css` ⬆️ Moderate
- Add new CSS variables for burnt colors, siren effects
- Add animation speed variables for accessibility
- Add kitchen pattern variables

#### `client/src/styles/global.css` ⬆️ Moderate
- Enhanced kitchen tile pattern
- Receipt paper texture
- Scrollbar styling improvements

#### `client/src/styles/animations.css` ⬆️ Major
- Add `sirenBorder` keyframe
- Add `arrivalGlow` keyframe
- Add `urgentPulse` keyframe (radar-like pulse)
- Add `burntProgress` keyframe
- Add `flameFlicker` keyframe for urgent icon
- Accelerate existing animations for urgent items

### Config Files

#### `config/dashboard.yaml` ⬆️ Minor
- Add optional `timerStyle: 'circular' | 'bar'`
- Add optional `animationIntensity: 'full' | 'reduced' | 'off'`
- Add optional `filterDefaults` (project, assignee defaults)

---

## 8. Risks and Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Linear rate limit with 6 new queries** | 🟡 Medium | Cache metadata server-side with 5+ min TTL. Only re-fetch on manual refresh or config change. |
| **Timer-on-assign server restart loses timestamps** | 🟡 Medium | Initial poll stamps all currently-assigned issues with current time as fallback. Implement optional JSON file persistence in `config/` dir. |
| **Assignee not assigned before server starts** | 🟢 Low | Acceptable fallback: first poll after restart stamps all as "now". Breached timers recover on next poll. |
| **SSE payload size with assignment timestamps** | 🟢 Low | Only send changed assignments (diff), not full map. Timestamps are small (issueId → epoch). |
| **CSS performance on TV browser** | 🟡 Medium | Test animations on target device early. Prefer GPU-accelerated properties (`transform`, `opacity`). Avoid `box-shadow` animation on many cards. Use `will-change` sparingly. |
| **Sound overload (continuous breach siren)** | 🟡 Medium | Configurable in settings. Auto-mute after N seconds of continuous breach. Respect existing mute toggle. |
| **Filter bar visual clutter on TV** | 🟢 Low | Make filter bar collapsible (toggle in header). Persist collapsed state. Show active filter count badge when collapsed. |
| **UI breaking from new CSS variables** | 🟢 Low | All CSS variable additions are backward-compatible — existing values are defaults. Missing variables fall through gracefully. |
| **YAML config file corruption from UI** | 🟡 Medium | Validate input before writing. Keep last-known-good version in memory as rollback. Show validation errors in Settings Panel. |
| **SLA config in Settings — accidental deletion** | 🟡 Medium | Require confirmation before removing an SLA rule. Show warning if no SLA applies to a priority level. |
| **Dragging column order on TV** | 🟢 Low | Use up/down arrows instead of drag-and-drop for TV remote accessibility. Drag is desktop-only enhancement. |

---

## Approaches Comparison

### For: Timer-on-Assign

| Approach | Reliability | Complexity | Persistence | Recommendation |
|---|---|---|---|---|
| A: Server-side assignment tracking | ✅ High | Medium | ✅ Server memory + file | **✅ RECOMMENDED** |
| B: issue.updatedAt proxy | 🟡 Medium | Low | ❌ None | Acceptable fallback |
| C: Webhook updatedFrom | ✅ High | High | ✅ Server | Over-engineered for LAN |
| D: Client-side tracking | 🟡 Medium | Low | ❌ None | Too fragile |

### For: Metadata API

| Approach | Round-trips | Simplicity | Cache granularity | Recommendation |
|---|---|---|---|---|
| A: Aggregated `/api/metadata` | 1 | ✅ Simple | ❌ All or nothing | **✅ RECOMMENDED** |
| B: Individual endpoints | 6 | ❌ More code | ✅ Per-type | Only if metadata > 500KB |

### For: Filter Architecture

| Approach | Complexity | Freshness | Offline use | Recommendation |
|---|---|---|---|---|
| A: Client-side all-issues | ✅ Simple | ✅ Real-time via SSE | ✅ Cached | **✅ RECOMMENDED** |
| B: Server-side filtered queries | ❌ Complex | 🟡 Polled | ❌ No | Overkill for < 200 issues |

### For: Settings Panel Restructuring

| Approach | UX | Implementation Effort | Recommendation |
|---|---|---|---|
| A: Tabbed layout | ✅ Clean grouping | High | **✅ RECOMMENDED** |
| B: Accordion sections | 🟡 OK | Medium | Acceptable alternative |
| C: Long scroll with categories | 🟡 OK | Low | Quick win but poor UX |

---

## Ready for Proposal

**Yes**. The exploration is comprehensive enough to proceed to `sdd-propose`.

### Summary of Key Decisions

1. **Timer-on-assign**: Approach A — server-side assignment timestamp tracking in poller diff, SSE delta includes `assignmentTimestamps`, client uses `assignedAt ?? createdAt`
2. **Linear API expansion**: Add 6 new GraphQL queries in `linear-client.ts`, serve via aggregated `GET /api/metadata` with 5-min server cache
3. **Filter architecture**: Client-side only — `useMemo` filter chain in `App.tsx` → pass filtered issues to `Dashboard`
4. **Visual enhancements**: Pure CSS with new keyframes and CSS custom property interpolation. NO JavaScript animation libraries.
5. **Settings expansion**: Tabbed layout (General / Display / SLA / Labels / Sounds). SLA rules editable from UI.
6. **Backend**: One new route `/api/metadata`, one new module `assignment-timestamps.ts`, extend `linear-client.ts` and `poller.ts`
7. **Delivery**: This is a large change (~20 files modified, ~5 new files). Recommend chained PRs: PR#1 = backend expansion + metadata API, PR#2 = timer-on-assign + filter architecture, PR#3 = visual enhancements + settings expansion.

### Estimated Effort

| Layer | Files | Effort |
|---|---|---|
| Shared types | 1 (+ 4 new types) | Low |
| Backend (new) | 1 (metadata route) + 3 extended files | Medium |
| Backend (timer-assign) | 2 extended files (poller, linear-client) | Medium |
| Client (filter bar) | 1 new component + 3 modified | Medium |
| Client (visual) | 5 modified components + 3 CSS files | High |
| Client (settings) | 1 modified component | High |
| Testing | ~5 new test files | Medium |

**Total**: 20-25 files, ~2000-3000 changed lines. Recommend **3 chained PRs**.
