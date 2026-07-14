# Delta: Dashboard — Client-Side Filtering

## ADDED Requirements

### Requirement: F8 — Default Filter Initialization

The system MUST initialize `FilterState` with `excludeStates` resolved from metadata workflow states matching "Done" and "Pull Request Sent" (case-insensitive substring match), and `labels` set to the resolved ID of the "ticket" label.

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| F8a: defaults resolved on metadata ready | excludeStates=[doneId, prSentId], labels=[ticketId] | Metadata not loaded → empty arrays, applied on stale-while-revalidate |
| F8b: name matching | Case-insensitive substring → first match | No match → empty (graceful degradation) |

### Requirement: F9 — Filter Chain Exclusion Step

After the state include filter, the system MUST apply an exclusion step removing tickets whose `state.id` is in `FilterState.excludeStates`.

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| F9a: state in both include + exclude | Excluded (exclusion wins) | ExcludeStates empty → pass through |
| F9b: exclusion after include | "In Progress" included, then checked | — |

## MODIFIED Requirements

### Requirement: F4 — App Owns FilterState

`App.tsx` owns `FilterState` (now includes `excludeStates: string[]`). Initial defaults resolve from metadata on load. `useMemo([filters, issues, metadata])` recomputes `filteredIssues` via the updated filter chain.

(Previously: FilterState had no `excludeStates`, defaults were empty with no metadata resolution)

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| F4: App owns state | Any filter recomputes; defaults from metadata | Metadata fail → empty defaults |
| F4a: excludeStates persisted in state | Set on init, merged on load | — |
| F4b: metadata-driven defaults | Resolves "Done", "PR Sent", "ticket" | Missing names → empty (no crash) |

### Requirement: F5 — AND Logic

Filters combine with AND logic. The state exclusion filter applies after the state include filter as an additional filter step.

(Previously: Only include filters applied with AND logic)

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| F5: AND logic | P1 + Started = intersection | — |
| F5a: exclude after include | excludeStates removes subset of included | ExcludeStates empty → no-op |

### Requirement: F7 — Metadata Fetch

`useMetadata()` fetches `/api/metadata` and caches in localStorage for 5 min with stale-while-revalidate. On success, cached data is ALSO used to resolve default FilterState IDs. On persistent failure, defaults remain empty.

(Previously: Metadata was only used for filter control rendering, not default initialization)

| Req | Happy | Edge / Error |
|-----|-------|-------------|
| F7: useMetadata fetch + default resolution | Cache + ID resolution | Fail → stale defaults; both fail → error, empty defaults |
