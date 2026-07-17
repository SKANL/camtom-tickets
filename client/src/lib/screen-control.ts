import type {
  ConfigResponse,
  ScreenControlFeatures,
  ScreenDevice,
  ScreenState,
} from '@camtom/shared';

export class ScreenControlError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export function createRequestId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function jsonRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ScreenControlError(body.error || `HTTP ${response.status}`, response.status);
  return body as T;
}

function adminHeaders(token: string): HeadersInit {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}` };
}

export function fetchScreenFeatures(): Promise<ScreenControlFeatures> {
  return jsonRequest('/api/screens/features');
}

interface TurnstileApi {
  render(container: HTMLElement, options: {
    sitekey: string;
    appearance: 'interaction-only';
    callback: (token: string) => void;
    'error-callback': () => void;
    'expired-callback': () => void;
  }): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let turnstileScript: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (turnstileScript) return turnstileScript;
  turnstileScript = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.dataset.screenTurnstile = 'true';
    script.onload = () => window.turnstile
      ? resolve()
      : reject(new Error('Turnstile no quedó disponible después de cargar el script'));
    script.onerror = () => reject(new Error('No se pudo cargar CAPTCHA Turnstile'));
    document.head.appendChild(script);
  }).catch((error) => {
    turnstileScript = null;
    throw error;
  });
  return turnstileScript;
}

/** Returns a single-use CAPTCHA token; undefined is allowed only in explicitly ungated non-production mode. */
export async function requestScreenCaptchaToken(features: ScreenControlFeatures): Promise<string | undefined> {
  if (features.configurationError) throw new Error(features.configurationError);
  if (!features.captchaProvider && !features.captchaSiteKey) return undefined;
  if (features.captchaProvider !== 'turnstile' || !features.captchaSiteKey) {
    throw new Error('La configuración CAPTCHA de la pantalla está incompleta.');
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('CAPTCHA Turnstile requiere un navegador.');
  }
  await loadTurnstile();
  const api = window.turnstile;
  if (!api) throw new Error('CAPTCHA Turnstile no está disponible.');

  const container = document.createElement('div');
  container.setAttribute('aria-label', 'Screen verification');
  Object.assign(container.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center',
    pointerEvents: 'auto',
  });
  document.body.appendChild(container);

  return new Promise<string>((resolve, reject) => {
    let widgetId: string | null = null;
    let settled = false;
    let timeout = 0;
    const finish = (error?: Error, token?: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      if (widgetId) api.remove(widgetId);
      container.remove();
      if (error) reject(error);
      else if (token) resolve(token);
      else reject(new Error('CAPTCHA Turnstile no devolvió un token.'));
    };
    timeout = window.setTimeout(() => finish(new Error('CAPTCHA Turnstile agotó el tiempo de espera.')), 30_000);
    try {
      widgetId = api.render(container, {
        sitekey: features.captchaSiteKey!,
        appearance: 'interaction-only',
        callback: (token) => finish(undefined, token),
        'error-callback': () => finish(new Error('CAPTCHA Turnstile rechazó la verificación.')),
        'expired-callback': () => finish(new Error('El token CAPTCHA Turnstile expiró.')),
      });
    } catch (error) {
      finish(error instanceof Error ? error : new Error('No se pudo iniciar CAPTCHA Turnstile.'));
    }
  });
}

export function startPairing(accessToken: string, requestId: string): Promise<{
  pairingId: string;
  code: string;
  expiresAt: string;
}> {
  return jsonRequest('/api/screens/pairings/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ requestId }),
  });
}

export function fetchDeviceConfig(accessToken: string): Promise<ConfigResponse> {
  return jsonRequest('/api/screens/device-config', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export async function listDevices(token: string): Promise<ScreenDevice[]> {
  const result = await jsonRequest<{ devices: ScreenDevice[] }>('/api/screens/devices', {
    headers: adminHeaders(token),
  });
  return result.devices;
}

export function claimPairing(token: string, input: {
  code: string;
  requestId: string;
  name: string;
  allowedTeamIds: string[];
  desiredState: ScreenState;
}): Promise<ScreenDevice> {
  return jsonRequest('/api/screens/pairings/claim', {
    method: 'POST', headers: adminHeaders(token), body: JSON.stringify(input),
  });
}

export function updateDevice(token: string, deviceId: string, input: {
  desiredState: ScreenState;
  allowedTeamIds: string[];
  expectedVersion: number;
  requestId: string;
}): Promise<ScreenDevice> {
  return jsonRequest(`/api/screens/devices/${encodeURIComponent(deviceId)}/state`, {
    method: 'PUT', headers: adminHeaders(token), body: JSON.stringify(input),
  });
}

export function revokeDevice(token: string, deviceId: string): Promise<{ ok: true }> {
  return jsonRequest(`/api/screens/devices/${encodeURIComponent(deviceId)}/revoke`, {
    method: 'POST', headers: adminHeaders(token), body: '{}',
  });
}

export function deviceCapabilities(): Record<string, unknown> {
  return {
    websocket: typeof WebSocket !== 'undefined',
    viewport: { width: window.innerWidth, height: window.innerHeight },
    touch: 'ontouchstart' in window,
    schemaVersion: 1,
  };
}
