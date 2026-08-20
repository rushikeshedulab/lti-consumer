import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { env, platformEndpoints } from '../config/env.js';
import { getPrivateKey, SIGNING_ALG } from './keys.js';
import { CLAIM, LTI_VERSION, MESSAGE_TYPE, ROLE } from './claims.js';
import type { ToolRegistration } from './toolStore.js';

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  given_name: string | null;
  family_name: string | null;
  role: string;
}

export interface CourseContext {
  id: string;
  title: string;
}

export interface ResourceLinkInput {
  id: string;
  title: string;
  description?: string;
  customParams: Record<string, string>;
}

function baseClaims(user: PlatformUser, tool: ToolRegistration, nonce: string) {
  return {
    // --- standard OIDC ---
    sub: user.id,
    nonce,
    jti: randomUUID(),
    name: user.name,
    given_name: user.given_name ?? undefined,
    family_name: user.family_name ?? undefined,
    email: user.email,
    // --- LTI core ---
    [CLAIM.VERSION]: LTI_VERSION,
    [CLAIM.DEPLOYMENT_ID]: tool.deployment_id,
    [CLAIM.TARGET_LINK_URI]: tool.target_link_uri,
    [CLAIM.ROLES]: user.role === 'instructor' ? [ROLE.INSTRUCTOR] : [ROLE.LEARNER],
    [CLAIM.TOOL_PLATFORM]: {
      guid: env.issuer,
      name: 'EduLab Consumer LMS',
      product_family_code: 'edulab-lms',
      version: '1.0',
    },
  };
}

async function sign(payload: Record<string, unknown>, tool: ToolRegistration): Promise<string> {
  const key = await getPrivateKey();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: SIGNING_ALG, kid: env.keyId, typ: 'JWT' })
    .setIssuer(env.issuer)
    .setAudience(tool.client_id)
    .setIssuedAt()
    .setExpirationTime(`${env.idTokenTtlSeconds}s`)
    .sign(key);
}

/**
 * LtiResourceLinkRequest - "this student is opening this specific lecture".
 *
 * The `custom` claim is what lets the provider resolve the exact content
 * without the consumer holding any of it: it carries the provider's own
 * lecture_id, exactly as the provider supplied it during Deep Linking.
 */
export async function buildResourceLinkToken(input: {
  user: PlatformUser;
  tool: ToolRegistration;
  course: CourseContext;
  resourceLink: ResourceLinkInput;
  nonce: string;
  returnUrl: string;
}): Promise<string> {
  const payload = {
    ...baseClaims(input.user, input.tool, input.nonce),
    [CLAIM.MESSAGE_TYPE]: MESSAGE_TYPE.RESOURCE_LINK_REQUEST,
    [CLAIM.RESOURCE_LINK]: {
      id: input.resourceLink.id,
      title: input.resourceLink.title,
      description: input.resourceLink.description ?? '',
    },
    [CLAIM.CONTEXT]: {
      id: input.course.id,
      label: input.course.id,
      title: input.course.title,
      type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'],
    },
    [CLAIM.LAUNCH_PRESENTATION]: {
      document_target: 'iframe',
      return_url: input.returnUrl,
    },
    [CLAIM.CUSTOM]: input.resourceLink.customParams,
    [CLAIM.LIS]: {
      person_sourcedid: input.user.id,
      course_offering_sourcedid: input.course.id,
    },
  };
  return sign(payload, input.tool);
}

/** LtiDeepLinkingRequest - "show me what content you have so I can add it". */
export async function buildDeepLinkingToken(input: {
  user: PlatformUser;
  tool: ToolRegistration;
  course: CourseContext;
  nonce: string;
  data: string;
}): Promise<string> {
  const payload = {
    ...baseClaims(input.user, input.tool, input.nonce),
    [CLAIM.MESSAGE_TYPE]: MESSAGE_TYPE.DEEP_LINKING_REQUEST,
    [CLAIM.CONTEXT]: {
      id: input.course.id,
      label: input.course.id,
      title: input.course.title,
      type: ['http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering'],
    },
    [CLAIM.DEEP_LINKING_SETTINGS]: {
      deep_link_return_url: platformEndpoints.deepLinkReturnUrl,
      accept_types: ['ltiResourceLink'],
      accept_presentation_document_targets: ['iframe', 'window'],
      accept_multiple: true,
      auto_create: false,
      title: `Add lectures to ${input.course.title}`,
      // Opaque round-trip value: the tool must echo it back untouched, which is
      // how we know the response belongs to this request.
      data: input.data,
    },
  };
  return sign(payload, input.tool);
}
