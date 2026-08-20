/**
 * LTI 1.3 claim URIs. Duplicated in the provider project on purpose - these are
 * two independent applications that share only the wire protocol.
 */
export const CLAIM = {
  MESSAGE_TYPE: 'https://purl.imsglobal.org/spec/lti/claim/message_type',
  VERSION: 'https://purl.imsglobal.org/spec/lti/claim/version',
  DEPLOYMENT_ID: 'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  TARGET_LINK_URI: 'https://purl.imsglobal.org/spec/lti/claim/target_link_uri',
  RESOURCE_LINK: 'https://purl.imsglobal.org/spec/lti/claim/resource_link',
  CONTEXT: 'https://purl.imsglobal.org/spec/lti/claim/context',
  ROLES: 'https://purl.imsglobal.org/spec/lti/claim/roles',
  TOOL_PLATFORM: 'https://purl.imsglobal.org/spec/lti/claim/tool_platform',
  LAUNCH_PRESENTATION: 'https://purl.imsglobal.org/spec/lti/claim/launch_presentation',
  CUSTOM: 'https://purl.imsglobal.org/spec/lti/claim/custom',
  LIS: 'https://purl.imsglobal.org/spec/lti/claim/lis',
  DEEP_LINKING_SETTINGS: 'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings',
  CONTENT_ITEMS: 'https://purl.imsglobal.org/spec/lti-dl/claim/content_items',
  DEEP_LINKING_DATA: 'https://purl.imsglobal.org/spec/lti-dl/claim/data',
} as const;

export const MESSAGE_TYPE = {
  RESOURCE_LINK_REQUEST: 'LtiResourceLinkRequest',
  DEEP_LINKING_REQUEST: 'LtiDeepLinkingRequest',
  DEEP_LINKING_RESPONSE: 'LtiDeepLinkingResponse',
} as const;

export const LTI_VERSION = '1.3.0';

export const ROLE = {
  LEARNER: 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
  INSTRUCTOR: 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
} as const;

export interface ContentItem {
  type: string;
  title?: string;
  text?: string;
  url?: string;
  custom?: Record<string, string>;
  presentation?: { documentTarget?: string };
}
