# Display protocol v2 operations

## Purpose

`/display` is the production TV client. It uses only same-origin HTTPS and XHR polling. Supabase Auth, Turnstile, WebSocket, cookies, `fetch`, WebCrypto, and browser storage are not runtime requirements.

`/display-legacy-auth` keeps protocol v1 available during the migration and rollback window.

The minimum visual engine must support CSS custom properties in addition to JavaScript, DOM, XHR, and current HTTPS/TLS. The legacy bundle targets Chrome 49+, Safari 10+, Firefox 31+, Edge 15+, and Samsung Internet 5+ syntax. Brand/model is irrelevant, but an older engine without CSS variables is diagnosed as incompatible instead of rendering a misleading broken dashboard.

## Pair a TV once

1. Open `https://<production-host>/display` on the TV.
2. Open `/control` on the laptop and sign in with the administrative key.
3. Enter the six-digit code, name the TV, select its permitted teams, and submit.
4. The TV navigates to `/display#installation=<id>.<secret>`.
5. Save the complete URL as the TV browser's favorite or home page.

The fragment is the recoverable installation credential. It is not sent in HTTP requests, query strings, referrers, or server logs. Do not paste it into tickets or chat. The server stores only its hash.

If cookies work, the installation credential creates a short HttpOnly session. If cookies are blocked, the same response supplies a short token kept only in TV memory.

## Resume control

- Reopen the saved favorite on the TV. No new six-digit code is needed.
- Reopen `/control` on the laptop. Its HttpOnly controller session lasts up to 30 days.
- Select the TV cards to target. Only non-secret device IDs are stored in laptop `localStorage`.
- Compare **sent version** and **applied version**. Under normal connectivity the ACK should arrive within 12 seconds.

## Health states

- `online`: regular heartbeat and ACK.
- `degraded`: intermittent heartbeat.
- `offline`: heartbeat is stale or absent.
- `replaced`: a replacement completed its first successful sync.
- `revoked`: the installation URL can no longer authenticate.

The card also shows protocol, user agent, last heartbeat, state versions, and the last client-reported transport error.

## Replace, rotate, or revoke

**Replace TV**: start `/display` on the new TV, then choose the old TV in **Replaces** while claiming the new code. The old TV remains active until the new TV completes its first sync. This avoids a blank screen during physical replacement.

**Rotate URL**: use only when the permanent URL may be exposed. The controller shows the new URL once in the current page. Update the TV favorite immediately; the old URL stops working.

**Revoke**: immediately stops sessions and future syncs. Pairing is required to restore that physical TV.

## Recovery limits

If the favorite, URL fragment, cookie, and browser storage are all lost, the identity is no longer recoverable and the TV must be paired again. The fragment is the durable recovery mechanism; storage is not.

## Hisense physical acceptance checklist

1. Pair the Hisense TV once from `/display`.
2. Save the complete permanent URL as a favorite.
3. Close TV Browser, power off the TV, and restart it.
4. Open the favorite and confirm the dashboard resumes without a code.
5. Close and reopen `/control`; select the same TV and send a state change.
6. Confirm applied version catches sent version within 12 seconds.
7. Disable/re-enable network and confirm stale data remains visible, then synchronizes on recovery.
8. Repeat on the second TV.

## Canary and rollback

1. Deploy with Vercel CLI to a production canary URL that is not protected by preview authentication.
2. Validate both real TVs on `/display`.
3. Observe heartbeat, errors, and free-tier request usage for seven days.
4. Keep `/display-legacy-auth` during the 14-day stability window.
5. To roll back a TV, open `/display-legacy-auth`; do not delete v2 credentials during incident triage.

No paid service is required. If request usage approaches 80% of the free quota, increase the server-provided poll interval from 10 to 15 seconds before adding infrastructure.
