import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${name} must be a number`);
  return parsed;
}

export const env = {
  port: num('PORT', 4001),
  baseUrl: required('CONSUMER_BASE_URL', 'http://localhost:4001').replace(/\/$/, ''),
  /** The `iss` claim of every id_token this platform signs. */
  issuer: required('LTI_ISSUER', process.env.CONSUMER_BASE_URL ?? 'http://localhost:4001').replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL', 'postgres://lti:lti@localhost:5433/lti_consumer'),

  privateKeyPath: required('LTI_PRIVATE_KEY_PATH', './keys/private.pem'),
  publicKeyPath: required('LTI_PUBLIC_KEY_PATH', './keys/public.pem'),
  keyId: required('LTI_KEY_ID', 'platform-key-1'),

  sessionSecret: required('SESSION_SECRET', 'change-me-consumer-session-secret'),
  demoPassword: required('DEMO_PASSWORD', 'demo1234'),

  idTokenTtlSeconds: num('ID_TOKEN_TTL_SECONDS', 300),
  accessTokenTtlSeconds: num('ACCESS_TOKEN_TTL_SECONDS', 3600),

  isProduction: process.env.NODE_ENV === 'production',
};

/** This platform's LTI endpoints - the tool must have these registered. */
export const platformEndpoints = {
  authorizationEndpoint: `${env.baseUrl}/lti/authorize`,
  tokenEndpoint: `${env.baseUrl}/lti/token`,
  jwksUrl: `${env.baseUrl}/.well-known/jwks.json`,
  deepLinkReturnUrl: `${env.baseUrl}/lti/deep-link/return`,
};
