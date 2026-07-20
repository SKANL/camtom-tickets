import type { ConfigResponse } from '@camtom/shared';

let inMemoryAdminToken = '';

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
  return inMemoryAdminToken;
}

export function storeAdminToken(token: string): void {
  inMemoryAdminToken = token;
}

export async function updateServerConfig(body: unknown, token: string): Promise<ConfigResponse> {
  const value = token.trim();
  if (!value) throw new ConfigAdminError('Ingresá la clave de administración');

  const response = await fetch('/api/config', {
    method: 'PUT',
    credentials: 'same-origin',
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
