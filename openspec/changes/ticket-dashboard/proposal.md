# Proposal: TV Ticket Dashboard

## Intent

Support lacks real-time urgency-grouped tickets with SLA timers. Manual checking misses SLAs. Friday eval is ad-hoc. Dashboard brings TV-board visibility with Overcooked UI.

## Scope

**In Scope**: Express proxy of Linear API | React/Vite/TS frontend | Configurable SLA timers (client-side) | Friday productivity view | Overcooked theme | cuelume sounds | boneyard-js skeletons | reicon-react icons | YAML-driven config | SSE + 30s polling

**Out of Scope**: Auth (open TV) | Linear webhooks | Admin UI | Mobile/dark | Multi-team

## Capabilities

### New
- `ticket-dashboard`: Priority-grouped board with Overcooked UI, SSE, cuelume/boneyard/reicon
- `sla-config`: YAML SLA defs via `/api/config`; client-side `createdAt` + limits; warning/breach triggers
- `productivity-report`: Friday view — weekly resolution, SLA compliance, team stats

### Modified
None.

## Approach

Backend: Express + TS Linear proxy, config API, SSE, in-mem cache. Frontend: React + Vite SPA with hooks (useIssues/useSLA/useConfig/useSound). Real-time: SSE + 30s poll. Config: YAML served via `/api/config`, cached in localStorage. Build: pnpm monorepo.

SLA: `deadline = createdAt + maxMinutes`. Warning <20% rem, breach at 0. Design: CSS custom props, elastic `cubic-bezier`, food palette.

## Affected Areas

| Area | Impact |
|------|--------|
| `config/sla.yaml` | New — Román's SLA limits |
| `config/dashboard.yaml` | New — display config |
| `server/` | New — Express proxy, cache, SSE |
| `client/` | New — React dashboard |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Linear rate limit | Med | 120 req/h = 2.4% of 5K/h |
| Sound autoplay | Med | Start muted, enable on click |
| TV compat | Med | Test early, avoid experimental CSS |
| SSE storms | Low | Exponential backoff |
| Clock drift | Low | Heartbeat with `serverTime` |

## Rollback Plan

1. `git revert <merge>` — full revert
2. Config fix: edit YAML, no deploy
3. Backend fail: stop process (additive only)
4. Dep rollback: restore `pnpm-lock.yaml`

## Dependencies

Linear API key (.env) | Linear team ID | Node >= 18 | pnpm | Network to api.linear.app

## Success Criteria

- [ ] Tickets grouped by priority display correctly
- [ ] SLA timers warn/breach per Román's config
- [ ] SSE updates hit browser within 30s
- [ ] cuelume fires on new urgent ticket and SLA breach
- [ ] boneyard-js skeletons on initial load
- [ ] Friday view shows weekly metrics
- [ ] YAML changes take effect without redeploy
- [ ] pnpm only (no npm/yarn lock)
- [ ] No API key in client bundles
