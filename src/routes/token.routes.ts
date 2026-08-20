import { Router } from 'express';
import { SignJWT, createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { env, platformEndpoints } from '../config/env.js';
import { getPrivateKey, SIGNING_ALG } from '../lti/keys.js';
import { findToolByClientId } from '../lti/toolStore.js';

export const tokenRouter = Router();

/**
 * OAUTH 2.0 TOKEN ENDPOINT  (LTI Advantage service authorisation)
 * ---------------------------------------------------------------
 * The tool authenticates with a `private_key_jwt` client assertion signed by
 * its own private key; we verify it against the tool's published JWKS and issue
 * a bearer access token. No shared secret ever exists between the two systems.
 *
 * This is the same grant AGS (grades) and NRPS (rosters) use.
 */

/** Replay protection for client assertions: a jti may be presented once. */
const seenJti = new Map<string, number>();
function rememberJti(jti: string, expSeconds: number): boolean {
  const now = Date.now();
  for (const [key, expiry] of seenJti) if (expiry < now) seenJti.delete(key);
  if (seenJti.has(jti)) return false;
  seenJti.set(jti, expSeconds * 1000);
  return true;
}

tokenRouter.post('/token', async (req, res) => {
  const body = req.body as Record<string, string>;
  const grantType = body.grant_type;
  const assertionType = body.client_assertion_type;
  const assertion = body.client_assertion;
  const scope = body.scope ?? '';

  if (grantType !== 'client_credentials') {
    res.status(400).json({ error: 'unsupported_grant_type' });
    return;
  }
  if (assertionType !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer') {
    res.status(400).json({ error: 'invalid_request', error_description: 'Unsupported client_assertion_type' });
    return;
  }
  if (!assertion) {
    res.status(400).json({ error: 'invalid_request', error_description: 'Missing client_assertion' });
    return;
  }

  let clientId: string;
  try {
    clientId = String(decodeJwt(assertion).iss ?? '');
  } catch {
    res.status(400).json({ error: 'invalid_client', error_description: 'Malformed client_assertion' });
    return;
  }

  const tool = await findToolByClientId(clientId);
  if (!tool) {
    res.status(401).json({ error: 'invalid_client', error_description: 'Unknown client_id' });
    return;
  }

  try {
    const verified = await jwtVerify(assertion, createRemoteJWKSet(new URL(tool.jwks_url)), {
      issuer: tool.client_id,
      // The assertion must be addressed to this exact token endpoint, so it
      // cannot be replayed against a different platform.
      audience: platformEndpoints.tokenEndpoint,
      algorithms: ['RS256'],
      clockTolerance: 30,
      maxTokenAge: 300,
    });
    if (verified.payload.sub !== tool.client_id) {
      res.status(401).json({ error: 'invalid_client', error_description: 'sub must equal the client_id' });
      return;
    }
    const jti = String(verified.payload.jti ?? '');
    if (!jti || !rememberJti(jti, verified.payload.exp ?? 0)) {
      res.status(401).json({ error: 'invalid_client', error_description: 'Missing or replayed jti' });
      return;
    }
  } catch (err) {
    res.status(401).json({ error: 'invalid_client', error_description: (err as Error).message });
    return;
  }

  const accessToken = await new SignJWT({ scope, client_id: tool.client_id })
    .setProtectedHeader({ alg: SIGNING_ALG, kid: env.keyId, typ: 'JWT' })
    .setIssuer(env.issuer)
    .setAudience(env.issuer)
    .setSubject(tool.client_id)
    .setIssuedAt()
    .setExpirationTime(`${env.accessTokenTtlSeconds}s`)
    .sign(await getPrivateKey());

  console.log(`[lti] issued access token to ${tool.client_id} (scope: ${scope || 'none'})`);

  res.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: env.accessTokenTtlSeconds,
    scope,
  });
});
