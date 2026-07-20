import type {
  CreateDisplayPairingRequest,
  CreateDisplayPairingResponse,
  CreateDisplaySessionRequest,
  CreateDisplaySessionResponse,
  DisplayPairingStatusResponse,
  DisplaySyncRequest,
  DisplaySyncResponse,
} from '@camtom/shared';

export class DisplayTransportError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'DisplayTransportError';
  }
}

export interface DisplayTransport {
  createPairing(body: CreateDisplayPairingRequest): Promise<CreateDisplayPairingResponse>;
  pairingStatus(pairingId: string, installationSecret: string): Promise<DisplayPairingStatusResponse>;
  createSession(body: CreateDisplaySessionRequest, installationSecret: string): Promise<CreateDisplaySessionResponse>;
  sync(body: DisplaySyncRequest, deviceToken?: string): Promise<DisplaySyncResponse>;
}

interface XhrLike {
  readyState: number;
  status: number;
  responseText: string;
  timeout: number;
  withCredentials: boolean;
  onreadystatechange: (() => void) | null;
  onerror: (() => void) | null;
  ontimeout: (() => void) | null;
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(body?: string): void;
}

type XhrFactory = () => XhrLike;

function defaultXhrFactory(): XhrLike {
  if (typeof XMLHttpRequest === 'undefined') {
    throw new DisplayTransportError('Este navegador no incluye XMLHttpRequest (XHR).');
  }
  return new XMLHttpRequest() as unknown as XhrLike;
}

function readError(body: unknown, status: number): string {
  if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error;
  }
  return `HTTP ${status}`;
}

/** XHR is intentional: embedded TV browsers frequently lack fetch and WebSocket. */
export function createXhrDisplayTransport(factory: XhrFactory = defaultXhrFactory): DisplayTransport {
  const request = <T>(method: string, url: string, body: unknown, token?: string): Promise<T> => new Promise((resolve, reject) => {
    let xhr: XhrLike;
    try {
      xhr = factory();
      xhr.open(method, url, true);
      xhr.timeout = 20_000;
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    } catch (error) {
      reject(error instanceof Error ? error : new DisplayTransportError('No se pudo iniciar XHR.'));
      return;
    }

    let settled = false;
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value as T);
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      let parsed: unknown = {};
      try { parsed = xhr.responseText ? JSON.parse(xhr.responseText) : {}; } catch { /* invalid JSON is reported below */ }
      if (xhr.status >= 200 && xhr.status < 300) finish(undefined, parsed as T);
      else finish(new DisplayTransportError(readError(parsed, xhr.status), xhr.status));
    };
    xhr.onerror = () => finish(new DisplayTransportError('No hay conexión con el servidor.'));
    xhr.ontimeout = () => finish(new DisplayTransportError('La sincronización agotó el tiempo de espera.'));
    try { xhr.send(JSON.stringify(body)); } catch (error) {
      finish(error instanceof Error ? error : new DisplayTransportError('No se pudo enviar XHR.'));
    }
  });

  return {
    createPairing: (body) => request('POST', '/api/display/pairings', body),
    pairingStatus: (pairingId, installationSecret) => request(
      'POST',
      `/api/display/pairings/${encodeURIComponent(pairingId)}/status`,
      {},
      installationSecret,
    ),
    createSession: (body, installationSecret) => request(
      'POST', '/api/display/session', body, installationSecret,
    ),
    sync: (body, deviceToken) => request('POST', '/api/display/sync', body, deviceToken),
  };
}
