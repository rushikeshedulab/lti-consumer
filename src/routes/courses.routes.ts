import { Router } from 'express';
import { query, queryOne } from '../db/pool.js';
import { requireUser } from '../middleware/session.js';

export const coursesRouter = Router();

coursesRouter.use(requireUser);

/** Courses the signed-in user is enrolled in. Metadata only - no lecture content. */
coursesRouter.get('/', async (req, res) => {
  const rows = await query(
    `SELECT c.id, c.title, c.description, c.content_source, e.role,
            (SELECT count(*) FROM resource_links rl WHERE rl.course_id = c.id) AS link_count
       FROM courses c
       JOIN enrollments e ON e.course_id = c.id
      WHERE e.user_id = $1
      ORDER BY c.title`,
    [req.user!.id],
  );
  res.json({ courses: rows });
});

/**
 * Course detail: the modules/lectures shown here are RESOURCE LINKS, not
 * content. Each one holds an id, a title and the custom parameters the provider
 * gave us during Deep Linking - nothing else.
 */
coursesRouter.get('/:courseId', async (req, res) => {
  const courseId = String(req.params.courseId);

  const enrolment = await queryOne(
    `SELECT e.role FROM enrollments e WHERE e.user_id = $1 AND e.course_id = $2`,
    [req.user!.id, courseId],
  );
  if (!enrolment) {
    res.status(403).json({ error: 'not_enrolled' });
    return;
  }

  const course = await queryOne(`SELECT id, title, description, content_source FROM courses WHERE id = $1`, [
    courseId,
  ]);
  if (!course) {
    res.status(404).json({ error: 'course_not_found' });
    return;
  }

  const links = await query<{
    id: string;
    title: string;
    description: string;
    module_label: string | null;
    custom_params: Record<string, string>;
    position: number;
    created_via: string;
  }>(
    `SELECT id, title, description, module_label, custom_params, position, created_via
       FROM resource_links
      WHERE course_id = $1
      ORDER BY module_label NULLS LAST, position, title`,
    [courseId],
  );

  // Group by the module label the provider supplied, purely for presentation.
  const modules: { label: string; links: typeof links }[] = [];
  for (const link of links) {
    const label = link.module_label ?? 'Lectures';
    let group = modules.find((m) => m.label === label);
    if (!group) {
      group = { label, links: [] };
      modules.push(group);
    }
    group.links.push(link);
  }

  res.json({ course, role: (enrolment as { role: string }).role, modules });
});

/** This user's launch history, including any duration the provider reported back. */
coursesRouter.get('/:courseId/launches', async (req, res) => {
  const rows = await query(
    `SELECT ls.id, ls.resource_link_id, ls.message_type, ls.status, ls.created_at, ls.authorized_at,
            ls.failure_reason,
            ls.reported_started_at, ls.reported_ended_at,
            ls.reported_presence_secs, ls.reported_watched_secs,
            rl.title AS resource_link_title
       FROM launch_sessions ls
       LEFT JOIN resource_links rl ON rl.id = ls.resource_link_id
      WHERE ls.user_id = $1 AND ls.course_id = $2
      ORDER BY ls.created_at DESC
      LIMIT 50`,
    [req.user!.id, String(req.params.courseId)],
  );
  res.json({ launches: rows });
});
