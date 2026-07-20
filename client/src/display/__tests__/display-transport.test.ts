import { describe, expect, it, vi } from 'vitest';
import { createXhrDisplayTransport } from '../display-transport';

class FakeXhr {
  readyState = 0;
  status = 0;
  responseText = '';
  timeout = 0;
  withCredentials = false;
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body = '';

  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body = '') {
    this.body = body;
    this.status = 200;
    this.responseText = JSON.stringify({ deviceId: 'device', deviceToken: 'memory-token', tokenExpiresAt: 'later' });
    this.readyState = 4;
    this.onreadystatechange?.();
  }
}

describe('XHR display transport', () => {
  it('works without fetch or WebSocket and keeps cookie + bearer fallbacks enabled', async () => {
    const originalFetch = globalThis.fetch;
    const originalWebSocket = globalThis.WebSocket;
    // The dedicated transport must never read either capability.
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: undefined });
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: undefined });
    const xhr = new FakeXhr();
    try {
      const result = await createXhrDisplayTransport(() => xhr).createSession(
        { installationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
        'secret-in-fragment',
      );
      expect(result.deviceToken).toBe('memory-token');
      expect(xhr.url).toBe('/api/display/session');
      expect(xhr.headers.Authorization).toBe('Bearer secret-in-fragment');
      expect(xhr.withCredentials).toBe(true);
      expect(xhr.body).not.toContain('query');
    } finally {
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: originalFetch });
      Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: originalWebSocket });
    }
  });

  it('reports JSON API errors without logging request secrets', async () => {
    const xhr = new FakeXhr();
    xhr.send = vi.fn(function send(this: FakeXhr) {
      this.status = 401;
      this.responseText = JSON.stringify({ error: 'Credencial inválida' });
      this.readyState = 4;
      this.onreadystatechange?.();
    });
    await expect(createXhrDisplayTransport(() => xhr).createSession(
      { installationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      'private-secret',
    )).rejects.toMatchObject({ status: 401, message: 'Credencial inválida' });
    expect(xhr.url).not.toContain('private-secret');
  });
});
