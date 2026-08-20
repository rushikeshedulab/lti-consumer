import type { NextFunction, Request, Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { queryOne } from '../db/pool.js';
import type { PlatformUser } from '../lti/idToken.js';

const secret = new TextEncoder().encode(env.sessionSecret);
export const SESSION_COOKIE = 'lms_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: PlatformUser;
    }
  }
}

export async function issueSession(res: Response, userId: string): Promise<void> {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(env.issuer)
    .setAudience('lms-session')
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret);

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    // First-party only: the LTI flow deliberately does NOT depend on this
    // cookie surviving a cross-site iframe navigation (see login_hint).
    sameSite: 'lax',
    secure: env.baseUrl.startsWith('https://'),
    maxAge: 12 * 3600 * 1000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    try {
      const { payload } = await jwtVerify(token, secret, { issuer: env.issuer, audience: 'lms-session' });
      const user = await queryOne<PlatformUser>(
        `SELECT id, email, name, given_name, family_name, role FROM users WHERE id = $1`,
        [payload.uid as string],
      );
      if (user) req.user = user;
    } catch {
      /* expired or tampered - treated as anonymous */
    }
  }
  next();
}

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'not_authenticated' });
    return;
  }
  next();
}
