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

/**
 * OPENID CONNECT DISCOVERY / LTI PLATFORM CONFIGURATION
 * ----------------------------------------------------
 * The document a tool reads to configure itself. A platform that publishes
 * nothing forces every tool to guess its endpoint paths from whatever layout it
 * has seen before - and because this project serves index.html for any unknown
 * GET path, a wrong guess answers HTTP 200 and looks alive right up until the
 * launch fails.
 *
 * Built from platformEndpoints, which is also what the routes are mounted from,
 * so the document cannot describe an endpoint this server does not serve.
 */
export const openIdConfigurationDocument = {
  issuer: env.issuer,
  authorization_endpoint: platformEndpoints.authorizationEndpoint,
  token_endpoint: platformEndpoints.tokenEndpoint,
  jwks_uri: platformEndpoints.jwksUrl,

  response_types_supported: ['id_token'],
  response_modes_supported: ['form_post'],
  subject_types_supported: ['public'],
  grant_types_supported: ['implicit', 'client_credentials'],
  id_token_signing_alg_values_supported: ['RS256'],
  token_endpoint_auth_methods_supported: ['private_key_jwt'],
  token_endpoint_auth_signing_alg_values_supported: ['RS256'],
  claims_supported: ['sub', 'iss', 'aud', 'name', 'email'],

  'https://purl.imsglobal.org/spec/lti-platform-configuration': {
    product_family_code: 'edulab-consumer-lms',
    version: '1.0',
    messages_supported: [
      { type: 'LtiResourceLinkRequest' },
      { type: 'LtiDeepLinkingRequest' },
    ],
    variables: [],
  },

  platform_name: platformRegistrationDocument.platform_name,
  deep_link_return_url: platformEndpoints.deepLinkReturnUrl,
  key_id: env.keyId,
};
