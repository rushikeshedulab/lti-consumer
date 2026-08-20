import { env, platformEndpoints } from './env.js';

/**
 * TOOL REGISTRATION
 * -----------------
 * The platform half of the trust relationship. In a real LMS an administrator
 * creates a developer key, the LMS mints a client_id and deployment_id, and the
 * tool's URLs are pasted in. Here the same values are configured up front and
 * must match lti-content-provider/src/config/registration.ts exactly.
 */
export const defaultToolRegistration = {
  name: process.env.TOOL_NAME ?? 'EduLab Content Provider',
  clientId: process.env.LTI_CLIENT_ID ?? 'edulab-content-provider',
  deploymentId: process.env.LTI_DEPLOYMENT_ID ?? 'deployment-fin-001',
  loginInitiationUrl: process.env.TOOL_LOGIN_INITIATION_URL ?? 'http://localhost:4000/lti/login',
  redirectUris: (process.env.TOOL_REDIRECT_URIS ?? 'http://localhost:4000/lti/launch')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwksUrl: process.env.TOOL_JWKS_URL ?? 'http://localhost:4000/.well-known/jwks.json',
  targetLinkUri: (process.env.TOOL_REDIRECT_URIS ?? 'http://localhost:4000/lti/launch').split(',')[0]!.trim(),
};

/** What the tool's administrator needs from this platform. */
export const platformRegistrationDocument = {
  platform_name: 'EduLab Consumer LMS',
  issuer: env.issuer,
  client_id: defaultToolRegistration.clientId,
  deployment_id: defaultToolRegistration.deploymentId,
  authorization_endpoint: platformEndpoints.authorizationEndpoint,
  token_endpoint: platformEndpoints.tokenEndpoint,
  jwks_uri: platformEndpoints.jwksUrl,
  deep_link_return_url: platformEndpoints.deepLinkReturnUrl,
  key_id: env.keyId,
};
