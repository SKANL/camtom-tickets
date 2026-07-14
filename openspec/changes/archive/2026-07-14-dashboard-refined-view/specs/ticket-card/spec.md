# Ticket Card — Refined Layout

## Purpose

Present the ticket title as the primary visual element, with the identifier and assignee as secondary information. The assignee area is minimal: shown only when assigned, using a person icon, never showing "Unassigned" text.

## Requirements

### Requirement: TC1 — Title-First Hierarchy

The ticket title SHALL be the most prominent element in the card, styled at `var(--text-lg)` and positioned above the identifier.

#### Scenario: Title prominence

- GIVEN a TicketCard with title "Auth failure in prod"
- WHEN the card renders
- THEN the title appears at `var(--text-lg)` font size
- THEN the title is the topmost text element

#### Scenario: Long title wraps

- GIVEN the title exceeds one line
- WHEN the card renders
- THEN the title wraps naturally
- THEN the identifier remains aligned below

### Requirement: TC2 — Identifier Placement

The ticket identifier (e.g., "TICK-123") SHALL appear below the title in a smaller, secondary font size.

#### Scenario: Identifier below title

- GIVEN a TicketCard with identifier "TICK-456"
- WHEN the card renders
- THEN "TICK-456" appears below the title
- THEN its font size is smaller than the title

### Requirement: TC3 — Assignee Display

The assignee SHALL be shown with a person icon followed by the assignee name. If unassigned, the entire assignee area MUST be hidden. The text "Unassigned" MUST NOT appear.

#### Scenario: Assigned ticket

- GIVEN the ticket is assigned to "Alice"
- WHEN the card renders
- THEN a person icon appears before "Alice"
- THEN the text "Unassigned" is absent

#### Scenario: Unassigned ticket

- GIVEN the ticket has no assignee
- WHEN the card renders
- THEN no person icon appears
- THEN no assignee text appears
- THEN the assignee area does not consume vertical space

### Requirement: TC4 — Layout Stability

The title-first layout MUST maintain readability across dashboard viewport widths without breaking card structure.

#### Scenario: Narrow column

- GIVEN the card is in a narrow column
- WHEN the title wraps
- THEN the identifier and assignee remain aligned below the title
- THEN no content overflows the card bounds
