import { Router, Request, Response } from 'express';
import { fetchIssuesSince } from '../linear-client';
import { issueToRow } from '../ticket-mapper';
import { upsertTickets, getLastSync, setLastSync } from '../supabase';

const router: Router = Router();

function isAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers['authorization'];
  return header === `Bearer ${secret}`;
}

/**
 * GET /api/cron/reconcile
 *
 * Safety net for missed webhooks. Pulls issues changed since the last sync from
 * Linear and upserts them into Supabase. Invoked on a schedule (GitHub Actions).
 */
router.get('/api/cron/reconcile', async (req: Request, res: Response) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Capture the sync point BEFORE fetching so changes during the fetch aren't
    // missed next round (a small overlap just re-upserts, which is idempotent).
    const syncPoint = new Date().toISOString();
    const since = await getLastSync();

    const issues = await fetchIssuesSince(since);
    await upsertTickets(issues.map(issueToRow));
    await setLastSync(syncPoint);

    console.log(`[reconcile] Synced ${issues.length} issue(s) since ${since ?? 'ALL'}`);
    return res.status(200).json({ synced: issues.length, since });
  } catch (err: any) {
    console.error(`[reconcile] Failed: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
