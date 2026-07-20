import type { Request, Response } from 'express';
import { Router } from 'express';
import type { ClaimDisplayPairingV2Request, DisplaySyncRequest, ScreenState } from '@camtom/shared';
import { validateScreenState } from '@camtom/shared';
import { authorizeAdmin } from '../admin-auth';
import { ensureConfig } from '../config';
import { getScreenControlFeatures, normalizePairingCode } from '../screen-control';
import {
  authorizeDisplayTokenV2,
  claimDisplayPairingV2,
  createDisplayPairingV2,
  createDisplaySessionV2,
  getDisplayPairingStatusV2,
  revokeDisplayDeviceV2,
  rotateDisplayCredentialV2,
  sanitizeCapabilities,
  syncDisplayV2,
} from '../screen-protocol-v2';
import {
  ADMIN_SESSION_COOKIE,
  DISPLAY_SESSION_COOKIE,
  bearerToken,
  clearSecureCookie,
  isSameOrigin,
  parseCookies,
  setSecureCookie,
  signSession,
} from '../signed-session';
import { configuredTeamIds } from '../team-scope';
import { trustedPlatformIp } from './screens';

const router: Router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADMIN_SESSION_SECONDS = 30 * 24 * 60 * 60;
const DISPLAY_SESSION_SECONDS = 15 * 60;

function enabled(res: Response): boolean {
  if (getScreenControlFeatures().screenControlEnabled) return true;
  res.status(404).json({ error: 'El control de pantallas no está habilitado' });
  return false;
}

function rejectCrossOrigin(req: Request, res: Response): boolean {
  if (!req.get('origin') || isSameOrigin(req)) return false;
  res.status(403).json({ error: 'Origen inválido' });
  return true;
}

function validCapabilities(value: unknown): boolean {
  try { sanitizeCapabilities(value); return true; } catch { return false; }
}

async function validateClaimBody(body: any, replacementForDeviceId?: string): Promise<ClaimDisplayPairingV2Request | null> {
  const { code, requestId, name, allowedTeamIds, desiredState } = body ?? {};
  if (typeof code !== 'string' || normalizePairingCode(code) === 'invalid'
    || typeof requestId !== 'string' || !UUID.test(requestId)
    || typeof name !== 'string' || !name.trim() || name.length > 80
    || !Array.isArray(allowedTeamIds) || allowedTeamIds.length < 1 || allowedTeamIds.length > 50
    || allowedTeamIds.some((id: unknown) => typeof id !== 'string' || !id.trim())
    || (replacementForDeviceId && !UUID.test(replacementForDeviceId))) return null;
  const configured = configuredTeamIds(await ensureConfig());
  if (allowedTeamIds.some((id: string) => !configured.includes(id))) return null;
  if (validateScreenState(desiredState, allowedTeamIds).length > 0) return null;
  return {
    code: normalizePairingCode(code), requestId, name: name.trim(), allowedTeamIds,
    desiredState: desiredState as ScreenState,
    ...(replacementForDeviceId ? { replacementForDeviceId } : {}),
  };
}

router.post('/api/display/pairings', async (req, res) => {
  try {
    if (!enabled(res) || rejectCrossOrigin(req, res)) return;
    if (typeof req.body?.requestId !== 'string' || !UUID.test(req.body.requestId)
      || !validCapabilities(req.body?.capabilities)) {
      return res.status(400).json({ error: 'Solicitud de vinculación inválida' });
    }
    return res.status(201).json(await createDisplayPairingV2(req.body.requestId, trustedPlatformIp(req)));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pairing failed';
    if (message.includes('rate limit') || message.includes('capacity')) {
      res.set('Retry-After', '900');
      return res.status(429).json({ error: 'Demasiados intentos. Esperá quince minutos.' });
    }
    if (message.includes('replay')) return res.status(409).json({ error: 'La solicitud ya fue utilizada' });
    console.error('[display-v2] pairing creation failed:', message);
    return res.status(500).json({ error: 'No se pudo iniciar la vinculación' });
  }
});

router.post('/api/display/pairings/:id/status', async (req, res) => {
  try {
    if (!enabled(res) || rejectCrossOrigin(req, res)) return;
    if (!UUID.test(req.params.id) || !bearerToken(req)) return res.status(401).json({ error: 'Credencial de pantalla inválida' });
    const status = await getDisplayPairingStatusV2(req.params.id, bearerToken(req));
    if (status.cookieToken) setSecureCookie(res, DISPLAY_SESSION_COOKIE, status.cookieToken, DISPLAY_SESSION_SECONDS);
    const { cookieToken: _cookieToken, ...body } = status;
    return res.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'status failed';
    if (message.includes('credential invalid')) return res.status(401).json({ error: 'Credencial de pantalla inválida' });
    console.error('[display-v2] pairing status failed:', message);
    return res.status(500).json({ error: 'No se pudo consultar la vinculación' });
  }
});

router.post('/api/display/session', async (req, res) => {
  try {
    if (!enabled(res) || rejectCrossOrigin(req, res)) return;
    if (typeof req.body?.installationId !== 'string' || !UUID.test(req.body.installationId) || !bearerToken(req)) {
      return res.status(401).json({ error: 'Credencial de pantalla inválida' });
    }
    const session = await createDisplaySessionV2(req.body.installationId, bearerToken(req));
    setSecureCookie(res, DISPLAY_SESSION_COOKIE, session.cookieToken, DISPLAY_SESSION_SECONDS);
    const { cookieToken: _cookieToken, ...body } = session;
    return res.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'session failed';
    if (message.includes('credential invalid')) return res.status(401).json({ error: 'Credencial de pantalla inválida' });
    console.error('[display-v2] session creation failed:', message);
    return res.status(500).json({ error: 'No se pudo iniciar la sesión de pantalla' });
  }
});

router.post('/api/display/sync', async (req, res) => {
  try {
    if (!enabled(res)) return;
    const cookieToken = parseCookies(req)[DISPLAY_SESSION_COOKIE];
    const token = bearerToken(req) || cookieToken;
    if (!bearerToken(req) && cookieToken && !isSameOrigin(req)) return res.status(403).json({ error: 'Origen inválido' });
    const body = req.body as DisplaySyncRequest;
    if (!token || !Number.isSafeInteger(body?.appliedStateVersion) || body.appliedStateVersion < 0
      || (body.ticketVersion != null && typeof body.ticketVersion !== 'string')
      || (body.configVersion != null && typeof body.configVersion !== 'string')
      || !validCapabilities(body.capabilities)) return res.status(400).json({ error: 'Sincronización inválida' });
    const credential = await authorizeDisplayTokenV2(token);
    const response = await syncDisplayV2(credential, body);
    if (response.deviceToken) setSecureCookie(res, DISPLAY_SESSION_COOKIE, response.deviceToken, DISPLAY_SESSION_SECONDS);
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'sync failed';
    if (message.includes('session invalid') || message.includes('session revoked')) {
      clearSecureCookie(res, DISPLAY_SESSION_COOKIE);
      return res.status(401).json({ error: 'Sesión de pantalla inválida' });
    }
    console.error('[display-v2] sync failed:', message);
    return res.status(500).json({ error: 'No se pudo sincronizar la pantalla' });
  }
});

router.post('/api/control/session', authorizeAdmin, (req, res) => {
  const secret = process.env.CONFIG_ADMIN_TOKEN!;
  const now = Date.now();
  const token = signSession({ kind: 'admin', issuedAt: now, expiresAt: now + ADMIN_SESSION_SECONDS * 1_000 }, secret);
  setSecureCookie(res, ADMIN_SESSION_COOKIE, token, ADMIN_SESSION_SECONDS);
  return res.json({ authenticated: true, expiresAt: new Date(now + ADMIN_SESSION_SECONDS * 1_000).toISOString() });
});

router.get('/api/control/session', authorizeAdmin, (_req, res) => res.json({ authenticated: true }));

router.delete('/api/control/session', authorizeAdmin, (_req, res) => {
  clearSecureCookie(res, ADMIN_SESSION_COOKIE);
  return res.json({ authenticated: false });
});

router.post('/api/control/display/pairings/claim', authorizeAdmin, async (req, res) => {
  try {
    if (!enabled(res)) return;
    const input = await validateClaimBody(req.body, req.body?.replacementForDeviceId);
    if (!input) return res.status(400).json({ error: 'Datos de vinculación inválidos' });
    const device = await claimDisplayPairingV2(input);
    return device ? res.status(201).json(device) : res.status(400).json({ error: 'Código inválido, vencido o ya utilizado' });
  } catch (error) {
    console.error('[display-v2] controller claim failed:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'No se pudo vincular la pantalla' });
  }
});

router.post('/api/control/display/devices/:id/replace', authorizeAdmin, async (req, res) => {
  try {
    if (!enabled(res)) return;
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Pantalla inválida' });
    const input = await validateClaimBody(req.body, req.params.id);
    if (!input) return res.status(400).json({ error: 'Datos de reemplazo inválidos' });
    const device = await claimDisplayPairingV2(input);
    return device ? res.status(201).json(device) : res.status(400).json({ error: 'Código inválido, vencido o ya utilizado' });
  } catch (error) {
    console.error('[display-v2] replacement claim failed:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'No se pudo preparar el reemplazo' });
  }
});

router.post('/api/control/display/devices/:id/revoke', authorizeAdmin, async (req, res) => {
  try {
    if (!enabled(res)) return;
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Pantalla inválida' });
    return await revokeDisplayDeviceV2(req.params.id) ? res.json({ ok: true }) : res.status(404).json({ error: 'Pantalla no encontrada' });
  } catch (error) {
    console.error('[display-v2] revoke failed:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'No se pudo revocar la pantalla' });
  }
});

router.post('/api/control/display/devices/:id/rotate', authorizeAdmin, async (req, res) => {
  try {
    if (!enabled(res)) return;
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Pantalla inválida' });
    const rotated = await rotateDisplayCredentialV2(req.params.id);
    return rotated ? res.json(rotated) : res.status(404).json({ error: 'Pantalla no encontrada' });
  } catch (error) {
    console.error('[display-v2] credential rotation failed:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'No se pudo rotar la credencial' });
  }
});

export default router;
