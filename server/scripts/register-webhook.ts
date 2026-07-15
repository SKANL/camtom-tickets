/**
 * One-shot setup: ensure the "ticket" label exists and register the Linear webhook.
 *
 * Usage:
 *   pnpm --filter server register:webhook https://<your-app>.vercel.app/api/webhooks/linear
 *
 * Needs LINEAR_API_KEY (+ LINEAR_TEAM_ID) in the environment.
 *
 * NOTE: Linear shows the webhook's signing secret in its dashboard after creation.
 * Copy that value into WEBHOOK_SECRET (Vercel env) so signature verification passes.
 */
import { config as dotenvConfig } from 'dotenv';
import path from 'path';

dotenvConfig({ path: path.resolve(__dirname, '../../.env') });
dotenvConfig({ path: path.resolve(__dirname, '../.env') });

import { ensureLabel, registerWebhook } from '../src/linear-client';

async function main(): Promise<void> {
  const url = process.argv[2] || process.env.WEBHOOK_URL;
  if (!url) {
    throw new Error('Usage: register:webhook <https://.../api/webhooks/linear>');
  }

  console.log('[setup] Ensuring "ticket" label exists...');
  await ensureLabel('ticket');

  console.log(`[setup] Registering webhook -> ${url}`);
  const ok = await registerWebhook(url);
  console.log(ok ? '[setup] Webhook registered ✓' : '[setup] Webhook registration returned false');
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`[setup] Failed: ${err.message}`);
  process.exit(1);
});
