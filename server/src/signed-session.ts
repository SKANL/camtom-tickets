import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';

export const ADMIN_SESSION_COOKIE = 'camtom_admin_session_v2';
export const DISPLAY_SESSION_COOKIE = 'camtom_display_session_v2';

interface SignedPayload {
  kind: 'admin' | 'display';
  issuedAt: number;
  expiresAt: number;
  deviceId?: string;
  credentialId?: string;
  generation?: number;
}

function sessionKey(rootSecret: string, purpose: SignedPayload['kind']): Buffer {
  return createHmac('sha256', rootSecret).update(`camtom:${purpose}:session:v2`, 'utf8').digest();
}

function equalText(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function constantTimeSecretHash(value: string, serverSecret: string, purpose: string): string {
  return createHmac('sha256', serverSecret).update(`${purpose}:${value}`, 'utf8').digest('hex');
}

export function compareSecretHash(value: string, expectedHash: string, serverSecret: string, purpose: string): boolean {
  return equalText(constantTimeSecretHash(value, serverSecret, purpose), expectedHash);
}

export function signSession(payload: SignedPayload, rootSecret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', sessionKey(rootSecret, payload.kind)).update(encoded, 'utf8').digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifySession(token: string, rootSecret: string, kind: SignedPayload['kind'], now = Date.now()): SignedPayload | null {
  const [encoded, provided, extra] = token.split('.');
  if (!encoded || !provided || extra) return null;
  const expected = createHmac('sha256', sessionKey(rootSecret, kind)).update(encoded, 'utf8').digest('base64url');
  if (!equalText(provided, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedPayload;
    if (payload.kind !== kind || !Number.isSafeInteger(payload.issuedAt) || !Number.isSafeInteger(payload.expiresAt)) return null;
    if (payload.issuedAt > now + 60_000 || payload.expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req: Request): Record<string, string> {
  const result: Record<string, string> = {};
  const header = req.headers.cookie;
  if (!header) return result;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const key = pair.slice(0, separator).trim();
    try { result[key] = decodeURIComponent(pair.slice(separator + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  return result;
}

export function setSecureCookie(res: Response, name: string, value: string, maxAgeSeconds: number): void {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Strict`);
}

export function clearSecureCookie(res: Response, name: string): void {
  res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

export function bearerToken(req: Request): string {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : '';
}

export function isSameOrigin(req: Request): boolean {
  const origin = req.get('origin');
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost || req.get('host');
    if (!host || url.host !== host) return false;
    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const protocol = forwardedProto || req.protocol;
    return url.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export type { SignedPayload };
