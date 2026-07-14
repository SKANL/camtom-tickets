# Tasks: Dashboard Refined View

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~160 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

## Phase 1: Foundation

- [ ] 1.1 Add `excludeStates: string[]` to `FilterState` in `shared/src/types.ts`
- [ ] 1.2 Add `IconPerson` SVG component to `client/src/components/Icons.tsx`

## Phase 2: Server — Linear Label Auto-Provisioning

- [ ] 2.1 Add `IssueLabelCreate` GQL mutation and `ensureLabel(name)` helper to `server/src/linear-client.ts` — existence check via `fetchLabels`, idempotent create
- [ ] 2.2 Wire non-blocking startup probe after `startPolling()` in `server/src/index.ts` — `try/catch` around `ensureLabel('ticket')`, log/warn only

## Phase 3: Client — Default Filters & FilterBar

- [ ] 3.1 Add two-phase default resolution `useEffect` in `App.tsx` — on metadata ready, resolve exclude state IDs and ticket label ID, merge with current filter state via `setFilter`, guard with `useRef`
- [ ] 3.2 Add exclusion filter step after state include in `useMemo` in `App.tsx` — `if (filter.excludeStates.length > 0) result = result.filter(i => !filter.excludeStates.includes(i.state.id))`
- [ ] 3.3 Update `emptyFilter()` to include `excludeStates: []`, update `loadFilter()` to merge parsed over `emptyFilter()`, update `countActive()` to skip `excludeStates` in `FilterBar.tsx`

## Phase 4: TicketCard Refactor & Build

- [ ] 4.1 Restructure `TicketCard.tsx` layout — title at top (`var(--text-lg)`, 3-line clamp), identifier below title (`var(--text-xs)`, clickable link to Linear)
- [ ] 4.2 Replace assignee display — use `IconPerson(size={14})` + name, hide entire element when `issue.assignee` is null/falsy, no "Unassigned" text
- [ ] 4.3 Run `npm run build`, verify no TypeScript errors, manual verify filter defaults and card layout across widths
