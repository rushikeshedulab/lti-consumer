-- ===========================================================================
-- CONSUMER LMS demo data: people, a course shell, and enrolments.
-- NOTE: no lecture bodies and no video URLs - that content belongs to the
-- provider and is only ever reached through an LTI launch.
-- ===========================================================================

INSERT INTO users (id, email, name, given_name, family_name, role) VALUES
  ('user-angad',      'angad@example.com',      'Angad Singh',   'Angad',  'Singh',   'student'),
  ('user-priya',      'priya@example.com',      'Priya Sharma',  'Priya',  'Sharma',  'student'),
  ('user-instructor', 'instructor@example.com', 'Dr Meera Rao',  'Meera',  'Rao',     'instructor')
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role;

INSERT INTO courses (id, title, description) VALUES
  ('fin-101',
   'Introduction to Financial Markets',
   'Delivered in partnership with EduLab. All lecture content is hosted by the content provider and opened through LTI 1.3.')
ON CONFLICT (id) DO UPDATE
  SET title = EXCLUDED.title, description = EXCLUDED.description;

INSERT INTO enrollments (user_id, course_id, role) VALUES
  ('user-angad',      'fin-101', 'Learner'),
  ('user-priya',      'fin-101', 'Learner'),
  ('user-instructor', 'fin-101', 'Instructor')
ON CONFLICT (user_id, course_id) DO UPDATE SET role = EXCLUDED.role;
