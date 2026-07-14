# Exploration: TV Ticket Dashboard

> **Change**: `ticket-dashboard`
> **Date**: 2026-07-14
> **Status**: Complete

## 1. Linear GraphQL API Research

### Priority Levels

| Value | Label | Color |
|-------|-------|-------|
| 0 | No priority | Gray |
| 1 | Urgent | Red (#F97316) |
| 2 | High | Orange (#EAB308) |
| 3 | Medium | Blue (#3B82F6) |
| 4 | Low | Green (#22C55E) |

Priority is an integer field on the `Issue` type. There's also a `priorityLabel` field returning the string name. Filtering uses comparators: `eq`, `neq`, `in`, `nin`, `lt`, `lte`, `gt`, `gte`.

### Issue Type — Key Fields for the Dashboard

```
Issue {
  id: String!
  identifier: String!         # e.g. "ENG-123"
  title: String!
  description: String
  priority: Int!              # 0-4
  priorityLabel: String!      # "No priority" | "Urgent" | "High" | "Medium" | "Low"
  createdAt: DateTime!
  updatedAt: DateTime!
  dueDate: DateTime
  completedAt: DateTime
  startedAt: DateTime
  canceledAt: DateTime
  archivedAt: DateTime
  assignee: User
  creator: User
  state: WorkflowState { id, name, type }
  team: Team { id, name, key }
  labels: [IssueLabel]
  comments(filter): [Comment]
  url: String!                # Direct link to issue
}
```

### Pagination

Relay-style cursor-based pagination. Default page size: 50. Max: 250.
- `first`/`after` for forward pagination
- `last`/`before` for backward pagination
- Response includes `pageInfo { hasNextPage, endCursor }`

### Filtering

Comparators: `eq`, `neq`, `in`, `nin`, `lt`, `lte`, `gt`, `gte`, `contains`, `startsWith`, `containsIgnoreCase`
Logical: AND by default within a filter object, OR via `or: [...]`

Example — fetch unprioritized issues excluding None:
```graphql
issues(filter: { priority: { lte: 2, neq: 0 } }) { nodes { id title priority } }
```

### Rate Limiting

| Limit | Per | Auth |
|-------|-----|------|
| 5,000 requests | hour | API key |
| 3,000,000 complexity points | hour | API key |
| 100,000 complexity points | hour | Unauthenticated |

**Leaky bucket** algorithm. Headers: `X-RateLimit-Requests-Limit`, `X-RateLimit-Requests-Remaining`, `X-RateLimit-Requests-Reset` (UTC epoch ms).

Response code on limit: `RATELIMITED` in `errors[].extensions.code`.

**Linear explicitly discourages polling** — recommends webhooks instead.

### Webhooks Available

Events: `Issue` (create/update/remove), `Comment`, `Project`, `Cycle`, `IssueLabel`, `Issue SLA`

Issue SLA webhook has `breaching` and `breached` event types — relevant for the SLA timer feature.
Payload includes: `action`, `type`, `data` (full issue snapshot), `actor`, `url`, `updatedFrom` (previous values on update).

Webhook requires a **public HTTPS endpoint** — a constraint for local-office deployments. Mitigations: ngrok tunnel, polling fallback, or a local webhook relay.

### Key Takeaways

- **Use `orderBy: updatedAt`** for efficient polling — get recently changed issues first
- **Use webhooks** for real-time updates instead of polling (but may need tunnel for dev)
- **Filter by team** to scope to the support team's tickets
- **Priority is 0-4** (not 1-5), map accordingly: 1=Urgent is the highest

---

## 2. Library Research

### cuelume (Web Audio interaction sounds)

- **GitHub**: Danilaa1/cuelume (MIT, 159 stars)
- **Type**: Curated sound palette — 10 synthesized sounds via Web Audio API
- **Sounds**: chime, sparkle, droplet, bloom, whisper, tick, press, release, toggle, success
- **Zero dependencies**, no audio files
- **API**: Declarative via `data-cuelume-*` attributes OR imperative via `play("success")`
- **Control**: `setEnabled(true/false)` for mute toggle
- **SSR-safe**, automatic suspended-AudioContext handling
- **Framework-agnostic** — works with vanilla HTML, React, Vue, Svelte
- **Sounds are data-driven**: `play("success")` can be called programmatically, not just from DOM events — perfect for SLA timer expirations, ticket updates, etc.

### boneyard-js (Skeleton loading)

- **npm**: boneyard-js v1.9.0 (MIT, 6K stars)
- **Type**: Pixel-perfect skeleton loading screens extracted from real DOM
- **How it works**: Wrap components in `<Skeleton>`, run `npx boneyard-js build` → headless browser snapshots layout → generates `.bones.json` → runtime imports registry
- **Framework adapters**: React, Vue, Svelte 5, Angular, Preact, React Native
- **Vite plugin** available for auto-capture on HMR
- **No runtime scanning** — zero overhead in production
- **Key constraint**: Requires a running dev server to capture bones. For a brand-new project, the skeleton must exist in the real UI first, then bones are extracted.
- **Since we're building from scratch**: We'd scaffold the UI, run the CLI to capture bones, then import the registry.

### reicon + reicon-mcp (Icons)

**reicon** (frontend library):
- 2,700+ handcrafted SVG icons, MIT license
- Packages: `reicon` (vanilla JS), `reicon-react`, `reicon-vue`, `reicon-svelte`
- **CDN/web component**: `<script src="https://unpkg.com/reicon/cdn/reicon.min.js">` + `<re-icon icon="home">`
- Two weights: Outline, Filled
- Zero dependencies, tree-shakeable

**reicon-mcp** (for AI agent use):
- `npx reicon-mcp` — MCP server that lets AI agents search icons, preview SVGs, and generate framework-specific icon code
- **NOT a frontend dependency** — it's a tool for the AI agent (this one!) to find and include the right icons during development
- For the frontend, we use the `reicon` vanilla JS package (or CDN) directly

### Sound Autoplay Restriction

Browsers block `AudioContext` before user interaction. cuelume handles this internally — it silently resumes the context on first user gesture. For a TV dashboard running fullscreen without user interaction:
- **Mitigation**: The dashboard can start in a "muted" state, with a visible "Enable Sounds" button on the splash screen
- Or use the imperative `play()` only after the first user click on the page (TV dashboard likely has remote control interaction)

---

## 3. Architecture Approaches Comparison

| Criteria | **A: Express + Vanilla JS** | **B: Express + React** | **C: Static + Client-side API key** | **D: Next.js/Nuxt (SSR)** |
|---|---|---|---|---|
| **Security** | ✅ API key on server only | ✅ API key on server only | ❌ API key exposed in browser | ✅ API key on server |
| **Complexity** | Low | Medium | Low | High |
| **Bundle size** | Minimal | Medium (React runtime) | Minimal | Medium/High |
| **boneyard-js** | ❌ No vanilla adapter | ✅ React adapter | ❌ No vanilla adapter | ✅ React adapter |
| **reicon icons** | ✅ CDN/web component | ✅ reicon-react | ✅ CDN | ✅ reicon-react |
| **cuelume** | ✅ Works everywhere | ✅ Works everywhere | ✅ Works everywhere | ✅ Works everywhere |
| **Real-time updates** | ✅ Server-sent events | ✅ Server-sent events | ❌ Direct polling from browser | ✅ Server-sent events |
| **Caching** | ✅ Express in-memory cache | ✅ Express in-memory cache | ❌ No cache layer | ✅ API routes with cache |
| **Dev speed** | Fast | Medium (JSX build step) | Fastest | Slowest (full framework) |
| **TV browser compat** | ✅ Highest | ✅ Good | ✅ Highest | ✅ Good |
| **Build tooling** | Vite (vanilla) | Vite (React) | None needed | Next.js/Nuxt |
| **Maintenance** | Simple | Standard | Risky | Overengineered |
| **Scaffold time** | 1-2 days | 2-3 days | 1 day | 3-5 days |

### Recommendation: **Approach B — Express + React** (with Vite)

**Why React over Vanilla**:
1. **boneyard-js requires a framework adapter** — React is the most mature option; vanilla JS is not supported
2. **cuelume works everywhere**, no framework preference
3. **reicon-react** gives tree-shakeable imports vs CDN's on-demand fetching
4. **React's declarative model** fits well for a real-time updating dashboard with timers
5. **Vite's dev server** with HMR is ideal for rapid TV UI iteration

**Why not Next.js (D)**:
- We don't need SSR — this is a LAN-only TV dashboard
- No SEO requirements
- Extra complexity without benefit
- The server is purely an API proxy/cache, not a full web framework

**Why not Approach C**:
- API key exposure is a real risk, especially for a TV that might be photographed or accessible
- No caching layer means hitting rate limits faster
- Linear explicitly discourages polling and recommends server-side webhooks

---

## 4. Data Flow Architecture

```
┌─────────────┐     ┌────────────────────────────────────┐     ┌──────────────┐
│   Linear    │◄────│      Express Backend (Node.js)      │◄────│   Browser    │
│  GraphQL    │     │                                    │     │   (TV/React) │
│    API      │     │  /api/issues    ← polls every 30s   │     │              │
│             │     │  /api/config    ← config endpoint   │     │  Dashboard   │
│             │     │  /api/events    ← SSE stream        │     │  Component   │
│             │     │  /webhooks/linear ← webhook receiver │     │              │
└─────────────┘     └────────────────────────────────────┘     └──────────────┘
                           │
                    ┌──────┴──────┐
                    │   Cache     │
                    │  (In-mem)   │
                    └─────────────┘
```

### Polling strategy
- **Interval**: 30 seconds (well within 5,000 req/h — that's 120 req/h per client)
- **Filter**: `issues(filter: { team: { id: { eq: "..." } } }, orderBy: updatedAt, first: 50)`
- **Delta detection**: Compare `updatedAt` timestamps, only push new/changed issues to SSE clients
- **SSE (Server-Sent Events)**: Backend pushes updates to browser clients — one backend poll serves N browser tabs

### Webhook fallback (for real-time)
- Backend exposes `/webhooks/linear` endpoint
- In production, would need a public HTTPS URL (ngrok for dev, or use polling-only for LAN)
- Webhook payload includes SLA breach events natively

### Cache design
- In-memory Map: `Map<issueId, { data, cachedAt, etag }>`
- TTL: 60 seconds (serves as deduplication buffer)
- When SSE client connects, full data dump is sent; subsequent messages are deltas

---

## 5. SLA Timer Architecture

### Where timers live

**Client-side calculation** — the browser computes elapsed time from `createdAt` + configurable limit:

```
SLA Deadline = issue.createdAt + slaConfig[priority].maxResponseTime
Remaining = SLA Deadline - Date.now()
Status = remaining > 0 ? "OK" : "BREACHED" | "WARNING" (< 20% remaining)
```

**Rationale**:
- No server-side timers needed — avoids socket overhead and state sync issues
- Browser `setInterval` is sufficient for a TV display (update every second)
- Config is fetched once from `/api/config` and cached in localStorage
- Survives page refreshes natively

### Configuration model (dynamic, not hardcoded)

```yaml
# config/sla.yaml — loaded by backend at startup, editable via UI
slas:
  responder_usuario:
    label: "Responder al usuario"
    priority: [1, 2]          # Applies to Urgent and High
    maxMinutes: 5
    warningThreshold: 0.2      # 20% of time remaining = WARNING
  recuperar_usuario:
    label: "Recuperar usuario"
    priority: [1, 2, 3]
    maxMinutes: 10             # 5 + 5 (cumulative)
    dependsOn: responder_usuario
  avisar_equipo:
    label: "Avisar al equipo"
    priority: [1]
    maxMinutes: 10
  resolver_iniciar:
    label: "Resolver — Iniciar"
    priority: [1, 2]
    maxMinutes: 10
    stateTrigger: "started"
  resolver_definitiva:
    label: "Resolver — Respuesta definitiva"
    priority: [1, 2]
    maxMinutes: 30
    stateTrigger: "completed"
```

The backend serves this config at `/api/config`. An admin UI or direct file edit can change it without code changes.

### SLA breach sounds (cuelume)
- When a timer breaches → `play("success")` for completion, `play("press")` for warning
- When a new urgent ticket arrives → `play("sparkle")` or `play("chime")`

---

## 6. Overcooked Design Implementation

### CSS Techniques
- **Rounded shapes**: `border-radius: 999px` for pills, `border-radius: 24px` for cards
- **Bright saturated colors**: HSL with high saturation (`hsl(X, 90%, 60%)`), avoid desaturated palettes
- **Playful typography**: Use `Bangers` or `Luckiest Guy` from Google Fonts for headings, `Comic Neue` for body
- **Cartoonish shadows**: Multiple `box-shadow` layers with offset and no blur for comic-style drop shadows
- **Bouncy animations**: CSS `@keyframes` with `cubic-bezier(0.175, 0.885, 0.32, 1.275)` for elastic easing
- **Kitchen/food theme**: Ticket cards styled as order tickets, priority as "doneness" (Urgent = charred/red, Low = raw/green)
- **Color palette**: Tomato red (#FF6347), Mustard yellow (#FFD700), Ketchup (#D32F2F), Lettuce (#4CAF50), Mayo (#FFFDD0), Avocado (#6B8E23), deep fryer oil (#FF8C00)
- **CSS Custom Properties** for easy theme variation

### Layout
- Fullscreen grid: cards grouped by priority in horizontal carousels or vertical columns
- Each card = an "order ticket" with dashed border, ticket stub tear line
- SLA timer as a "cooking timer" visual (circular or bar)
- Header = restaurant/kitchen theme with playful branding

---

## 7. Sound Integration with cuelume

### Data-driven sound triggers (not just click/hover)

```javascript
import { play, setEnabled } from 'cuelume';

// Polling callback — data-driven sounds
function onIssuesUpdated(newIssues, previousIssues) {
  const urgentNew = newIssues.filter(i => i.priority === 1 && !previousIssueIds.has(i.id));
  if (urgentNew.length > 0) play('sparkle');   // New urgent ticket
  
  const breached = checkBreachedSlas(newIssues);
  breached.forEach(issue => play('press'));    // SLA breach warning
}

// Timer tick
setInterval(() => {
  const aboutToBreach = slas.filter(sla => sla.isWarning());
  aboutToBreach.forEach(() => play('tick'));    // Ticking sound
}, 1000);
```

### Mute control
- Add a mute toggle button in the dashboard corner
- `setEnabled(false)` globally disables all sounds
- Sound preference persisted to `localStorage`

---

## 8. reicon-mcp vs reiconjs Clarification

**reicon-mcp** is an MCP server that runs during *development* to help the AI agent find and use icons. It is NOT a frontend dependency.

**For the frontend**, we use `reicon` directly:

```bash
pnpm add reicon      # Vanilla JS factory functions
# OR
pnpm add reicon-react # React components (recommended if using React)
# OR
# CDN script tag (no build step needed)
<script src="https://unpkg.com/reicon/cdn/reicon.min.js"></script>
```

**Recommendation**: `reicon-react` with Vite tree-shaking — import only the icons used, smallest bundle, best DX.

---

## 9. File Structure (Proposed)

```
camtom-tickets/
├── pnpm-workspace.yaml        # (if monorepo, though single package is fine)
├── package.json               # Root workspace package
├── config/
│   ├── sla.yaml               # SLA configuration (loaded by server)
│   └── dashboard.yaml         # Dashboard display config (refresh rate, columns, etc.)
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts           # Express entry point
│   │   ├── config.ts          # Loads and serves config files
│   │   ├── linear-client.ts   # GraphQL client wrapper (cache, retry, rate limit)
│   │   ├── poller.ts          # Polling orchestrator (setInterval + diff + SSE push)
│   │   ├── webhook.ts         # Webhook receiver (optional, for real-time)
│   │   ├── sse.ts             # Server-Sent Events manager
│   │   ├── cache.ts           # In-memory cache with TTL
│   │   ├── types.ts           # Shared TypeScript types
│   │   └── routes/
│   │       ├── issues.ts      # GET /api/issues
│   │       ├── config.ts      # GET /api/config
│   │       └── events.ts      # GET /api/events (SSE)
│   └── tests/
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx           # React entry point
│   │   ├── App.tsx            # Root component
│   │   ├── hooks/
│   │   │   ├── useIssues.ts   # Fetch + SSE subscription
│   │   │   ├── useSLA.ts      # SLA timer computation
│   │   │   ├── useConfig.ts   # Config fetching
│   │   │   └── useSound.ts    # cuelume sound triggers
│   │   ├── components/
│   │   │   ├── Dashboard.tsx  # Main dashboard layout
│   │   │   ├── PriorityGroup.tsx  # Group of tickets by priority
│   │   │   ├── TicketCard.tsx # Individual ticket/order display
│   │   │   ├── SLATimer.tsx   # Cooking timer visualization
│   │   │   ├── Header.tsx     # Kitchen-themed header
│   │   │   ├── SoundToggle.tsx
│   │   │   └── FridayReport.tsx # Weekly evaluation
│   │   ├── styles/
│   │   │   ├── global.css     # Overcooked-themed base styles
│   │   │   ├── variables.css  # CSS custom properties (colors, fonts)
│   │   │   └── animations.css # Bouncy keyframe animations
│   │   ├── utils/
│   │   │   ├── sla.ts         # SLA calculation functions
│   │   │   └── format.ts      # Date/timer formatting
│   │   └── assets/
│   │       └── bones/         # boneyard-js generated skeleton files
│   └── tests/
└── openspec/
    └── changes/ticket-dashboard/
        ├── exploration.md     # ← You are here
        ├── proposal.md
        ├── specs/
        ├── design.md
        └── tasks.md
```

---

## 10. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| **API key exposure** | 🔴 Critical | Express backend proxies all requests; browser never sees the key. Use `.env` for the key. |
| **Linear rate limiting** | 🟡 Medium | 5,000 req/h = one 30s poll = 120 req/h = safe. Cache on server to avoid redundant calls. Webhook support reduces polling further. |
| **Webhook unreachability (LAN)** | 🟡 Medium | Dev: ngrok tunnel. Production: polling-only is acceptable (30s delay on a TV is fine). Or deploy a lightweight relay on a public server. |
| **Sound autoplay blocked** | 🟡 Medium | Start muted; require one click to enable. Or use the `AudioContext.resume()` pattern cuelume handles. TV browser may be more permissive. |
| **TV browser compatibility** | 🟡 Medium | Modern TVs run Chromium-based browsers. Test on the target device early. Avoid experimental CSS (sticky, container queries, `:has()` with caution). |
| **boneyard-js dev dependency** | 🟢 Low | Only needed during development for bone capture. Production has zero runtime overhead from it. |
| **SSE reconnection storms** | 🟢 Low | Use exponential backoff on the client's EventSource reconnection. Backend broadcasts to all clients on a single poll cycle. |
| **SLA timer clock drift** | 🟢 Low | Server sends `serverTime` in SSE heartbeat every 30s. Client adjusts its local timer offset. |

---

## 11. Conclusion

### Ready for Proposal: **Yes**

### Recommendation Summary

**Stack**: Express (Node.js/TypeScript) backend + React (Vite) frontend

**Key decisions**:
1. **Backend**: Express proxy with in-memory cache and SSE push
2. **Frontend**: React with TypeScript, Vite build
3. **Real-time**: Polling at 30s default, SSE to broadcast to clients, optional webhook receiver
4. **SLA timers**: Client-side computed from `createdAt` + configurable limits
5. **Skeleton loading**: boneyard-js with React adapter
6. **Sound**: cuelume for data-driven audio events
7. **Icons**: reicon-react (tree-shakeable imports)
8. **Build tool**: Vite with pnpm
9. **Config**: YAML files served by the backend API (editable without code changes)
10. **Delivery**: Single PR (size exception >800 lines pre-approved)

**Next step**: Proceed to `sdd-propose` for the formal proposal with scope, approach, and rollback plan.
