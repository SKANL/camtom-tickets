import { Router, Request, Response } from 'express';
import { getCachedIssues } from '../poller';
import { fetchAllIssues } from '../linear-client';
import { issuesCache } from '../cache';

const router: Router = Router();

router.get('/api/issues', async (_req: Request, res: Response) => {
  const cached = getCachedIssues();
  if (cached) {
    res.json({ issues: cached, cached: true, serverTime: Date.now() });
    return;
  }

  // Cold start — fetch from Linear synchronously and warm the cache
  try {
    const issues = await fetchAllIssues();
    issuesCache.set('issues', issues);
    res.json({ issues, cached: false, serverTime: Date.now() });
  } catch (err: any) {
    console.error('[issues] Failed to fetch issues:', err.message);
    res.status(503).json({ issues: [], error: err.message, cached: false });
  }
});

export default router;
