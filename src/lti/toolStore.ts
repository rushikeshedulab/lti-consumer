import { query, queryOne } from '../db/pool.js';

export interface ToolRegistration {
  id: number;
  name: string;
  client_id: string;
  deployment_id: string;
  login_initiation_url: string;
  redirect_uris: string[];
  jwks_url: string;
  target_link_uri: string;
  is_active: boolean;
}

export function findToolByClientId(clientId: string) {
  return queryOne<ToolRegistration>(
    `SELECT * FROM lti_tools WHERE client_id = $1 AND is_active`,
    [clientId],
  );
}

export function findToolById(id: number) {
  return queryOne<ToolRegistration>(`SELECT * FROM lti_tools WHERE id = $1`, [id]);
}

export function listTools() {
  return query<ToolRegistration>(`SELECT * FROM lti_tools ORDER BY id`);
}

export async function upsertTool(reg: {
  name: string;
  clientId: string;
  deploymentId: string;
  loginInitiationUrl: string;
  redirectUris: string[];
  jwksUrl: string;
  targetLinkUri: string;
}): Promise<ToolRegistration> {
  const row = await queryOne<ToolRegistration>(
    `INSERT INTO lti_tools
       (name, client_id, deployment_id, login_initiation_url, redirect_uris, jwks_url, target_link_uri)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (client_id) DO UPDATE SET
       name = EXCLUDED.name,
       deployment_id = EXCLUDED.deployment_id,
       login_initiation_url = EXCLUDED.login_initiation_url,
       redirect_uris = EXCLUDED.redirect_uris,
       jwks_url = EXCLUDED.jwks_url,
       target_link_uri = EXCLUDED.target_link_uri,
       is_active = TRUE
     RETURNING *`,
    [
      reg.name,
      reg.clientId,
      reg.deploymentId,
      reg.loginInitiationUrl,
      reg.redirectUris,
      reg.jwksUrl,
      reg.targetLinkUri,
    ],
  );
  return row!;
}
