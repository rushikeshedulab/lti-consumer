import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pool } from '../src/db/pool.js';
import { defaultToolRegistration } from '../src/config/registration.js';
import { upsertTool } from '../src/lti/toolStore.js';

/**
 * Seeded resource links.
 *
 * These exist ONLY so the scripted demo works the moment you start the apps.
 * The proper way to create them is LTI Deep Linking - sign in as
 * instructor@example.com and use "Add content from provider", which replaces
 * these rows with ones the provider itself supplied (created_via='deep_linking').
 *
 * Note what is stored: an id, a title, a module label, and the custom params the
 * provider needs to resolve the content. No video URLs. No lecture bodies.
 */
const SEED_LINKS = [
  { lectureId: 'lec-1-1', module: 'Module 1: Introduction',         title: 'Understanding Stock Markets' },
  { lectureId: 'lec-1-2', module: 'Module 1: Introduction',         title: 'Market Participants and Instruments' },
  { lectureId: 'lec-2-1', module: 'Module 2: Technical Analysis',   title: 'Reading Candlestick Charts' },
  { lectureId: 'lec-2-2', module: 'Module 2: Technical Analysis',   title: 'Trends, Support and Resistance' },
  { lectureId: 'lec-3-1', module: 'Module 3: Fundamental Analysis', title: 'Reading Financial Statements' },
  { lectureId: 'lec-3-2', module: 'Module 3: Fundamental Analysis', title: 'Valuation Ratios in Practice' },
  { lectureId: 'lec-3-3', module: 'Module 3: Fundamental Analysis', title: 'Financial Statements: Quick Reference (PDF)' },
  { lectureId: 'lec-4-1', module: 'Module 4: Course Resources',      title: 'Submission Status: All Batches, All Semesters' },
  { lectureId: 'lec-4-2', module: 'Module 4: Course Resources',      title: 'One-Minute Market Clock (audio)' },
];

const COURSE_ID = 'fin-101';
const PROVIDER_COURSE_ID = 'course-fin-101';

const sql = readFileSync(resolve(process.cwd(), 'db/seed.sql'), 'utf8');

try {
  await pool.query(sql);
  console.log('Users, course metadata and enrolments seeded.');

  const tool = await upsertTool(defaultToolRegistration);
  console.log('Tool registration stored:');
  console.log(`  name              ${tool.name}`);
  console.log(`  client_id         ${tool.client_id}`);
  console.log(`  deployment_id     ${tool.deployment_id}`);
  console.log(`  login initiation  ${tool.login_initiation_url}`);
  console.log(`  redirect_uris     ${tool.redirect_uris.join(', ')}`);
  console.log(`  tool JWKS         ${tool.jwks_url}`);

  for (const [index, link] of SEED_LINKS.entries()) {
    await pool.query(
      `INSERT INTO resource_links (id, course_id, tool_id, title, description, module_label, custom_params, position, created_via)
       VALUES ($1,$2,$3,$4,'',$5,$6,$7,'seed')
       ON CONFLICT (id) DO NOTHING`,
      [
        `link-${link.lectureId}`,
        COURSE_ID,
        tool.id,
        link.title,
        link.module,
        JSON.stringify({
          lecture_id: link.lectureId,
          module_title: link.module,
          course_id: PROVIDER_COURSE_ID,
        }),
        index,
      ],
    );
  }
  console.log(`${SEED_LINKS.length} resource links seeded (replace them via Deep Linking to see the real flow).`);
} catch (err) {
  console.error('Seed failed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
