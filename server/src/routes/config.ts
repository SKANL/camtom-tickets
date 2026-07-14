import { Router, Request, Response } from 'express';
import { getConfig, saveConfig } from '../config';
import { metadataCache } from '../cache';
import { DashboardConfig, SLAConfig } from '@camtom/shared';

const router: Router = Router();

router.get('/api/config', (_req: Request, res: Response) => {
  const config = getConfig();
  res.json(config);
});

router.put('/api/config', (req: Request, res: Response) => {
  try {
    const body = req.body as {
      dashboard?: Partial<DashboardConfig>;
      slas?: SLAConfig[];
    };
    // Invalidate metadata cache so next request picks up fresh data
    metadataCache.delete('catalog');
    const updated = saveConfig(body);
    res.json(updated);
  } catch (err: any) {
    console.error('[config] PUT /api/config error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
