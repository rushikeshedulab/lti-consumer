import { Router, type NextFunction, type Request, type Response } from 'express';
import { jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { getPublicKey } from '../lti/keys.js';
import { query } from '../db/pool.js';

export const servicesRouter = Router();

const VIEWING_SUMMARY_SCOPE = 'https://edulab.example/lti/scope/viewing.report';

/**
 * Bearer-token guard for platform services. The token is one this platform
 * issued from its own token endpoint, so it verifies against our own public key.
 */
function requireScope(scope: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.get('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) {
      res.status(401).json({ error: 'missing_token' });
      return;
    }
    try {
      const { payload } = await jwtVerify(token, await getPublicKey(), {
        issuer: env.issuer,
        audience: env.issuer,
        algorithms: ['RS256'],
      });
      const granted = String(payload.scope ?? '').split(' ').filter(Boolean);
      if (!granted.includes(scope)) {
        res.status(403).json({ error: 'insufficient_scope', required: scope });
        return;
      }
      next();
    } catch {
      res.status(401).json({ error: 'invalid_token' });
    }
  };
}

/**
 * NOT an LTI specification service - a small demo endpoint that lets the
 * provider report viewing duration back to the LMS. It exists to prove the
 * client_credentials grant works end to end, and to show that the consumer can
 * display "how long did they watch" without ever hosting the video.
 */
servicesRouter.post('/services/viewing-summary', requireScope(VIEWING_SUMMARY_SCOPE), async (req, res) => {
  const { launchId, startedAt, endedAt, presenceSeconds, watchedSeconds } = req.body ?? {};
  if (!launchId) {
    res.status(400).json({ error: 'missing_launch_id' });
    return;
  }

  const updated = await query(
    `UPDATE launch_sessions
        SET reported_started_at    = $2,
            reported_ended_at      = $3,
            reported_presence_secs = $4,
            reported_watched_secs  = $5
      WHERE id = $1
      RETURNING id`,
    [
      String(launchId),
      startedAt ?? null,
      endedAt ?? null,
      Number(presenceSeconds) || 0,
      Number(watchedSeconds) || 0,
    ],
  );

  if (updated.length === 0) {
    res.status(404).json({ error: 'unknown_launch' });
    return;
  }

  console.log(`[service] provider reported ${watchedSeconds}s watched for launch ${launchId}`);
  res.json({ ok: true });
});
