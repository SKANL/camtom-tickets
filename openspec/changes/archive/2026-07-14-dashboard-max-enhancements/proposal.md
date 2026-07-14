# Proposal: Dashboard Max Enhancements

## Intent

Major enhancement iteration on the ticket dashboard. Users need richer Linear metadata for filtering, accurate SLA timing anchored on assignment (not creation), full UI configurability, and a more dramatic kitchen timer visual experience — all backward-compatible with existing features.

## Scope

### In Scope
- 6 new Linear GraphQL queries (teams, projects, users, workflow states, labels, cycles) served via `GET /api/metadata`
- Server-side assignment timestamp tracking with SSE delta extension for SLA anchor
- Client-side FilterBar: project, assignee, state, label, priority, text search
- Tabbed Settings Panel: SLA rule editor, display options, timer style, animation intensity, sound controls
- Visual overhaul: siren, burnt effect, receipt aesthetic, arrival glow, bar timer mode, urgent pulse, temperature gauge

### Out of Scope
- Webhook-based real-time updates (over-engineered for LAN)
- Server-side filtered queries (overkill for <200 issues per team)
- Multi-team dashboard view (future work)
- Mobile/responsive layout (TV-focused)

## Capabilities

### New Capabilities
- `linear-metadata-queries`: Fetch teams, projects, users, workflow states, labels, cycles from Linear GraphQL via aggregated endpoint
- `assignment-tracking`: Detect assignee changes in poller diff, store server-side timestamps, emit via SSE deltas
- `client-filtering`: FilterBar with 6 filter dimensions, collapsible UI, localStorage persistence
- `settings-panel-expanded`: Tabbed panel (General/Display/SLA/Labels/Sounds) with SLA rule CRUD, display config, timer style selector
- `visual-enhancements`: CSS animation suite — siren, burnt, arrival glow, urgent pulse, bar timer, receipt clip-path, temperature gauge

### Modified Capabilities
None — no existing specs to modify.

## Approach

1. **Metadata**: 6 parallel GraphQL queries in `linear-client.ts` → new `GET /api/metadata` route with 5-min TTL server cache.
2. **Timer-on-assign**: Extend poller `computeDiff` to detect assignee changes. `Map<string, number>` tracks `assignedAt` server-side. Emitted as `assignmentTimestamps` in SSE delta.
3. **Filters**: Client-side only. `useMemo` chain in `App.tsx` — FilterBar state → filtered issues → Dashboard. `useMetadata` hook fetches `/api/metadata` on mount.
4. **Settings**: Restructure `SettingsPanel.tsx` to tabbed layout. SLA rules persisted via existing `PUT /api/config` route.
5. **Visuals**: Pure CSS — no JS animation libraries. New `@keyframes` in `animations.css`, CSS custom property interpolation for burnt/siren effects.
6. **Delivery**: Single PR (user choice). Review budget: 800 lines.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `shared/src/types.ts` | Modified | 6 new types, extend `DashboardConfig`, optional `assignedAt` on `Issue` |
| `server/src/linear-client.ts` | Major | 6 new GraphQL query functions |
| `server/src/poller.ts` | Moderate | Assignee diff detection, `assignmentTimestamps` in SSE |
| `server/src/routes/metadata.ts` | New | `GET /api/metadata` — aggregated catalog |
| `server/src/assignment-timestamps.ts` | New | Assignment tracking module |
| `server/src/cache.ts` | Minor | `metadataCache` with 5+ min TTL |
| `client/src/App.tsx` | Moderate | Filter state, `useMetadata`, pass filtered issues |
| `client/src/components/Dashboard.tsx` | Moderate | Accept `filteredIssues` prop |
| `client/src/components/FilterBar.tsx` | New | 6 filter dimensions, collapsible |
| `client/src/components/TicketCard.tsx` | Major | Siren, burnt, receipt, arrival glow, clickable URL |
| `client/src/components/SLATimer.tsx` | Major | Bar mode, tick marks, color gradient |
| `client/src/components/SettingsPanel.tsx` | Major | Tabbed layout, SLA editor, display options |
| `client/src/components/PriorityGroup.tsx` | Minor | Temperature gauge strip |
| `client/src/hooks/useMetadata.ts` | New | Fetch metadata, localStorage cache |
| `client/src/hooks/useSLA.ts` | Moderate | `assignedAt` anchor support |
| `client/src/hooks/useIssues.ts` | Minor | Accept `assignmentTimestamps` |
| `client/src/hooks/useSound.ts` | Minor | Continuous sounds, siren |
| `client/src/styles/animations.css` | Major | New keyframes (siren, arrival, urgent, burnt) |
| `client/src/styles/variables.css` | Moderate | New CSS custom properties |
| `client/src/styles/global.css` | Moderate | Enhanced patterns, receipt texture |
| `config/dashboard.yaml` | Minor | New optional fields |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Linear rate limit with 6 new queries | Low | Metadata cached server-side (5+ min TTL). Only ~6 queries per cold load. |
| Timer timestamps lost on server restart | Medium | Initial poll stamps all current assignees as "now". Optional JSON persistence. |
| CSS animation perf on TV browser | Medium | GPU-accelerated only (`transform`, `opacity`). Avoid `box-shadow` on many cards. |
| Sound overload (continuous siren) | Medium | Configurable auto-mute, respect existing mute toggle. |
| Filter bar clutters TV view | Low | Collapsible, persist collapsed state, active filter badge when hidden. |
| YAML corruption from UI | Medium | Validate before write, keep last-good-known-version in memory. |
| Single PR exceeds review bandwidth | Medium | 800-line budget allocated. Chained PRs prepared as contingency if exceeded. |

## Rollback Plan

`git revert <merge-commit>` — all additions are backward-compatible: new fields are optional, new CSS vars have fallbacks, new settings have defaults, SSE ignores unknown fields. No data migration needed. No schema migration.

## Dependencies

- Linear API key (already configured)
- No new npm packages (CSS-only animations, no JS animation libs)

## Success Criteria

- [ ] `GET /api/metadata` returns 6 catalog types within 2s cold start
- [ ] SLA timer uses `assignedAt` anchor when available, falls back to `createdAt`
- [ ] FilterBar reduces issue set by any combination of filters without error
- [ ] Settings Panel writes SLA rules to server YAML without data loss
- [ ] All SSE events accepted without breaking existing delta handling
- [ ] Visual enhancements render on target TV browser at 60fps
- [ ] All existing features (issue list, priority grouping, circular timer) unchanged
