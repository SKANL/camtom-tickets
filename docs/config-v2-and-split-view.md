# Per-team configuration and split view

Configuration v2 separates server-owned global/team settings from browser-owned screen state. Existing v1 clients continue to receive **dashboard** and **slas**; v2 clients additionally receive normalized team settings.

## Quick path

1. Apply **0010_team_scope_and_retention.sql**.
2. Apply **0011_config_v2_team_settings.sql** with Supabase CLI against the linked online project.
3. Deploy the matching application with Vercel CLI.
4. Open Settings, choose each team, save its independent configuration, then choose single or vertical split for that browser.

## Scope model

| Scope | Owns | Persistence |
|---|---|---|
| Global | Title and polling interval | app_config |
| Team | SLA, criterion, timer, accent, members, display, priority/state labels, zone labels, kitchen phrases, report | team_dashboard_config |
| Screen | Single/split layout, left/right team, per-pane filter and board/report view | Browser localStorage |

**activeTeamId** remains readable only as a v1 migration fallback. New runtime behavior uses ScreenState panes; settings no longer write a global active team.

## Compatibility

Migration 0011 copies every global v1 value into every existing team row, including each team's existing filter, timer, and accent. This keeps the first v2 render visually and functionally identical.

The API response remains additive:

- dashboard, slas, and version remain available;
- configV2.schemaVersion is 2;
- configV2.teams is the single authority and contains complete settings for every configured team;
- there is no duplicate global-default layer or implicit inheritance.

The server tolerates the short rollout window before 0011 exists by returning the v1 contract. Migration 0011 takes a write-conflicting lock on app_config before backfill and keeps it until its synchronization trigger is installed at transaction commit, so no concurrent legacy write can escape. The first successful v2 write activates the new contract; subsequent legacy writes fail closed rather than flattening independent team configuration. V2 reads use one database snapshot RPC, and writes submit the observed response version before taking the same app_config.updated_at lock for the global row and all team rows in one transaction.

## Split behavior

- TV/wide layouts render panes left and right with a visible divider.
- Narrow screens stack the panes so neither board becomes unusably compressed.
- Each pane independently selects a team, filter, and board/report view.
- Both panes reuse one ticket snapshot and one Realtime connection.
- Alert evaluation is global and keyed by ticket/state, so showing the same team twice does not duplicate sounds.
- Every currently active ticket keeps an exact baseline; removed tickets are discarded immediately, while at most 200 pending hidden events are retained for seven days. This avoids capacity-driven repeat alerts without accumulating inactive-ticket history.

## Validation and recovery

Both client and server use the shared config-v2 validator. Invalid team configuration is rejected with a field path; an invalid fetched v2 response is not activated. Screen state is validated against configured team IDs and falls back to a compatible single-pane state when stale or malformed.

Conflicting saves use a three-way merge from the observed base to the local draft and latest server value. Non-overlapping leaf changes merge automatically; a path modified differently on both sides requires an explicit local-or-remote choice before saving.

Local screens keep browser-owned state. Paired displays instead receive the same schema from the controller; see [Universal browser screen control](./screen-remote-control.md).

## Rollback compatibility after v2 activation

Migration `0011` is forward-only during incident recovery: do not drop `team_dashboard_config` or its synchronization trigger. The first successful v2 write intentionally makes legacy configuration **writes** fail closed, because an old worker would flatten independent team settings back into one global value. Legacy configuration **reads** remain compatible through the synchronized v1 projection.

If application rollback is required after v2 activation, first disable configuration editing at the operational boundary (remove controller/admin access or place the site in the approved maintenance mode), then roll the Vercel application back. The old application may read the projection, but Settings writes must remain disabled until the config-v2 application is restored. No database down migration is required or supported.
