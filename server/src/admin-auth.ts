import { createHash, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { ADMIN_SESSION_COOKIE, bearerToken, isSameOrigin, parseCookies, verifySession } from './signed-session';

export type AdminAuthKind = 'bearer' | 'cookie';

export function adminAuthKind(req: Request): AdminAuthKind | null {
  const expected = process.env.CONFIG_ADMIN_TOKEN;
  if (!expected) return null;
  const providedValue = bearerToken(req);
  const provided = createHash('sha256').update(providedValue, 'utf8').digest();
  const secret = createHash('sha256').update(expected, 'utf8').digest();
  if (timingSafeEqual(provided, secret)) return 'bearer';
  const session = parseCookies(req)[ADMIN_SESSION_COOKIE];
  return session && verifySession(session, expected, 'admin') ? 'cookie' : null;
}

export function authorizeAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CONFIG_ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'La administración no está disponible' });
  const kind = adminAuthKind(req);
  if (!kind) {
    return res.status(401).json({ error: 'Clave de administración inválida' });
  }
  if (kind === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isSameOrigin(req)) {
    return res.status(403).json({ error: 'Origen inválido' });
  }
  res.locals.adminAuthKind = kind;
  next();
}
