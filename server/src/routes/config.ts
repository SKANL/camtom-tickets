import { Router, Request, Response } from 'express';
import { ensureConfig, saveConfig } from '../config';
import { metadataCache } from '../cache';
import { DashboardConfig, SLAConfig } from '@camtom/shared';

const router: Router = Router();

router.get('/api/config', async (_req: Request, res: Response) => {
  res.json(await ensureConfig());
});

router.put('/api/config', async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      dashboard?: Partial<DashboardConfig>;
      slas?: SLAConfig[];
    };
    // Invalidate metadata cache so next request picks up fresh data
    metadataCache.delete('catalog');
    const updated = await saveConfig(body);
    res.json(updated);
  } catch (err: any) {
    console.error('[config] PUT /api/config error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

export default router;
