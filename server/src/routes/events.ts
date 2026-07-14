import { Router, Request, Response } from 'express';
import { sseManager } from '../sse';
import { getCachedIssues, getAssignmentTimestamps } from '../poller';

const router: Router = Router();

router.get('/api/events', (req: Request, res: Response) => {
  const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  sseManager.addClient(clientId, res);

  // Send current state on connection
  const issues = getCachedIssues();
  if (issues) {
    sseManager.broadcastDelta({
      added: issues,
      serverTime: Date.now(),
      assignmentTimestamps: getAssignmentTimestamps(),
    });
  }

  // Start heartbeat if not already running
  sseManager.startHeartbeat();
});

export default router;
