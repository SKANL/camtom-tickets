import { Router, Request, Response } from 'express';
import { metadataCache } from '../cache';
import {
  fetchTeams,
  fetchProjects,
  fetchUsers,
  fetchWorkflowStates,
  fetchLabels,
  fetchCycles,
} from '../linear-client';

const router: Router = Router();

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
    // Check cache first
    const cached = metadataCache.get('catalog');
    if (cached) {
      res.json({
        ...cached,
        cached: true,
      });
      return;
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

    // Cache the full result
    metadataCache.set('catalog', response);

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
