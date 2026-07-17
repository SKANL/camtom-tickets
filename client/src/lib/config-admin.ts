import type { ConfigResponse } from '@camtom/shared';

export const CONFIG_ADMIN_SESSION_KEY = 'camtom-config-admin-token';

export class ConfigAdminError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly currentConfig?: ConfigResponse,
  ) {
    super(message);
  }
}

export function readAdminToken(): string {
  try {
    return sessionStorage.getItem(CONFIG_ADMIN_SESSION_KEY) ?? '';
  } catch {
    return '';
  }
}

export function storeAdminToken(token: string): void {
  try {
    if (token) sessionStorage.setItem(CONFIG_ADMIN_SESSION_KEY, token);
    else sessionStorage.removeItem(CONFIG_ADMIN_SESSION_KEY);
  } catch {
    // sessionStorage can be unavailable in locked-down browser profiles
  }
}

export async function updateServerConfig(body: unknown, token: string): Promise<ConfigResponse> {
  const value = token.trim();
  if (!value) throw new ConfigAdminError('Ingresá la clave de administración');

  const response = await fetch('/api/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${value}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    if (response.status === 401) {
      storeAdminToken('');
      throw new ConfigAdminError('La clave de administración no es válida. Ingresala nuevamente.', 401);
    }
    throw new ConfigAdminError(detail.error || `HTTP ${response.status}`, response.status, detail.current);
  }
  return response.json() as Promise<ConfigResponse>;
}
