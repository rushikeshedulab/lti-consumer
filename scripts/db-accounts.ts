import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool, query } from '../src/db/pool.js';
import { defaultToolRegistration } from '../src/config/registration.js';
import { upsertTool } from '../src/lti/toolStore.js';

/**
 * Installs the two things this platform cannot discover for itself: who may
 * sign in (db/accounts.sql) and which tool it trusts.
 *
 * No courses, no enrolments and no lecture links are created. Those are
 * mirrored from the provider's catalog at runtime, so whatever the provider's
 * admin uploads is what students see.
 */
const sql = readFileSync(resolve(process.cwd(), 'db/accounts.sql'), 'utf8');

try {
  await pool.query(sql);
  const users = await query<{ count: string }>(`SELECT count(*) FROM users`);
  console.log(`Sign-in accounts installed (${users[0]?.count ?? 0} user(s)).`);

  const tool = await upsertTool(defaultToolRegistration);
  console.log('Tool registration stored:');
  console.log(`  name              ${tool.name}`);
  console.log(`  client_id         ${tool.client_id}`);
  console.log(`  deployment_id     ${tool.deployment_id}`);
  console.log(`  login initiation  ${tool.login_initiation_url}`);
  console.log(`  redirect_uris     ${tool.redirect_uris.join(', ')}`);
  console.log(`  tool JWKS         ${tool.jwks_url}`);
  console.log('');
  console.log('No course content is installed. Upload it in the provider admin panel');
  console.log('(http://localhost:4000/admin) - it appears here automatically.');
} catch (err) {
  console.error('Setup failed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
