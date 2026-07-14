# Tasks: TV Ticket Dashboard

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 3,000 – 4,500 (greenfield, 44 files) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Single PR (user chose single-pr, pre-approved size:exception) |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

## Phase 1: Foundation

- [x] 1.1 Create `pnpm-workspace.yaml` and root `package.json` with workspace scripts
- [x] 1.2 Create `shared/package.json`, `shared/tsconfig.json`, `shared/src/types.ts` (Issue, SLAConfig, SSEEvent, TimerState), `shared/src/index.ts` barrel
- [x] 1.3 Create `config/sla.yaml` with Román's 5 SLA definitions (Responder usuario, Recuperar usuario, Avisar equipo, Resolver Iniciar, Resolver Definitiva)
- [x] 1.4 Create `config/dashboard.yaml` with display config (pollingInterval, title)
- [x] 1.5 Create `.gitignore` and root `.env` template for LINEAR_API_KEY / LINEAR_TEAM_ID

## Phase 2: Server

- [x] 2.1 Create `server/package.json` and `server/tsconfig.json` with Express + TypeScript deps
- [x] 2.2 Create `server/src/config.ts` — YAML loader with chokidar file watcher and hot-reload
- [x] 2.3 Create `server/src/cache.ts` — in-mem `Map<string, {data, cachedAt}>` with 60s TTL
- [x] 2.4 Create `server/src/linear-client.ts` — GraphQL fetch wrapper with retry and rate-limit backoff
- [x] 2.5 Create `server/src/poller.ts` — 30s setInterval: fetch Linear → diff via updatedAt → broadcast via SSE
- [x] 2.6 Create `server/src/sse.ts` — SSE connection manager (Client[] array, heartbeat every 30s, broadcast delta)
- [x] 2.7 Create `server/src/routes/issues.ts` — `GET /api/issues` returning cached issues
- [x] 2.8 Create `server/src/routes/config.ts` — `GET /api/config` serving merged YAML with version hash
- [x] 2.9 Create `server/src/routes/events.ts` — `GET /api/events` registering SSE clients
- [x] 2.10 Create `server/src/index.ts` — Express app with CORS, JSON body parser, route mounting, and error middleware

## Phase 3: Client Foundation

- [x] 3.1 Create `client/package.json` (React 18, Vite, TypeScript, reicon-react, boneyard-js, cuelume) and `client/tsconfig.json`
- [x] 3.2 Create `client/vite.config.ts` with `/api` proxy to server
- [x] 3.3 Create `client/index.html` with Google Fonts link (display font for headings)
- [x] 3.4 Create `client/src/styles/variables.css` — CSS custom properties (Overcooked HSL palette, font stacks, radii, timing)
- [x] 3.5 Create `client/src/styles/global.css` — reset, fullscreen layout, base typography
- [x] 3.6 Create `client/src/styles/animations.css` — elastic keyframes, pulse for WARNING, fade-out for skeletons
- [x] 3.7 Create `client/src/utils/sla.ts` — `computeDeadline`, `getTimerState`, `formatRemaining` with future-createdAt clamp
- [x] 3.8 Create `client/src/utils/format.ts` — `formatDuration`, `formatTime`
- [x] 3.9 Create `client/src/main.tsx` — React root mount

## Phase 4: Client Components

- [x] 4.1 Create `client/src/hooks/useConfig.ts` — fetch `/api/config` with localStorage cache + version check
- [x] 4.2 Create `client/src/hooks/useIssues.ts` — SSE subscription with EventSource, fallback to 30s poll, diff merge
- [x] 4.3 Create `client/src/hooks/useSLA.ts` — 1s tick recomputing deadline/remaining/state for all active issues
- [x] 4.4 Create `client/src/hooks/useSound.ts` — cuelume wrapper with mute toggle persisted in localStorage
- [x] 4.5 Create `client/src/components/Header.tsx` — branded header with team name, current time, priority-group labels
- [x] 4.6 Create `client/src/components/TicketCard.tsx` — order-ticket card with identifier, title, priority badge, assignee, SLA timer, status
- [x] 4.7 Create `client/src/components/SLATimer.tsx` — circular cooking-timer radial progress (OK green, WARNING yellow pulse, BREACHED red)
- [x] 4.8 Create `client/src/components/PriorityGroup.tsx` — priority section header with ticket list; collapsed if empty
- [x] 4.9 Create `client/src/components/SoundToggle.tsx` — mute/unmute button reading/writing localStorage
- [x] 4.10 Create `client/src/components/Dashboard.tsx` — priority-grouped board (Urgent → High → Medium → Low → No priority) with boneyard-js skeleton loading
- [x] 4.11 Create `client/src/components/FridayReport.tsx` — weekly metrics (resolved, SLA%, avg time, priority breakdown), team table with assignee stats, success sound
- [x] 4.12 Create `client/src/App.tsx` — root wiring: Header + Dashboard or FridayReport toggle

## Phase 5: Testing

- [x] 5.1 Write server unit tests: `config.ts` YAML parse error/fullback, `cache.ts` TTL expiry, `sla.ts` timer math edge cases
- [x] 5.2 Write server integration tests: `GET /api/issues` returns cached data, `GET /api/config` hot-reload on file change, SSE `/api/events` push with supertest
- [x] 5.3 Write client hook tests: `useSLA` breach/warning/future-date edge cases, `useConfig` cache versioning hit/miss
- [x] 5.4 Write component tests: `TicketCard` renders all fields, `SLATimer` shows correct state colors, `FridayReport` zero-state with "N/A" metrics
