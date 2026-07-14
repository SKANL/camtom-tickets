# Proposal: Dashboard Refined View

## Intent

Refine the TV dashboard with sensible defaults, auto-provisioned labels, and cleaner ticket cards. Currently the view shows all tickets including Done/Pull Request Sent, requires manual label setup, and displays ticket identifiers as the most prominent card element — making it harder to scan ticket purpose at a glance.

## Scope

### In Scope
- Default filter behavior: `excludeStates` in FilterState + auto-resolve "Done" and "Pull Request Sent" state IDs from metadata + default labels to resolved "ticket" label ID
- Server-side "ticket" label auto-creation via non-blocking startup probe
- TicketCard title-first layout with larger title, smaller identifier, cleaner assignee display (person icon, hidden if unassigned, no "Unassigned" text)

### Out of Scope
- Filter UX rework or new filter controls (FilterBar remains as-is)
- Column/timer customization beyond existing capability
- Additional Linear mutations beyond label creation

## Capabilities

### New Capabilities
- `dashboard-filters`: default filter behavior — add `excludeStates` to FilterState, resolve default state/label IDs from metadata by name matching
- `linear-label-management`: server-side Linear label creation via startup probe with existence check + idempotent mutation
- `ticket-card`: refined card layout with title-first hierarchy and minimal assignee

### Modified Capabilities
- `dashboard`: Client-Side Filtering (section 3) — adds default exclude/label behavior and metadata dependency for ID resolution; filter chain gains exclusion step

## Approach

1. **Default filters**: Add `excludeStates: string[]` to `FilterState`. In `App.tsx`, resolve default state IDs from `metadata.workflowStates` by case-insensitive name substring match for "Done" and "Pull Request Sent". Set default `labels` to resolved "ticket" label ID. Add excludeStates exclusion step after states include filter.
2. **Label creation**: Add `createLabel` GQL mutation + `ensureLabel` helper in `linear-client.ts`. Startup probe in `server/src/index.ts` after poller: check `fetchLabels`, create if missing. Wrapped in try/catch, non-blocking.
3. **TicketCard refactor**: Title-first layout (title at `var(--text-lg)`), identifier smaller below, assignee with person icon (hide if unassigned, strip "Unassigned" text).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `shared/src/types.ts` | Modified | Add `excludeStates` to `FilterState` |
| `client/src/App.tsx` | Modified | Default filter init, filter chain step, metadata ID resolution |
| `client/src/components/FilterBar.tsx` | Modified | Default/loaded filter merge for new keys |
| `client/src/components/TicketCard.tsx` | Modified | Title-first layout, assignee cleanup |
| `server/src/linear-client.ts` | Modified | Add `createLabel` mutation + `ensureLabel` |
| `server/src/index.ts` | Modified | Startup probe for label creation |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| State name mismatch across workspaces | Low | Substring + case-insensitive matching; manual override in FilterBar |
| Label creation race with metadata cache | Low | Graceful fallback: no label default if ID not yet cached |
| LocalStorage filter override conflicts | Med | Exclude default-only keys from localStorage save/load, or merge defaults |
| Linear API key lacks mutation permissions | Low | Startup probe wrapped in try/catch; degrades gracefully |
| TicketCard layout regression for identifier scanning | Low | Identifier still visible, just smaller and repositioned |

## Rollback Plan

`git revert` the merge commit. No data migration needed — all changes are additive (config/UI/startup side-effect). If label was created in Linear, it persists as harmless orphaned metadata.

## Dependencies

None. All changes are self-contained within the project.

## Success Criteria

- [ ] Dashboard loads with Done/Pull Request Sent tickets hidden by default
- [ ] "ticket" label exists in Linear workspace after first server start
- [ ] New tickets in dashboard default to "ticket" label filter
- [ ] TicketCard shows title as primary element, identifier as secondary
- [ ] Unassigned cards show no assignee text or icon
- [ ] All existing filter interactions continue working (backward compatible)
