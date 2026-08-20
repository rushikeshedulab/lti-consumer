import { Router } from 'express';
import { env } from '../config/env.js';
import { query, queryOne } from '../db/pool.js';
import { clearSession, issueSession, requireUser } from '../middleware/session.js';
import type { PlatformUser } from '../lti/idToken.js';

export const authRouter = Router();

/**
 * Demo authentication only: every seeded user shares DEMO_PASSWORD. Real
 * password handling is deliberately out of scope - what matters for this
 * demonstration is that the platform knows WHO is launching, because that
 * identity is what gets signed into the LTI id_token.
 */
authRouter.get('/demo-users', async (_req, res) => {
  const users = await query<{ id: string; email: string; name: string; role: string }>(
    `SELECT id, email, name, role FROM users ORDER BY role DESC, name`,
  );
  res.json({ users, password: env.demoPassword });
});

authRouter.post('/login', async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');

  const user = await queryOne<PlatformUser>(
    `SELECT id, email, name, given_name, family_name, role FROM users WHERE lower(email) = $1`,
    [email],
  );
  if (!user || password !== env.demoPassword) {
    res.status(401).json({ error: 'invalid_credentials', message: 'Unknown email or wrong password.' });
    return;
  }

  await issueSession(res, user.id);
  res.json({ user });
});

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user });
});
