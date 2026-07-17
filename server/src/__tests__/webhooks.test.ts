import { createHmac } from 'crypto';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabase', () => ({
  upsertTickets: vi.fn(() => Promise.resolve()),
  deleteTicket: vi.fn(() => Promise.resolve()),
  claimWebhookDelivery: vi.fn(() => Promise.resolve({ status: 'claimed', claimToken: 'claim-1' })),
  completeWebhookDelivery: vi.fn(() => Promise.resolve()),
  releaseWebhookDelivery: vi.fn(() => Promise.resolve()),
}));

const webhookRouter = (await import('../routes/webhooks')).default;
const storage = await import('../supabase');
const app = express();
app.use(express.json({
  verify: (req: Request, _res: Response, buffer: Buffer) => {
    (req as Request & { rawBody: string }).rawBody = buffer.toString('utf8');
  },
}));
app.use(webhookRouter);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'Issue',
    action: 'update',
    webhookTimestamp: Date.now(),
    data: {
      id: 'issue-1', identifier: 'ENG-1', title: 'Ticket', priority: 1, priorityLabel: 'Urgent',
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
      state: { id: 'state', name: 'Open', type: 'started' }, team: { id: 'team', name: 'Team' },
    },
    ...overrides,
  };
}

async function send(body: object, delivery = 'delivery-1') {
  const raw = JSON.stringify(body);
  const signature = createHmac('sha256', process.env.WEBHOOK_SECRET!).update(raw).digest('hex');
  return request(app)
    .post('/api/webhooks/linear')
    .set('Content-Type', 'application/json')
    .set('Linear-Signature', signature)
    .set('Linear-Delivery', delivery)
    .send(raw);
}

describe('Linear webhook reliability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WEBHOOK_SECRET = 'webhook-secret';
    vi.mocked(storage.claimWebhookDelivery).mockResolvedValue({ status: 'claimed', claimToken: 'claim-1' });
    vi.mocked(storage.upsertTickets).mockResolvedValue();
  });

  it('acknowledges an already processed duplicate without another write', async () => {
    vi.mocked(storage.claimWebhookDelivery).mockResolvedValue({ status: 'processed' });
    const response = await send(payload());
    expect(response.status).toBe(200);
    expect(response.body.duplicate).toBe(true);
    expect(storage.upsertTickets).not.toHaveBeenCalled();
  });

  it('rejects a delivery id reused with a different payload hash', async () => {
    vi.mocked(storage.claimWebhookDelivery).mockResolvedValue({ status: 'conflict' });
    const response = await send(payload());
    expect(response.status).toBe(409);
    expect(storage.upsertTickets).not.toHaveBeenCalled();
  });

  it('returns a retryable response while another claim owner is active', async () => {
    vi.mocked(storage.claimWebhookDelivery).mockResolvedValue({ status: 'busy' });
    const response = await send(payload());
    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('30');
    expect(storage.upsertTickets).not.toHaveBeenCalled();
  });

  it('accepts a valid six-hour retry and marks it only after success', async () => {
    const response = await send(payload({ webhookTimestamp: Date.now() - 6 * 60 * 60 * 1_000 }));
    expect(response.status).toBe(200);
    expect(storage.upsertTickets).toHaveBeenCalledOnce();
    expect(storage.completeWebhookDelivery).toHaveBeenCalledWith(
      'delivery-1', expect.stringMatching(/^[a-f0-9]{64}$/), 'claim-1',
    );
  });

  it('deletes explicitly archived issues', async () => {
    const body = payload();
    (body.data as Record<string, unknown>).archivedAt = '2026-01-03T00:00:00.000Z';
    const response = await send(body);
    expect(response.status).toBe(200);
    expect(storage.deleteTicket).toHaveBeenCalledWith('issue-1', '2026-01-02T00:00:00.000Z');
    expect(storage.upsertTickets).not.toHaveBeenCalled();
  });

  it('delegates an active issue scope transition to the database without a delete tombstone', async () => {
    const body = payload();
    (body.data as any).team = { id: 'other-team', name: 'Other' };
    const response = await send(body);

    expect(response.status).toBe(200);
    expect(storage.upsertTickets).toHaveBeenCalledOnce();
    expect(storage.deleteTicket).not.toHaveBeenCalled();
  });

  it('releases failed deliveries so a retry can process them', async () => {
    vi.mocked(storage.upsertTickets).mockRejectedValueOnce(new Error('temporary'));
    const first = await send(payload());
    expect(first.status).toBe(500);
    expect(storage.releaseWebhookDelivery).toHaveBeenCalledWith(
      'delivery-1', expect.stringMatching(/^[a-f0-9]{64}$/), 'claim-1',
    );

    const second = await send(payload(), 'delivery-1');
    expect(second.status).toBe(200);
    expect(storage.completeWebhookDelivery).toHaveBeenCalledOnce();
  });
});
