import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { env, platformEndpoints } from '../config/env.js';
import { query, queryOne } from '../db/pool.js';
import { requireUser } from '../middleware/session.js';
import { findToolByClientId, listTools } from '../lti/toolStore.js';
import { buildDeepLinkingToken, buildResourceLinkToken, type PlatformUser } from '../lti/idToken.js';
import { autoPostForm, clientIp, renderErrorPage } from '../utils/html.js';
import { MESSAGE_TYPE } from '../lti/claims.js';
import { platformRegistrationDocument } from '../config/registration.js';

export const ltiRouter = Router();

function randomHandle(): string {
  return randomBytes(32).toString('base64url');
}

/** Public description of this platform, for the tool's administrator. */
ltiRouter.get('/config', (_req, res) => res.json(platformRegistrationDocument));

// ===========================================================================
// STEP 0 (platform side) - START A LAUNCH
// The student clicked "Launch Lecture". We create a launch session, mint a
// one-time login_hint, and form-POST the tool's login initiation URL.
//
// Note the login_hint: it is what carries the user's identity across the
// cross-site hop. We deliberately do NOT rely on our own session cookie being
// sent when the browser comes back to /lti/authorize from inside the tool's
// iframe, because SameSite rules would drop it.
// ===========================================================================
ltiRouter.get('/initiate', requireUser, async (req, res) => {
  const resourceLinkId = String(req.query.resourceLinkId ?? '');
  if (!resourceLinkId) return renderErrorPage(res, 400, 'Cannot launch', 'No resourceLinkId supplied.');

  const link = await queryOne<{ id: string; course_id: string; tool_id: number; title: string }>(
    `SELECT id, course_id, tool_id, title FROM resource_links WHERE id = $1`,
    [resourceLinkId],
  );
  if (!link) return renderErrorPage(res, 404, 'Cannot launch', 'That lecture link no longer exists.');

  const enrolled = await queryOne(`SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2`, [
    req.user!.id,
    link.course_id,
  ]);
  if (!enrolled) return renderErrorPage(res, 403, 'Cannot launch', 'You are not enrolled in this course.');

  const tool = await queryOne<{
    id: number;
    client_id: string;
    deployment_id: string;
    login_initiation_url: string;
    target_link_uri: string;
  }>(`SELECT * FROM lti_tools WHERE id = $1 AND is_active`, [link.tool_id]);
  if (!tool) return renderErrorPage(res, 500, 'Cannot launch', 'The tool registration is missing or inactive.');

  const launchId = randomUUID();
  await query(
    `INSERT INTO launch_sessions (id, user_id, tool_id, course_id, resource_link_id, message_type, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      launchId,
      req.user!.id,
      tool.id,
      link.course_id,
      link.id,
      MESSAGE_TYPE.RESOURCE_LINK_REQUEST,
      clientIp(req),
      req.get('user-agent') ?? null,
    ],
  );

  const hint = randomHandle();
  await query(
    `INSERT INTO login_hints (hint, user_id, launch_session_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '5 minutes')`,
    [hint, req.user!.id, launchId],
  );

  console.log(`[lti] initiating launch ${launchId} for ${req.user!.email} -> ${tool.login_initiation_url}`);

  autoPostForm(
    res,
    tool.login_initiation_url,
    {
      iss: env.issuer,
      login_hint: hint,
      target_link_uri: tool.target_link_uri,
      lti_message_hint: launchId,
      client_id: tool.client_id,
      lti_deployment_id: tool.deployment_id,
    },
    'Starting secure LTI 1.3 launch…',
  );
});

/** Same handshake, but asking the tool for its content list (instructors only). */
ltiRouter.get('/deep-link/initiate', requireUser, async (req, res) => {
  if (req.user!.role !== 'instructor') {
    return renderErrorPage(res, 403, 'Not permitted', 'Only instructors can add content from the provider.');
  }
  const courseId = String(req.query.courseId ?? '');
  const course = await queryOne<{ id: string }>(`SELECT id FROM courses WHERE id = $1`, [courseId]);
  if (!course) return renderErrorPage(res, 404, 'Cannot start Deep Linking', 'Unknown course.');

  const tools = await listTools();
  const tool = tools[0];
  if (!tool) return renderErrorPage(res, 500, 'Cannot start Deep Linking', 'No tool is registered.');

  const launchId = randomUUID();
  await query(
    `INSERT INTO launch_sessions (id, user_id, tool_id, course_id, message_type, ip_address, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      launchId,
      req.user!.id,
      tool.id,
      courseId,
      MESSAGE_TYPE.DEEP_LINKING_REQUEST,
      clientIp(req),
      req.get('user-agent') ?? null,
    ],
  );

  const hint = randomHandle();
  await query(
    `INSERT INTO login_hints (hint, user_id, launch_session_id, expires_at)
     VALUES ($1, $2, $3, now() + interval '5 minutes')`,
    [hint, req.user!.id, launchId],
  );

  autoPostForm(
    res,
    tool.login_initiation_url,
    {
      iss: env.issuer,
      login_hint: hint,
      target_link_uri: tool.target_link_uri,
      lti_message_hint: launchId,
      client_id: tool.client_id,
      lti_deployment_id: tool.deployment_id,
    },
    'Opening the provider content picker…',
  );
});

// ===========================================================================
// OIDC AUTHORIZATION ENDPOINT
// The tool redirects the browser here with the state + nonce IT generated.
// We authenticate the request, mint the signed id_token, and form-POST it to
// the tool's registered redirect_uri.
// ===========================================================================
ltiRouter.get('/authorize', async (req, res) => {
  const q = req.query as Record<string, string>;
  const { client_id, redirect_uri, login_hint, state, nonce, lti_message_hint, scope, response_type, response_mode } =
    q;

  const fail = (reason: string) => {
    console.warn('[lti] /authorize rejected:', reason);
    renderErrorPage(res, 400, 'Authorization request rejected', reason);
  };

  if (!client_id) return fail('Missing client_id.');
  if (!redirect_uri) return fail('Missing redirect_uri.');
  if (!login_hint) return fail('Missing login_hint.');
  if (!state) return fail('Missing state.');
  if (!nonce) return fail('Missing nonce.');
  if (scope !== 'openid') return fail(`scope must be "openid" (got "${scope ?? ''}").`);
  if (response_type !== 'id_token') return fail(`response_type must be "id_token" (got "${response_type ?? ''}").`);
  if (response_mode !== 'form_post') return fail(`response_mode must be "form_post" (got "${response_mode ?? ''}").`);

  const tool = await findToolByClientId(client_id);
  if (!tool) return fail(`Unknown client_id "${client_id}".`);
  if (!tool.redirect_uris.includes(redirect_uri)) {
    return fail(`redirect_uri "${redirect_uri}" is not registered for this tool.`);
  }

  // Redeem the one-time login hint: this is our proof of who is launching.
  const hintRow = await queryOne<{ user_id: string; launch_session_id: string }>(
    `UPDATE login_hints
        SET consumed_at = now()
      WHERE hint = $1 AND consumed_at IS NULL AND expires_at > now()
      RETURNING user_id, launch_session_id`,
    [login_hint],
  );
  if (!hintRow) return fail('login_hint is unknown, expired, or already used.');

  if (lti_message_hint && lti_message_hint !== hintRow.launch_session_id) {
    return fail('lti_message_hint does not match the login_hint.');
  }

  const user = await queryOne<PlatformUser>(
    `SELECT id, email, name, given_name, family_name, role FROM users WHERE id = $1`,
    [hintRow.user_id],
  );
  if (!user) return fail('The user for this login_hint no longer exists.');

  const launch = await queryOne<{
    id: string;
    course_id: string | null;
    resource_link_id: string | null;
    message_type: string;
    tool_id: number;
  }>(`SELECT id, course_id, resource_link_id, message_type, tool_id FROM launch_sessions WHERE id = $1`, [
    hintRow.launch_session_id,
  ]);
  if (!launch) return fail('Launch session not found.');
  if (launch.tool_id !== tool.id) return fail('This launch session belongs to a different tool.');

  const course = launch.course_id
    ? await queryOne<{ id: string; title: string }>(`SELECT id, title FROM courses WHERE id = $1`, [launch.course_id])
    : null;
  if (!course) return fail('Launch session has no course context.');

  let idToken: string;
  if (launch.message_type === MESSAGE_TYPE.DEEP_LINKING_REQUEST) {
    idToken = await buildDeepLinkingToken({ user, tool, course, nonce, data: launch.id });
  } else {
    const link = await queryOne<{
      id: string;
      title: string;
      description: string;
      custom_params: Record<string, string>;
    }>(`SELECT id, title, description, custom_params FROM resource_links WHERE id = $1`, [launch.resource_link_id]);
    if (!link) return fail('The resource link for this launch no longer exists.');

    idToken = await buildResourceLinkToken({
      user,
      tool,
      course,
      nonce,
      resourceLink: {
        id: link.id,
        title: link.title,
        description: link.description,
        customParams: link.custom_params ?? {},
      },
      returnUrl: `${env.baseUrl}/courses/${course.id}`,
    });
  }

  await query(
    `UPDATE launch_sessions SET status = 'authorized', authorized_at = now(), state = $2, nonce = $3 WHERE id = $1`,
    [launch.id, state, nonce],
  );

  console.log(`[lti] signed ${launch.message_type} for ${user.email} -> ${redirect_uri}`);

  autoPostForm(res, redirect_uri, { id_token: idToken, state }, 'Signing you in to the content provider…');
});

// ===========================================================================
// DEEP LINKING RESPONSE
// The tool form-POSTs a JWT it signed. We verify it against the TOOL's JWKS
// (roles reversed) and store the returned content items as resource links.
// ===========================================================================
ltiRouter.post('/deep-link/return', async (req, res) => {
  const jwtValue = String(req.body?.JWT ?? '');
  if (!jwtValue) return renderErrorPage(res, 400, 'Deep Linking failed', 'No JWT in the response.');

  const { createRemoteJWKSet, jwtVerify, decodeJwt } = await import('jose');
  const { CLAIM } = await import('../lti/claims.js');

  let unverified: Record<string, unknown>;
  try {
    unverified = decodeJwt(jwtValue) as Record<string, unknown>;
  } catch {
    return renderErrorPage(res, 400, 'Deep Linking failed', 'The response JWT is malformed.');
  }

  const tool = await findToolByClientId(String(unverified.iss ?? ''));
  if (!tool) {
    return renderErrorPage(res, 401, 'Deep Linking failed', 'The response was issued by an unregistered tool.');
  }

  let claims: Record<string, unknown>;
  try {
    const verified = await jwtVerify(jwtValue, createRemoteJWKSet(new URL(tool.jwks_url)), {
      issuer: tool.client_id,
      audience: env.issuer,
      algorithms: ['RS256'],
      clockTolerance: 30,
      maxTokenAge: 600,
    });
    claims = verified.payload as Record<string, unknown>;
  } catch (err) {
    return renderErrorPage(res, 401, 'Deep Linking failed', `Signature check failed: ${(err as Error).message}`);
  }

  if (claims[CLAIM.MESSAGE_TYPE] !== MESSAGE_TYPE.DEEP_LINKING_RESPONSE) {
    return renderErrorPage(res, 400, 'Deep Linking failed', 'Unexpected message type in the response.');
  }
  if (claims[CLAIM.DEPLOYMENT_ID] !== tool.deployment_id) {
    return renderErrorPage(res, 400, 'Deep Linking failed', 'deployment_id does not match the registration.');
  }

  // The opaque `data` value we sent in the request must come back untouched.
  const launchId = String(claims[CLAIM.DEEP_LINKING_DATA] ?? '');
  const launch = await queryOne<{ id: string; course_id: string | null }>(
    `SELECT id, course_id FROM launch_sessions WHERE id = $1 AND message_type = $2`,
    [launchId, MESSAGE_TYPE.DEEP_LINKING_REQUEST],
  );
  if (!launch?.course_id) {
    return renderErrorPage(res, 400, 'Deep Linking failed', 'The response does not match a pending request.');
  }

  const items = (claims[CLAIM.CONTENT_ITEMS] as Record<string, unknown>[] | undefined) ?? [];
  let stored = 0;
  for (const [index, item] of items.entries()) {
    if (item.type !== 'ltiResourceLink') continue;
    const custom = (item.custom ?? {}) as Record<string, string>;
    const lectureId = custom.lecture_id;
    if (!lectureId) continue;

    await query(
      `INSERT INTO resource_links (id, course_id, tool_id, title, description, module_label, custom_params, position, created_via)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'deep_linking')
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         module_label = EXCLUDED.module_label,
         custom_params = EXCLUDED.custom_params,
         position = EXCLUDED.position,
         created_via = 'deep_linking'`,
      [
        `link-${lectureId}`,
        launch.course_id,
        tool.id,
        String(item.title ?? lectureId),
        String(item.text ?? ''),
        custom.module_title ?? null,
        JSON.stringify(custom),
        index,
      ],
    );
    stored += 1;
  }

  console.log(`[lti] deep linking stored ${stored} resource link(s) for course ${launch.course_id}`);

  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Content added</title>
<style>body{font:14px/1.6 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f5f6f8;color:#16191f}
@media (prefers-color-scheme:dark){body{background:#0f1115;color:#e7e9ec}}</style></head>
<body><div style="text-align:center">
  <p><strong>${stored} lecture link${stored === 1 ? '' : 's'} added.</strong></p>
  <p>Returning to the course…</p>
</div>
<script>
  // Deep Linking usually runs in an iframe or popup; tell the LMS page to refresh.
  if (window.parent !== window) window.parent.postMessage({ type: 'lti.deepLinkingComplete', count: ${stored} }, '*');
  else if (window.opener) { window.opener.postMessage({ type: 'lti.deepLinkingComplete', count: ${stored} }, '*'); window.close(); }
  else setTimeout(function(){ window.location.href = '/courses/${launch.course_id}'; }, 900);
</script></body></html>`);
});
