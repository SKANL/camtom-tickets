# Productivity Report Specification

## Purpose

Friday weekly view showing resolution metrics, SLA compliance, and team statistics. Computed entirely from cached ticket data — no additional Linear API queries.

## Requirements

### Requirement: Friday Trigger

The report MUST be accessible via a manual button on the dashboard. The dashboard SHOULD auto-detect Friday and show a visual indicator when the report is available.

#### Scenario: Manual button loads report

GIVEN the dashboard is displaying the ticket board
WHEN the user clicks the "Friday Report" button
THEN the productivity report view renders

#### Scenario: Auto-detect Friday indicator

GIVEN today is Friday
WHEN the dashboard loads or the day changes at midnight
THEN a visual indicator appears suggesting the report is available
AND the report MAY auto-load

### Requirement: Weekly Resolution Metrics

The report MUST display: total tickets resolved this week, SLA compliance rate (%), average resolution time, and a breakdown of resolved tickets by priority level.

#### Scenario: Metrics show correct values

GIVEN 20 tickets were resolved this week, 18 within SLA, averaging 4 hours, with 8 urgent, 6 high, 4 medium, 2 low
WHEN the report renders
THEN it shows "20 resolved", "90% compliance", "4h 0m avg"
AND a breakdown of resolved tickets by priority level

#### Scenario: Zero resolved tickets

GIVEN no tickets were resolved this week
WHEN the report renders
THEN it shows "0 resolved" and "N/A" for compliance and avg time
AND each metric card indicates no data

### Requirement: Team Statistics

The report MUST show a per-assignee table: tickets resolved and SLA breaches. Assignees with zero activity MUST appear with a count of 0. Tickets with no assignee MUST be grouped under "Unassigned".

#### Scenario: Assignee table renders correctly

GIVEN resolved tickets by Alice (8, 1 breach), Bob (5, 0 breaches), 2 unassigned
WHEN the report renders
THEN the table shows Alice: 8 resolved / 1 breach, Bob: 5 resolved / 0 breaches
AND "Unassigned": 2 resolved / 0 breaches

#### Scenario: Inactive assignees appear with zeroes

GIVEN Charlie is a team member with no resolved tickets this week
WHEN the report renders
THEN Charlie appears in the table with 0 resolved and 0 breaches

### Requirement: Computed from Cached Data

All metrics MUST be derived from ticket data already cached by the client. The report MUST NOT trigger any additional requests to Linear or backend APIs.

#### Scenario: No extra API calls

GIVEN the report button is clicked
WHEN monitoring network requests
THEN no requests to /api/issues or any Linear endpoint occur

### Requirement: Sound on Load

The report MUST play the cuelume "success" sound when the Friday view loads and sounds are unmuted.

#### Scenario: Success chime plays

GIVEN sounds are unmuted
WHEN the productivity report view loads
THEN cuelume plays the "success" sound

### Requirement: Visual Layout

The report MUST display summary metric cards in a horizontal row at the top and a detailed team table below. Cards SHALL use the Overcooked color palette and rounded styling consistent with the dashboard theme.

#### Scenario: Layout renders with data

GIVEN the report has loaded with ticket data
WHEN inspecting the layout
THEN metric cards appear at the top in a horizontal row
AND the team table appears below with column headers for assignee, resolved, and breaches
