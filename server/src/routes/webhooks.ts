import { Router, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { Issue } from '@camtom/shared';
import { issueToRow } from '../ticket-mapper';
import { upsertTickets, deleteTicket } from '../supabase';

const router: Router = Router();

const MAX_CLOCK_SKEW_MS = 60_000; // reject webhooks older than 60s (replay protection)

function getSecret(): Buffer {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('WEBHOOK_SECRET environment variable is not set');
  }
  return Buffer.from(secret, 'utf8');
}

/**
 * Verify the HMAC-SHA256 signature Linear sends in the `Linear-Signature` header,
 * computed over the raw request body with the shared secret.
 */
function verifySignature(payload: string, signatureHeader: string): boolean {
  try {
    const secret = getSecret();
    const computed = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    const provided = Buffer.from(signatureHeader, 'utf8');
    const expected = Buffer.from(computed, 'utf8');
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

/** Convert a Linear webhook data object to our Issue type. */
function dataToIssue(d: any): Issue {
  return {
    id: d.id,
    identifier: d.identifier ?? '',
    title: d.title ?? '',
    description: d.description ?? undefined,
    priority: (d.priority ?? 0) as Issue['priority'],
    priorityLabel: d.priorityLabel ?? '',
    createdAt: d.createdAt ?? new Date().toISOString(),
    updatedAt: d.updatedAt ?? new Date().toISOString(),
    dueDate: d.dueDate ?? undefined,
    assignee: d.assignee
      ? { id: d.assignee.id, name: d.assignee.name, email: d.assignee.email }
      : null,
    state: d.state
      ? { id: d.state.id, name: d.state.name, type: d.state.type }
      : { id: '', name: 'Unknown', type: 'unknown' },
    labels: d.labels
      ? { nodes: d.labels.nodes?.map((n: any) => ({ id: n.id, name: n.name, color: n.color })) ?? [] }
      : undefined,
    project: d.project ? { id: d.project.id, name: d.project.name } : null,
    team: d.team ? { id: d.team.id, name: d.team.name } : null,
    cycle: d.cycle ? { id: d.cycle.id, name: d.cycle.name } : null,
    estimate: d.estimate ?? undefined,
  };
}

/**
 * POST /api/webhooks/linear
 *
 * Verifies the Linear signature + timestamp, then writes the change to Supabase.
 * Supabase Realtime pushes the row change to connected browsers.
 *
 * Must be mounted AFTER express.json() with the raw-body verify option (see app.ts).
 */
router.post('/api/webhooks/linear', async (req: Request, res: Response) => {
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    console.warn('[webhook] Missing rawBody — ensure express.json verify captures it');
    return res.status(400).json({ error: 'rawBody required for signature verification' });
  }

  const signature = req.headers['linear-signature'] as string;
  if (!signature || !verifySignature(rawBody, signature)) {
    console.warn('[webhook] Invalid or missing signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body;

  // Replay protection: Linear includes webhookTimestamp (epoch ms).
  if (
    typeof payload?.webhookTimestamp === 'number' &&
    Math.abs(Date.now() - payload.webhookTimestamp) > MAX_CLOCK_SKEW_MS
  ) {
    console.warn('[webhook] Stale webhookTimestamp — rejecting (possible replay)');
    return res.status(401).json({ error: 'Stale webhook' });
  }

  if (!payload || payload.type !== 'Issue') {
    // Not an Issue event — acknowledge so Linear stops retrying.
    return res.status(200).json({ ok: true });
  }

  const { action, data } = payload;
  const issue = dataToIssue(data);

  try {
    if (action === 'remove' || action === 'delete') {
      await deleteTicket(issue.id);
    } else {
      await upsertTickets([issueToRow(issue)]);
    }
    console.log(`[webhook] ${action} ${issue.identifier} written to Supabase`);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    // Return 500 so Linear retries later (and the reconcile job is a second net).
    console.error(`[webhook] Failed to process ${action} ${issue.identifier}: ${err.message}`);
    return res.status(500).json({ error: 'Processing failed' });
  }
});

export default router;
