# SLA Configuration Specification

## Purpose

Define SLA timers for tickets via YAML configuration, served by the backend API and computed client-side. Three timer states: OK (green), WARNING (yellow), BREACHED (red).

## Requirements

### Requirement: YAML Configuration File

SLA definitions MUST be stored at `config/sla.yaml`. Each entry MUST include: `id`, `label`, `applicablePriorities` (list), `maxMinutes`, and `warningThreshold` (fraction). The server SHALL apply Román's initial configuration: Responder usuario (5 min, p1-p2), Recuperar usuario (10 min, p1-p3), Avisar equipo (10 min, p1), Resolver Iniciar (10 min, p1-p2), Resolver Definitiva (30 min, p1-p2).

#### Scenario: Valid YAML loads at startup

GIVEN config/sla.yaml contains valid YAML with all required fields
WHEN the server starts
THEN all SLA definitions are parsed and available via GET /api/config

#### Scenario: Malformed YAML returns error

GIVEN config/sla.yaml contains invalid YAML syntax
WHEN the server starts or reads the file
THEN the server MUST log a descriptive error
AND MUST NOT serve incomplete SLA data
AND MAY fall back to a compiled-in default configuration

### Requirement: API Config Endpoint

The backend MUST serve SLA configuration at GET `/api/config`. The response MUST include all SLA definitions and a version hash for cache invalidation.

#### Scenario: Config endpoint returns SLA data

GIVEN the server is running with valid config/sla.yaml
WHEN a client requests GET /api/config
THEN the response contains all SLA definitions and a version hash

#### Scenario: Config changes without server restart

GIVEN config/sla.yaml is modified while the server runs
WHEN the client requests GET /api/config
THEN the server SHALL read the current file and return updated data
AND the version hash MUST differ from the previous value

### Requirement: Client-Side Timer Computation

The client MUST compute the SLA deadline as `deadline = createdAt.getTime() + maxMinutes * 60000`. Timer state MUST be evaluated every 1000ms using the client clock.

#### Scenario: Timer counts down correctly

GIVEN a ticket created 2 minutes ago with an SLA of maxMinutes: 5
WHEN the client computes the timer each second
THEN the displayed remaining time decreases from 3:00 toward 0:00

#### Scenario: Future createdAt clamped to max

GIVEN a ticket with createdAt in the future
WHEN computing the SLA deadline
THEN remaining time SHALL equal maxMinutes
AND MUST NOT show a negative value

### Requirement: Three Timer States

Each ticket timer SHALL display one of three states. OK (green) while remaining > warningThreshold × maxMinutes. WARNING (yellow, pulse animation) while remaining > 0 but below the threshold. BREACHED (red, solid) when remaining ≤ 0.

#### Scenario: Warning activates at threshold

GIVEN an SLA with maxMinutes: 5 and warningThreshold: 0.2
WHEN remaining time drops below 60 seconds (20% of 300s)
THEN the timer turns yellow and enters WARNING state

#### Scenario: Breach activates at zero

GIVEN remaining time ≤ 0
WHEN the timer updates
THEN the timer turns red and enters BREACHED state

### Requirement: Config Caching with Version Check

The client MAY cache SLA config in localStorage. Before using cached data, it MUST compare the cached version hash with the server's current `/api/config` version hash. On mismatch, the cache MUST be discarded and fresh data used.

#### Scenario: Cache hit with matching version

GIVEN localStorage has cached config with version "abc123"
WHEN GET /api/config returns version "abc123"
THEN the client uses cached config without reprocessing

#### Scenario: Cache miss after version change

GIVEN localStorage has cached config with version "abc123"
WHEN GET /api/config returns version "def456"
THEN the client discards the cache and applies the new config
