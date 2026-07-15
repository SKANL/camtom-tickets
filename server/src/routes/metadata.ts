import { Router, Request, Response } from 'express';
import { metadataCache } from '../cache';
import { getMetadataCache, setMetadataCache } from '../supabase';
import {
  fetchTeams,
  fetchProjects,
  fetchUsers,
  fetchWorkflowStates,
  fetchLabels,
  fetchCycles,
} from '../linear-client';

const router: Router = Router();

/** L2 (Supabase) cache TTL — survives cold starts to avoid re-querying Linear. */
const DB_TTL_MS = 6 * 60 * 60 * 1000;

interface MetadataResponse {
  teams: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  users: { id: string; name: string }[];
  workflowStates: { id: string; name: string }[];
  labels: { id: string; name: string }[];
  cycles: ({ id: string; name: string } & { completedAt?: string })[];
  errors?: Record<string, string>;
}

router.get('/api/metadata', async (_req: Request, res: Response) => {
  try {
    // L1: in-memory cache (fastest, wiped on cold start)
    const cached = metadataCache.get('catalog');
    if (cached) {
      res.json({
        ...cached,
        cached: true,
      });
      return;
    }

    // L2: Supabase-backed cache (survives cold starts)
    try {
      const l2 = await getMetadataCache();
      if (l2 && Date.now() - new Date(l2.updatedAt).getTime() < DB_TTL_MS) {
        metadataCache.set('catalog', l2.catalog);
        res.json({ ...l2.catalog, cached: true });
        return;
      }
    } catch (err: any) {
      console.warn('[metadata] L2 read failed, falling back to Linear:', err.message);
    }

    // Run all 6 queries in parallel with individual error handling
    const results = await Promise.allSettled([
      fetchTeams(),
      fetchProjects(),
      fetchUsers(),
      fetchWorkflowStates(),
      fetchLabels(),
      fetchCycles(),
    ]);

    const [teams, projects, users, workflowStates, labels, cycles] = results;
    const errors: Record<string, string> = {};

    const response: MetadataResponse = {
      teams: teams.status === 'fulfilled' ? teams.value : [],
      projects: projects.status === 'fulfilled' ? projects.value : [],
      users: users.status === 'fulfilled' ? users.value : [],
      workflowStates: workflowStates.status === 'fulfilled' ? workflowStates.value : [],
      labels: labels.status === 'fulfilled' ? labels.value : [],
      cycles: cycles.status === 'fulfilled' ? cycles.value : [],
    };

    if (teams.status === 'rejected') errors.teams = teams.reason.message;
    if (projects.status === 'rejected') errors.projects = projects.reason.message;
    if (users.status === 'rejected') errors.users = users.reason.message;
    if (workflowStates.status === 'rejected') errors.workflowStates = workflowStates.reason.message;
    if (labels.status === 'rejected') errors.labels = labels.reason.message;
    if (cycles.status === 'rejected') errors.cycles = cycles.reason.message;

    if (Object.keys(errors).length > 0) {
      response.errors = errors;
      console.warn('[metadata] Partial fetch errors:', errors);
    }

    // Cache the full result (L1)
    metadataCache.set('catalog', response);

    // Persist to L2 (best-effort) — skip on partial failures so we don't poison the cache.
    if (!response.errors) {
      setMetadataCache(response).catch((e) => console.warn('[metadata] L2 persist failed:', e.message));
    }

    res.json({
      ...response,
      cached: false,
    });
  } catch (err: any) {
    console.error('[metadata] Failed to fetch metadata:', err.message);
    res.status(500).json({ error: 'Failed to fetch metadata' });
  }
});

export default router;
