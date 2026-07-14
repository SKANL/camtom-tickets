# Dashboard Filters — Default Filter Behavior

## Purpose

Define how the dashboard initializes its filter state with sensible defaults: exclude done/resolved states and default to the "ticket" label. This reduces noise on first load without requiring manual filter configuration.

## Requirements

### Requirement: DF1 — Default Exclude States

The system MUST populate `FilterState.excludeStates` with workflow state IDs resolved from metadata by case-insensitive name match for "Done" and "Pull Request Sent".

#### Scenario: States resolved from metadata

- GIVEN metadata contains states named "Done" and "Pull Request Sent"
- WHEN FilterState initializes
- THEN `excludeStates` contains the matching IDs

#### Scenario: Metadata not yet loaded

- GIVEN metadata fetch is pending
- WHEN FilterState initializes
- THEN `excludeStates` is `[]`
- THEN defaults apply once metadata resolves

### Requirement: DF2 — Default Label Filter

The system MUST populate `FilterState.labels` with the label ID from metadata matching "ticket" (case-insensitive). If no match, labels remain empty.

#### Scenario: Label exists in metadata

- GIVEN metadata contains a label named "ticket"
- WHEN FilterState initializes
- THEN `labels` contains the matching label ID

#### Scenario: Ticket label absent

- GIVEN the "ticket" label does not exist or is not yet in metadata
- WHEN FilterState initializes
- THEN `labels` is `[]`
- THEN no label filter is applied

### Requirement: DF3 — User Filter Merge

The system MUST merge defaults into existing localStorage filters without overwriting user-set values.

#### Scenario: User has saved filters

- GIVEN localStorage has saved filters with `labels: ["custom-label"]`
- WHEN the app loads
- THEN `labels` remains `["custom-label"]` (user value preserved)

#### Scenario: First load, no saved filters

- GIVEN no saved filters in localStorage
- WHEN the app loads
- THEN defaults (excludeStates + ticket label) are applied

### Requirement: DF4 — Exclusion Precedence

The filter chain MUST exclude tickets whose workflow state is in `excludeStates`, applied after the state include filter. Exclusion takes precedence over inclusion.

#### Scenario: State in both include and exclude

- GIVEN a ticket's state is included AND in excludeStates
- WHEN filtering
- THEN the ticket is excluded

#### Scenario: Empty excludeStates

- GIVEN excludeStates is `[]`
- WHEN filtering
- THEN no tickets are removed by exclusion
