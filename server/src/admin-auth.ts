import { createHash, timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';

export function authorizeAdmin(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.CONFIG_ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'La administración no está disponible' });
  const header = req.headers.authorization;
  const providedValue = header?.startsWith('Bearer ') ? header.slice(7) : '';
  const provided = createHash('sha256').update(providedValue, 'utf8').digest();
  const secret = createHash('sha256').update(expected, 'utf8').digest();
  if (!timingSafeEqual(provided, secret)) {
    return res.status(401).json({ error: 'Clave de administración inválida' });
  }
  next();
}
