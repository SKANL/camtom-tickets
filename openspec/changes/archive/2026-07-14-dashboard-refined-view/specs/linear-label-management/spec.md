# Linear Label Management — Auto-Provisioning

## Purpose

Automatically ensure a "ticket" label exists in the Linear workspace at server startup, so the dashboard can filter by it without manual setup. The operation is idempotent and non-blocking.

## Requirements

### Requirement: LM1 — Label Existence Check

The server MUST check whether a label named "ticket" exists in Linear before attempting creation.

#### Scenario: Label exists

- GIVEN "ticket" label exists in Linear
- WHEN the startup probe runs
- THEN `ensureLabel` checks via `fetchLabels`
- THEN no creation mutation is sent

#### Scenario: Label missing

- GIVEN no "ticket" label exists
- WHEN the startup probe runs
- THEN `ensureLabel` detects absence
- THEN it proceeds to create the label

### Requirement: LM2 — Idempotent Label Creation

The server MUST create the "ticket" label if missing, using the `createLabel` GQL mutation. Re-running the probe MUST NOT create duplicates.

#### Scenario: First creation

- GIVEN no "ticket" label exists
- WHEN `ensureLabel` calls `createLabel`
- THEN a label with name "ticket" is created
- THEN the mutation response is returned

#### Scenario: Idempotent on restart

- GIVEN "ticket" label already exists (created on previous start)
- WHEN server restarts and probe runs
- THEN existence check passes
- THEN no duplicate is created

### Requirement: LM3 — Non-Blocking Startup

The label probe MUST NOT block server startup. It runs after the poller, wrapped in try/catch.

#### Scenario: Successful startup

- GIVEN the server starts
- WHEN the poller begins
- THEN the probe runs asynchronously
- THEN the server handles requests normally

#### Scenario: Probe failure

- GIVEN the probe throws (network error, API permission denied)
- WHEN the error is caught
- THEN the server continues running
- THEN the "ticket" label simply does not exist (graceful degradation)

### Requirement: LM4 — Graceful Degradation

If label creation fails or the label is absent, the dashboard MUST function without the "ticket" label filter default.

#### Scenario: No ticket label in metadata

- GIVEN label creation failed at startup
- WHEN metadata is fetched
- THEN "ticket" is absent from metadata labels
- THEN FilterState `labels` defaults to `[]`
- THEN all tickets pass the label filter
