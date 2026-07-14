# Design: TV Ticket Dashboard

## Technical Approach

Express+TypeScript backend proxies Linear's GraphQL API, polls every 30s, broadcasts deltas via SSE to a React+Vite SPA. SLA timers run client-side. Config lives in YAML files served by `/api/config` with hot reload. All three specs (ticket-dashboard, sla-config, productivity-report) are delivered in a single implementation pass.

## Architecture Decisions

### Decision: Monorepo layout

| Option | Tradeoff |
|--------|----------|
| Single package | Shared types easier but no boundary enforcement |
| pnpm workspace | Clear server/client boundary, shared `types` package, pnpm mandated |

**Choice**: pnpm workspace with `server/`, `client/`, and `shared/` packages.
**Rationale**: Shared types for Issue, SLA, and SSE protocol live in `shared/`; server and client each own their deps. pnpm enforces no unexpected lockfiles.

### Decision: Polling + SSE vs webhooks

| Option | Tradeoff |
|--------|----------|
| Webhooks | Real-time but need public HTTPS endpoint (blocker for LAN TV) |
| Polling + SSE | 30s latency acceptable for TV board; no infra dependencies |

**Choice**: Backend polls Linear every 30s, diffs via `updatedAt`, pushes delta to SSE clients. Webhook endpoint stubbed for future.
**Rationale**: Linear rates 5K req/h — 120 polls/h is 2.4%. SSE means one backend poll feeds all browser tabs.

### Decision: Client-side SLA timers

| Option | Tradeoff |
|--------|----------|
| Server timers (push) | Complex state sync, socket overhead, clock sync pain |
| Client `setInterval` | Simpler, survives refresh, config cached in localStorage |

**Choice**: `deadline = createdAt + maxMinutes * 60000`, computed client-side, 1s tick, three states.
**Rationale**: TV display doesn't need server-authoritative timers. Server sends `serverTime` in SSE heartbeat for drift correction.

## Data Flow

```
Linear API ←── Express Server ←── Browser
                   │                  │
  Poll every 30s ──┤                  │
  Issues → cache ──┤                  │
  Diff against ────┤── SSE /events ──→ useIssues hook → React state
  previous poll    │                  │
                   │                  ├── useSLA (1s tick → timer states)
                   │                  ├── useConfig (/api/config on mount)
                   │                  └── useSound (cuelume triggers)
                   │
  GET /api/config ──→ reads config/*.yaml → JSON response
```

SSE event format:
```
event: delta
data: {"added": [...], "updated": [...], "removed": [...], "serverTime": 1720000000000}
```

Heartbeat every 30s: `event: heartbeat` `data: {"serverTime": 1720000000000}`

## File Changes

All files are **Create** (new project).

| File | Purpose |
|------|---------|
| `pnpm-workspace.yaml` | Root workspace def |
| `package.json` | Root scripts |
| `shared/src/types.ts` | Issue, SLAConfig, SSEEvent types |
| `shared/src/index.ts` | Shared barrel export |
| `shared/package.json` | Shared package |
| `shared/tsconfig.json` | Shared tsconfig |
| `config/sla.yaml` | Román's SLA limits |
| `config/dashboard.yaml` | Display config (pollingInterval, title) |
| `server/package.json` | Express deps |
| `server/tsconfig.json` | TS config |
| `server/src/index.ts` | Express entry, middleware, route mounting |
| `server/src/config.ts` | YAML loader + file watcher (chokidar) |
| `server/src/linear-client.ts` | GraphQL client (fetch wrapper, retry, rate-limit backoff) |
| `server/src/poller.ts` | setInterval orchestrator: fetch → diff → broadcast |
| `server/src/sse.ts` | SSE connection manager (Client[] array, heartbeat, broadcast) |
| `server/src/cache.ts` | `Map<string, {data, cachedAt}>` with 60s TTL |
| `server/src/routes/issues.ts` | `GET /api/issues` — returns cached issues |
| `server/src/routes/config.ts` | `GET /api/config` — serves merged YAML configs |
| `server/src/routes/events.ts` | `GET /api/events` — registers SSE client |
| `client/package.json` | React+Vite deps |
| `client/tsconfig.json` | TS config |
| `client/vite.config.ts` | Vite config + proxy `/api` to server |
| `client/index.html` | HTML shell with Google Fonts links |
| `client/src/main.tsx` | React root |
| `client/src/App.tsx` | Root: Header + Dashboard or FridayReport |
| `client/src/hooks/useIssues.ts` | SSE subscription + fetch + diff merge |
| `client/src/hooks/useSLA.ts` | Timer computation (1s tick, three states) |
| `client/src/hooks/useConfig.ts` | Config fetch → localStorage with version check |
| `client/src/hooks/useSound.ts` | cuelume wrapper: triggers, mute, localStorage |
| `client/src/components/Header.tsx` | Branded header, current time, mute toggle |
| `client/src/components/Dashboard.tsx` | Priority-grouped board |
| `client/src/components/PriorityGroup.tsx` | Single priority group section |
| `client/src/components/TicketCard.tsx` | Order-ticket card (identifier, title, assignee, SLA) |
| `client/src/components/SLATimer.tsx` | Circular cooking-timer radial progress |
| `client/src/components/FridayReport.tsx` | Weekly summary metrics + team table |
| `client/src/components/SoundToggle.tsx` | Mute button |
| `client/src/styles/variables.css` | CSS custom properties (colors, fonts, radii) |
| `client/src/styles/global.css` | Reset, base styles, fullscreen layout |
| `client/src/styles/animations.css` | Elastic keyframes, pulse, fade skeleton |
| `client/src/utils/sla.ts` | `computeDeadline`, `getTimerState`, `formatRemaining` |
| `client/src/utils/format.ts` | `formatDuration`, `formatTime` |

## Interfaces / Contracts

```typescript
// shared/src/types.ts
interface Issue {
  id: string; identifier: string; title: string;
  priority: 0|1|2|3|4; priorityLabel: string;
  createdAt: string; updatedAt: string;
  assignee?: { id: string; name: string } | null;
  state: { id: string; name: string; type: string };
}

interface SLAConfig {
  id: string; label: string;
  applicablePriorities: number[];
  maxMinutes: number; warningThreshold: number;
}

interface SSEEvent {
  type: 'delta' | 'heartbeat';
  data: { added?: Issue[]; updated?: Issue[]; removed?: string[]; serverTime: number };
}

type TimerState = 'OK' | 'WARNING' | 'BREACHED';
```

## SLA Timer Logic

```typescript
function computeSLA(createdAt: string, maxMinutes: number, warningThreshold: number) {
  const deadline = new Date(createdAt).getTime() + maxMinutes * 60000;
  const remaining = Math.max(0, deadline - Date.now());
  const pct = remaining / (maxMinutes * 60000);
  const state: TimerState = remaining <= 0 ? 'BREACHED'
    : pct <= warningThreshold ? 'WARNING' : 'OK';
  return { remaining, state, deadline };
}
```

Future `createdAt` clamped to `now + maxMinutes` (never show negative elapsed).

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit (server) | `sla.ts` timer math, `cache.ts` TTL, `config.ts` YAML parse | Vitest |
| Unit (client) | `useSLA` timer edge cases (breach, warning, future date), `useConfig` cache versioning | Vitest + React Testing Library |
| Integration (server) | `GET /api/issues` returns cached data, `GET /api/config` hot-reload on file change, SSE `/api/events` push | Vitest + supertest |
| Component (client) | `TicketCard` renders all fields, `SLATimer` shows correct state colors, `FridayReport` zero-state | Vitest + React Testing Library |
| E2E | Full flow: server starts → client fetches → SSE pushes → UI updates | Playwright (manual for TV) |
