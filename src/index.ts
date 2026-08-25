import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import { env, platformEndpoints } from './config/env.js';
import { openIdConfigurationDocument } from './config/registration.js';
import { getPublicJwks } from './lti/keys.js';
import { loadUser } from './middleware/session.js';
import { authRouter } from './routes/auth.routes.js';
import { coursesRouter } from './routes/courses.routes.js';
import { ltiRouter } from './routes/lti.routes.js';
import { tokenRouter } from './routes/token.routes.js';
import { servicesRouter } from './routes/services.routes.js';
import { startCatalogSync } from './services/catalogSync.js';

const app = express();
app.set('trust proxy', true);

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));
app.use(cookieParser());
app.use(loadUser);

app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'lti-consumer-lms' }));

/** Public key set - this is what the content provider verifies launches against. */
app.get('/.well-known/jwks.json', async (_req, res) => {
  res.set('cache-control', 'public, max-age=300').json(await getPublicJwks());
});

/**
 * Discovery. Both paths return the same document - OpenID Connect Discovery and
 * LTI Dynamic Registration are specified to look in different places for it.
 * This is what lets a tool configure itself from one pasted address instead of
 * four, and what stops it guessing paths when it finds nothing.
 */
for (const path of ['/.well-known/openid-configuration', '/.well-known/lti-platform-configuration']) {
  app.get(path, (_req, res) => {
    res.set('cache-control', 'public, max-age=300').json(openIdConfigurationDocument);
  });
}

app.use('/api/auth', authRouter);
app.use('/api/courses', coursesRouter);
app.use('/lti', ltiRouter);
app.use('/lti', tokenRouter);
app.use('/lti', servicesRouter);

/**
 * Which requests the single-page app may answer.
 *
 * `/.well-known` is excluded deliberately. Serving index.html there returns
 * HTTP 200 text/html for a document that does not exist, which is
 * indistinguishable from a real one to anything that does not check the
 * content type - the exact reason a tool could not tell a wrong endpoint from a
 * working one. A 404 is the honest answer.
 */
function isFrontendPath(method: string, path: string): boolean {
  if (method !== 'GET') return false;
  return !['/api', '/lti', '/.well-known'].some((prefix) => path.startsWith(prefix));
}

const publicDir = resolve(process.cwd(), 'public');
if (existsSync(publicDir)) {
  app.use(express.static(publicDir, { index: false }));
  app.use((req, res, next) => {
    if (!isFrontendPath(req.method, req.path)) return next();
    res.sendFile(join(publicDir, 'index.html'));
  });
} else {
  app.use((req, res, next) => {
    if (!isFrontendPath(req.method, req.path)) return next();
    res
      .status(503)
      .type('html')
      .send('<h1>Frontend not built</h1><p>Run <code>npm run frontend:build</code> in lti-consumer-lms.</p>');
  });
}

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'internal_error', message: err.message });
});

app.listen(env.port, () => {
  console.log('');
  console.log('  CONSUMER LMS  (role: LTI 1.3 Platform)');
  console.log(`  listening on            ${env.baseUrl}`);
  console.log(`  issuer (iss)            ${env.issuer}`);
  console.log(`  authorization endpoint  ${platformEndpoints.authorizationEndpoint}`);
  console.log(`  token endpoint          ${platformEndpoints.tokenEndpoint}`);
  console.log(`  JWKS                    ${platformEndpoints.jwksUrl}`);
  console.log(`  deep link return URL    ${platformEndpoints.deepLinkReturnUrl}`);
  console.log('');
  // Mirror the provider catalog now and keep it fresh in the background, so
  // content uploaded on the provider side appears here on its own.
  startCatalogSync();
});
