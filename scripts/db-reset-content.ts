import { pool, query } from '../src/db/pool.js';

/**
 * Drops every course, enrolment and lecture link this LMS holds, leaving users
 * and the tool registration in place.
 *
 * Use it once to clear rows that predate the automatic catalog mirror (the old
 * demo seed). Everything real comes straight back on the next sync, which runs
 * within a second of the server starting or a course page being opened.
 */
try {
  const [before] = await query<{ courses: string; links: string; enrolments: string }>(
    `SELECT (SELECT count(*) FROM courses)        AS courses,
            (SELECT count(*) FROM resource_links) AS links,
            (SELECT count(*) FROM enrollments)    AS enrolments`,
  );

  // enrolments and resource links both cascade from courses.
  await query(`DELETE FROM courses`);

  console.log(
    `Removed ${before?.courses ?? 0} course(s), ${before?.links ?? 0} lecture link(s), ${before?.enrolments ?? 0} enrolment(s).`,
  );
  console.log('They will be re-created from the provider catalog on the next sync.');
} catch (err) {
  console.error('Reset failed:', (err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
