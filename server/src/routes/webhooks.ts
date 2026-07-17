import { Router, Request, Response } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Issue } from '@camtom/shared';
import { issueToRow } from '../ticket-mapper';
import {
  upsertTickets,
  deleteTicket,
  claimWebhookDelivery,
  completeWebhookDelivery,
  releaseWebhookDelivery,
} from '../supabase';

const router: Router = Router();

const MAX_PAST_AGE_MS = 7 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 60_000;

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
    completedAt: d.completedAt ?? undefined,
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
  const timestamp = payload?.webhookTimestamp;

  if (typeof timestamp !== 'number'
    || Date.now() - timestamp > MAX_PAST_AGE_MS
    || timestamp - Date.now() > MAX_FUTURE_SKEW_MS) {
    console.warn('[webhook] webhookTimestamp outside the retry-safe window');
    return res.status(401).json({ error: 'Invalid webhook timestamp' });
  }

  const deliveryId = req.get('Linear-Delivery');
  if (!deliveryId) {
    return res.status(400).json({ error: 'Linear-Delivery header required' });
  }
  const payloadHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');

  let claim: Awaited<ReturnType<typeof claimWebhookDelivery>>;
  try {
    claim = await claimWebhookDelivery(deliveryId, payloadHash);
  } catch (err: any) {
    console.error(`[webhook] Failed to claim delivery ${deliveryId}: ${err.message}`);
    return res.status(500).json({ error: 'Processing failed' });
  }
  if (claim.status === 'conflict') return res.status(409).json({ error: 'Delivery payload conflict' });
  if (claim.status === 'busy') {
    res.set('Retry-After', '30');
    return res.status(503).json({ error: 'Delivery is already processing' });
  }
  if (claim.status === 'processed') {
    return res.status(200).json({ ok: true, duplicate: true });
  }
  if (!claim.claimToken) {
    console.error(`[webhook] Delivery ${deliveryId} was claimed without an owner token`);
    return res.status(500).json({ error: 'Processing failed' });
  }
  const claimToken = claim.claimToken;

  try {
    if (payload?.type === 'Issue') {
      const { action, data } = payload;
      const issue = dataToIssue(data);
      const eventUpdatedAt = typeof data?.updatedAt === 'string' && Number.isFinite(Date.parse(data.updatedAt))
        ? data.updatedAt
        : new Date(timestamp).toISOString();
      if (action === 'remove' || action === 'delete' || data?.archivedAt) {
        await deleteTicket(issue.id, eventUpdatedAt);
      } else {
        // The database atomically upserts allowed teams or evicts an existing
        // out-of-scope row without creating a permanent deletion tombstone.
        await upsertTickets([issueToRow(issue)]);
      }
      console.log(`[webhook] ${action} ${issue.identifier} processed`);
    }
    await completeWebhookDelivery(deliveryId, payloadHash, claimToken);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    await releaseWebhookDelivery(deliveryId, payloadHash, claimToken).catch((releaseError: Error) => {
      console.error(`[webhook] Failed to release delivery ${deliveryId}: ${releaseError.message}`);
    });
    console.error(`[webhook] Failed to process delivery ${deliveryId}: ${err.message}`);
    return res.status(500).json({ error: 'Processing failed' });
  }
});

export default router;
