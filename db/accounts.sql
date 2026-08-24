-- ===========================================================================
-- CONSUMER LMS sign-in accounts.
--
-- This is the ONLY data this project installs, and it is not sample content -
-- it is the login list, because the LMS has no user-management screen yet.
--
-- There are deliberately NO courses, enrolments or lecture links here. Courses
-- appear when the content provider's admin uploads content: this platform
-- mirrors the provider catalog and enrols these users automatically.
--
-- Edit the rows below to use your own people, then run `npm run db:accounts`.
-- ===========================================================================

INSERT INTO users (id, email, name, given_name, family_name, role) VALUES
  ('user-angad',      'angad@example.com',      'Angad Singh',   'Angad',  'Singh',   'student'),
  ('user-priya',      'priya@example.com',      'Priya Sharma',  'Priya',  'Sharma',  'student'),
  ('user-instructor', 'instructor@example.com', 'Dr Meera Rao',  'Meera',  'Rao',     'instructor')
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role;
