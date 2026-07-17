import { Request, Response, Router } from 'express';
import { isIP } from 'net';
import { ScreenState, validateScreenState } from '@camtom/shared';
import { authorizeAdmin } from '../admin-auth';
import { ensureConfig } from '../config';
import { configuredTeamIds } from '../team-scope';
import {
  authorizeScreenIdentity,
  claimScreenPairing,
  filterConfigForScreen,
  getActiveScreenDevice,
  getScreenControlFeatures,
  listScreenDevices,
  revokeScreenDevice,
  setScreenDesiredState,
  startScreenPairing,
  normalizePairingCode,
} from '../screen-control';

const router: Router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearer(req: Request): string {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : '';
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0
    && value.length <= 50 && value.every((item) => typeof item === 'string' && !!item.trim());
}

/** Trust only the platform-owned header, and only while running on Vercel. */
export function trustedPlatformIp(req: Request): string | null {
  if (process.env.VERCEL !== '1') return null;
  const raw = req.headers['x-vercel-forwarded-for'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const first = value.split(',')[0]?.trim() ?? '';
  return isIP(first) ? first : null;
}

router.get('/api/screens/features', (_req, res) => {
  res.json(getScreenControlFeatures());
});

router.post('/api/screens/pairings/start', async (req: Request, res: Response) => {
  try {
    const features = getScreenControlFeatures();
    if (!features.screenControlEnabled) {
      return res.status(404).json({ error: 'El control de pantallas no está habilitado' });
    }
    if (features.configurationError) return res.status(503).json({ error: features.configurationError });
    if (typeof req.body?.requestId !== 'string' || !UUID.test(req.body.requestId)) {
      return res.status(400).json({ error: 'requestId inválido' });
    }
    const authUserId = await authorizeScreenIdentity(bearer(req));
    const pairing = await startScreenPairing(authUserId, req.body.requestId, trustedPlatformIp(req));
    return res.status(201).json(pairing);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pairing failed';
    if (message.includes('rate limit')) {
      res.set('Retry-After', '300');
      return res.status(429).json({ error: 'Demasiados intentos. Esperá cinco minutos.' });
    }
    if (message.includes('authentication')) return res.status(401).json({ error: 'Identidad de pantalla inválida' });
    if (message.includes('already paired')) return res.status(409).json({ error: 'La pantalla ya está vinculada' });
    if (message.includes('request already used')) return res.status(409).json({ error: 'La solicitud de vinculación ya fue utilizada' });
    console.error('[screens] pairing start failed:', message);
    return res.status(500).json({ error: 'No se pudo iniciar la vinculación' });
  }
});

router.get('/api/screens/device-config', async (req: Request, res: Response) => {
  try {
    const features = getScreenControlFeatures();
    if (features.configurationError) return res.status(503).json({ error: features.configurationError });
    const authUserId = await authorizeScreenIdentity(bearer(req));
    const device = await getActiveScreenDevice(authUserId);
    if (!device?.paired_at || device.revoked_at) return res.status(404).json({ error: 'Pantalla no vinculada' });
    const config = await ensureConfig();
    return res.json(filterConfigForScreen(config, device.allowed_team_ids ?? []));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'screen config failed';
    if (message.includes('authentication')) return res.status(401).json({ error: 'Identidad de pantalla inválida' });
    console.error('[screens] device config failed:', message);
    return res.status(500).json({ error: 'No se pudo cargar la configuración de pantalla' });
  }
});

router.get('/api/screens/devices', authorizeAdmin, async (_req, res) => {
  try {
    return res.json({ devices: await listScreenDevices() });
  } catch (error) {
    console.error('[screens] device list failed:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'No se pudieron listar las pantallas' });
  }
});

router.post('/api/screens/pairings/claim', authorizeAdmin, async (req: Request, res: Response) => {
  try {
    const features = getScreenControlFeatures();
    if (!features.screenControlEnabled) {
      return res.status(404).json({ error: 'El control de pantallas no está habilitado' });
    }
    if (features.configurationError) return res.status(503).json({ error: features.configurationError });
    const { code, requestId, name, allowedTeamIds, desiredState } = req.body ?? {};
    if (typeof code !== 'string' || !/^\d{6}$/.test(normalizePairingCode(code))
      || typeof requestId !== 'string' || !UUID.test(requestId)
      || typeof name !== 'string' || !name.trim() || name.length > 80
      || !stringArray(allowedTeamIds)) {
      return res.status(400).json({ error: 'Datos de vinculación inválidos' });
    }
    const config = await ensureConfig();
    const configured = configuredTeamIds(config);
    if (allowedTeamIds.some((id: string) => !configured.includes(id))) {
      return res.status(400).json({ error: 'Uno o más teams no están habilitados' });
    }
    const stateErrors = validateScreenState(desiredState, allowedTeamIds);
    if (stateErrors.length > 0) return res.status(400).json({ error: stateErrors.join('; ') });
    const device = await claimScreenPairing({
      code,
      requestId,
      name: name.trim(),
      allowedTeamIds,
      desiredState: desiredState as ScreenState,
      trustedIp: trustedPlatformIp(req),
    });
    if (!device) return res.status(400).json({ error: 'Código inválido, vencido o ya utilizado' });
    return res.status(201).json(device);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pairing claim failed';
    if (message.includes('rate limit')) {
      res.set('Retry-After', '300');
      return res.status(429).json({ error: 'Demasiados intentos. Esperá cinco minutos.' });
    }
    console.error('[screens] pairing claim failed:', message);
    return res.status(500).json({ error: 'No se pudo vincular la pantalla' });
  }
});

router.put('/api/screens/devices/:id/state', authorizeAdmin, async (req: Request, res: Response) => {
  try {
    const features = getScreenControlFeatures();
    if (!features.screenControlEnabled) {
      return res.status(404).json({ error: 'El control de pantallas no está habilitado' });
    }
    if (features.configurationError) return res.status(503).json({ error: features.configurationError });
    const { desiredState, allowedTeamIds, expectedVersion, requestId } = req.body ?? {};
    if (!UUID.test(req.params.id) || !UUID.test(requestId ?? '') || !stringArray(allowedTeamIds)
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      return res.status(400).json({ error: 'Comando de pantalla inválido' });
    }
    const config = await ensureConfig();
    const configured = configuredTeamIds(config);
    if (allowedTeamIds.some((id: string) => !configured.includes(id))) {
      return res.status(400).json({ error: 'Uno o más teams no están habilitados' });
    }
    const stateErrors = validateScreenState(desiredState, allowedTeamIds);
    if (stateErrors.length > 0) return res.status(400).json({ error: stateErrors.join('; ') });
    const device = await setScreenDesiredState({
      deviceId: req.params.id,
      desiredState: desiredState as ScreenState,
      allowedTeamIds,
      expectedVersion,
      requestId,
    });
    return res.json(device);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'screen command failed';
    if (message.includes('version conflict') || message.includes('request id payload conflict')) {
      return res.status(409).json({ error: 'La pantalla cambió; actualizá antes de volver a aplicar' });
    }
    if (message.includes('outside')) return res.status(400).json({ error: 'El estado usa teams no autorizados' });
    console.error('[screens] state update failed:', message);
    return res.status(500).json({ error: 'No se pudo actualizar la pantalla' });
  }
});

router.post('/api/screens/devices/:id/revoke', authorizeAdmin, async (req: Request, res: Response) => {
  try {
    const features = getScreenControlFeatures();
    if (!features.screenControlEnabled) {
      return res.status(404).json({ error: 'El control de pantallas no está habilitado' });
    }
    if (features.configurationError) return res.status(503).json({ error: features.configurationError });
    if (!UUID.test(req.params.id)) return res.status(400).json({ error: 'Pantalla inválida' });
    if (!await revokeScreenDevice(req.params.id)) return res.status(404).json({ error: 'Pantalla no encontrada' });
    return res.json({ ok: true });
  } catch (error) {
    console.error('[screens] revoke failed:', error instanceof Error ? error.message : 'unknown');
    return res.status(500).json({ error: 'No se pudo revocar la pantalla' });
  }
});

export default router;
