# Ticket Dashboard Specification

## Purpose

Real-time priority-grouped ticket board with Overcooked visual theme, designed for TV display. Shows active tickets with SLA timers, data-driven sound effects, skeleton loading, and configurable polling.

## Requirements

### Requirement: Priority Grouping

Tickets MUST be grouped by priority descending: Urgent (1), High (2), Medium (3), Low (4), then No priority (0). Each group MUST display a section header with the priority label.

#### Scenario: Tickets render in correct priority order

GIVEN tickets with priorities 1, 3, 0, 2, 4
WHEN the dashboard loads
THEN groups appear in order: Urgent, High, Medium, Low, No priority
AND each ticket appears in its correct group

#### Scenario: Empty group is collapsed

GIVEN no tickets exist with priority 2 (High)
WHEN the dashboard loads
THEN the High group MAY render as a collapsed or minimal section

### Requirement: Linear API Proxy

All ticket data MUST be fetched through the Express backend at `/api/issues`. The frontend MUST NOT call Linear's API directly. The backend SHALL proxy the Linear GraphQL API with the configured team filter.

#### Scenario: Backend proxies issue query

GIVEN the client requests GET /api/issues
WHEN the backend receives the request
THEN it queries Linear's GraphQL API and returns the parsed ticket list

#### Scenario: API key hidden from client

GIVEN a browser network request to /api/issues
WHEN inspecting all client-visible headers and payload
THEN no Linear API key is present

### Requirement: Real-Time Updates via SSE

The dashboard MUST receive live updates via Server-Sent Events at `/api/events`. The backend SHALL poll Linear every 30 seconds and push diffs to all connected SSE clients.

#### Scenario: New ticket appears via SSE

GIVEN the dashboard has an active SSE connection
WHEN the backend detects a new ticket during poll
THEN the ticket appears on the dashboard without page refresh

#### Scenario: SSE fallback to polling

GIVEN the SSE connection drops
WHEN the client detects disconnection
THEN the client MUST fall back to polling GET /api/issues every 30 seconds
AND MUST attempt SSE reconnection with exponential backoff

### Requirement: Overcooked Visual Theme

The UI MUST use an Overcooked-inspired aesthetic: bright saturated colors, rounded shapes (border-radius ≥ 24px for cards, 999px for pills), elastic cubic-bezier animations, and a food/kitchen color palette. Fonts SHOULD include a playful display font for headings.

#### Scenario: Theme applies on initial render

GIVEN the dashboard loads
WHEN inspecting computed element styles
THEN cards have border-radius ≥ 24px
AND colors use HSL values with high saturation

#### Scenario: Bouncy animation on state change

GIVEN a ticket moves between priority groups
WHEN the ticket card renders in its new position
THEN it animates with a cubic-bezier easing curve
AND the animation completes within 600ms

### Requirement: Data-Driven Sound Effects

The dashboard MUST use cuelume for sounds triggered by: new urgent ticket arrival, SLA timer warning, and SLA breach. Sounds MUST NOT play while the dashboard is muted.

#### Scenario: Sound plays on new urgent ticket

GIVEN unmuted state and an active SSE connection
WHEN a priority-1 ticket arrives
THEN cuelume plays the "sparkle" or "chime" sound

#### Scenario: Muted state suppresses all sounds

GIVEN the mute toggle is active (setEnabled(false))
WHEN any sound trigger event occurs
THEN no audio plays

### Requirement: Skeleton Loading

The dashboard MUST display boneyard-js skeleton placeholders during initial data load. Skeletons SHALL match the final layout and disappear once data arrives.

#### Scenario: Skeletons show on cold load

GIVEN a first-time visitor with no cached data
WHEN the dashboard begins loading
THEN skeleton placeholders cover each priority group area

#### Scenario: Skeletons replaced by content

GIVEN skeleton placeholders are visible
WHEN ticket data arrives via SSE or poll response
THEN skeletons fade out within 500ms
AND real ticket cards appear

### Requirement: Sound Mute Toggle

The dashboard MUST provide a visible mute toggle button. The mute preference MUST persist in localStorage across page refreshes.

#### Scenario: Mute state survives reload

GIVEN the user clicks mute toggle to disable sound
WHEN the page reloads
THEN sounds remain muted

### Requirement: Configurable Polling Interval

The SSE polling interval SHALL be configurable via `config/dashboard.yaml`. The default interval MUST be 30 seconds.

#### Scenario: Custom interval from config

GIVEN dashboard.yaml sets `pollingInterval: 60000`
WHEN the server starts
THEN it polls Linear every 60 seconds

### Requirement: Fullscreen TV Display

The dashboard MUST fill the viewport with large readable text. It SHOULD attempt auto-fullscreen on supported browsers and MUST NOT require scrolling at typical TV resolutions (1920x1080) with a standard ticket count.

#### Scenario: Fills viewport without scroll

GIVEN a 1920x1080 viewport with a typical ticket load
WHEN the dashboard renders
THEN content fills the full viewport without horizontal or vertical scrollbars

### Requirement: Ticket Card Design

Each ticket card MUST display: identifier, title, priority badge, assignee name, SLA timer, and status. Cards SHALL use an order-ticket aesthetic (dashed border, tear-line separator, ticket stub appearance).

#### Scenario: Card shows all required fields

GIVEN a ticket with all fields populated
WHEN the card renders
THEN it displays the identifier, title, priority badge, assignee, SLA timer, and status

### Requirement: Header Branding

The dashboard MUST include a header with kitchen or restaurant branding, displaying the team name and current time.

#### Scenario: Header renders on every page

GIVEN the dashboard is loaded
WHEN the header renders
THEN it shows the branded team name and current time
