import { Router, Request, Response } from 'express';
import { getCachedIssues } from '../poller';

const router: Router = Router();

router.get('/api/issues', (_req: Request, res: Response) => {
  const issues = getCachedIssues();
  if (!issues) {
    res.json({ issues: [], cached: false });
    return;
  }
  res.json({ issues, cached: true, serverTime: Date.now() });
});

export default router;
