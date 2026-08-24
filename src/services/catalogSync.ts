import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { getPrivateKey, SIGNING_ALG } from '../lti/keys.js';
import { listTools, type ToolRegistration } from '../lti/toolStore.js';

/**
 * CATALOG SYNC
 * ------------
 * The provider's administrator uploads content; this platform mirrors the
 * resulting catalog. Nobody on this side picks what appears - that is the whole
 * point of the flow. It replaces the old step where an instructor ran Deep
 * Linking and chose lectures by hand.
 *
 * What crosses the wire is metadata only: course/module/item ids, titles,
 * content type and duration. No URLs, no bytes. Opening any of it still costs a
 * full LTI 1.3 launch, exactly as before - the sync only decides what is
 * OFFERED, never what is delivered.
 *
 * Auth is the mirror image of the tool's `private_key_jwt` client assertion:
 * we sign a 2-minute JWT with the platform's own private key and the tool
 * verifies it against our published JWKS.
 */

export interface SyncResult {
  ok: boolean;
  courses: number;
  links: number;
  removedLinks: number;
  removedCourses: number;
  syncedAt: string | null;
  error?: string;
}

interface CatalogLecture {
  id: string;
  title: string;
  description: string;
  content_type: string;
  duration_seconds: number;
  position: number;
}
interface CatalogModule {
  id: string;
  title: string;
  position: number;
  lectures: CatalogLecture[];
}
interface CatalogCourse {
  id: string;
  title: string;
  description: string;
  modules: CatalogModule[];
}

const MIN_INTERVAL_MS = 5_000;

let lastResult: SyncResult = {
  ok: false,
  courses: 0,
  links: 0,
  removedLinks: 0,
  removedCourses: 0,
  syncedAt: null,
};
let lastAttemptAt = 0;
let inFlight: Promise<SyncResult> | null = null;

export function lastSyncResult(): SyncResult {
  return lastResult;
}

/** Where the tool publishes its catalog. Derived from its registered URLs. */
function catalogUrlFor(tool: ToolRegistration): string {
  if (env.toolCatalogUrl) return env.toolCatalogUrl;
  return new URL('/api/catalog', tool.login_initiation_url).toString();
}

async function platformAssertion(tool: ToolRegistration, audience: string): Promise<string> {
  return new SignJWT({ client_id: tool.client_id })
    .setProtectedHeader({ alg: SIGNING_ALG, kid: env.keyId, typ: 'JWT' })
    .setIssuer(env.issuer)
    .setSubject(env.issuer)
    .setAudience(audience)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(await getPrivateKey());
}

/**
 * Fetch the catalog and make this database match it.
 *
 * Coalesced and throttled: every course page hit calls this, so concurrent
 * callers share one request and a burst of page loads does not hammer the tool.
 */
export function syncCatalog(options: { force?: boolean } = {}): Promise<SyncResult> {
  if (inFlight) return inFlight;
  if (!options.force && Date.now() - lastAttemptAt < MIN_INTERVAL_MS) return Promise.resolve(lastResult);

  lastAttemptAt = Date.now();
  inFlight = runSync()
    .then((result) => {
      lastResult = result;
      return result;
    })
    .catch((err: Error) => {
      // A provider that is down must not break the LMS: keep serving whatever
      // was mirrored last time and report the failure.
      lastResult = { ...lastResult, ok: false, error: err.message };
      console.warn(`[sync] catalog sync failed: ${err.message}`);
      return lastResult;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function fetchCatalog(tool: ToolRegistration): Promise<CatalogCourse[]> {
  const url = catalogUrlFor(tool);
  const assertion = await platformAssertion(tool, url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${assertion}`, accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`catalog request failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const body = JSON.parse(text) as { courses?: CatalogCourse[] };
    return body.courses ?? [];
  } finally {
    clearTimeout(timeout);
  }
}

async function runSync(): Promise<SyncResult> {
  const [tool] = await listTools();
  if (!tool) throw new Error('no tool is registered');

  const courses = await fetchCatalog(tool);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const keptCourseIds: string[] = [];
    const keptLinkIds: string[] = [];
    let links = 0;

    for (const course of courses) {
      const courseId = course.id;
      keptCourseIds.push(courseId);

      await client.query(
        `INSERT INTO courses (id, title, description, content_source, provider_course_id, synced_at)
         VALUES ($1,$2,$3,$4,$1, now())
         ON CONFLICT (id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           content_source = EXCLUDED.content_source,
           provider_course_id = EXCLUDED.provider_course_id,
           synced_at = now()`,
        [courseId, course.title, course.description ?? '', tool.name],
      );

      for (const module of course.modules ?? []) {
        for (const lecture of module.lectures ?? []) {
          const linkId = `link-${lecture.id}`;
          keptLinkIds.push(linkId);
          // Composite position keeps the provider's module order intact once
          // the links are grouped back together for display.
          const position = module.position * 1000 + lecture.position;

          await client.query(
            `INSERT INTO resource_links
               (id, course_id, tool_id, title, description, module_label, custom_params, position, created_via)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'provider_sync')
             ON CONFLICT (id) DO UPDATE SET
               course_id = EXCLUDED.course_id,
               tool_id = EXCLUDED.tool_id,
               title = EXCLUDED.title,
               description = EXCLUDED.description,
               module_label = EXCLUDED.module_label,
               custom_params = EXCLUDED.custom_params,
               position = EXCLUDED.position,
               created_via = 'provider_sync'`,
            [
              linkId,
              courseId,
              tool.id,
              lecture.title,
              lecture.description ?? '',
              module.title,
              JSON.stringify({
                lecture_id: lecture.id,
                content_type: lecture.content_type,
                module_id: module.id,
                module_title: module.title,
                course_id: courseId,
                course_title: course.title,
              }),
              position,
            ],
          );
          links += 1;
        }
      }
    }

    // Content the admin deleted disappears here too.
    const removedLinks = await client.query(
      `DELETE FROM resource_links
        WHERE created_via = 'provider_sync'
          AND tool_id = $1
          AND NOT (id = ANY($2::text[]))
        RETURNING id`,
      [tool.id, keptLinkIds],
    );
    const removedCourses = await client.query(
      `DELETE FROM courses
        WHERE provider_course_id IS NOT NULL
          AND NOT (id = ANY($1::text[]))
        RETURNING id`,
      [keptCourseIds],
    );

    /**
     * Enrolment follows the catalog: with no instructor curating a course
     * there is nobody to build a roster either, so every known user is
     * enrolled in every provider course, keeping their LMS role.
     */
    if (keptCourseIds.length > 0) {
      await client.query(
        `INSERT INTO enrollments (user_id, course_id, role)
         SELECT u.id, c.id, CASE WHEN u.role = 'instructor' THEN 'Instructor' ELSE 'Learner' END
           FROM users u
           CROSS JOIN courses c
          WHERE c.id = ANY($1::text[])
         ON CONFLICT (user_id, course_id) DO NOTHING`,
        [keptCourseIds],
      );
    }

    await client.query('COMMIT');

    const result: SyncResult = {
      ok: true,
      courses: keptCourseIds.length,
      links,
      removedLinks: removedLinks.rowCount ?? 0,
      removedCourses: removedCourses.rowCount ?? 0,
      syncedAt: new Date().toISOString(),
    };

    if (result.removedLinks || result.removedCourses || result.syncedAt !== lastResult.syncedAt) {
      console.log(
        `[sync] catalog mirrored: ${result.courses} course(s), ${result.links} item(s)` +
          (result.removedLinks ? `, ${result.removedLinks} removed` : ''),
      );
    }
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Background refresh so a long-lived tab still sees new uploads. */
export function startCatalogSync(): void {
  void syncCatalog({ force: true });
  setInterval(() => void syncCatalog({ force: true }), env.catalogSyncIntervalSeconds * 1000).unref();
}
