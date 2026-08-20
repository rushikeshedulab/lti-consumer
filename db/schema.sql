-- ===========================================================================
-- CONSUMER LMS  (LTI 1.3 role: PLATFORM)
-- Owns: users, enrolments, and LINKS to provider content. Never the content.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  given_name    TEXT,
  family_name   TEXT,
  role          TEXT NOT NULL DEFAULT 'student',   -- 'student' | 'instructor'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Course METADATA only: enough to render a catalogue. No videos, no lecture
-- bodies, no provider content of any kind.
CREATE TABLE IF NOT EXISTS courses (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  content_source TEXT NOT NULL DEFAULT 'EduLab Content Provider (LTI 1.3)',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrollments (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id   TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'Learner',
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

-- ---------------------------------------------------------------------------
-- TOOL REGISTRATIONS - the tools this platform is willing to launch.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lti_tools (
  id                     SERIAL PRIMARY KEY,
  name                   TEXT NOT NULL,
  client_id              TEXT NOT NULL UNIQUE,
  deployment_id          TEXT NOT NULL,
  login_initiation_url   TEXT NOT NULL,
  redirect_uris          TEXT[] NOT NULL,
  jwks_url               TEXT NOT NULL,
  target_link_uri        TEXT NOT NULL,
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- RESOURCE LINKS
-- The ONLY thing the consumer knows about provider content: an id, a title and
-- the custom parameters the provider asked us to send back on each launch.
-- Rows are created by LTI Deep Linking, not by copying the provider's database.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS resource_links (
  id               TEXT PRIMARY KEY,
  course_id        TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  tool_id          INTEGER NOT NULL REFERENCES lti_tools(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  module_label     TEXT,
  custom_params    JSONB NOT NULL DEFAULT '{}'::jsonb,
  position         INTEGER NOT NULL DEFAULT 0,
  created_via      TEXT NOT NULL DEFAULT 'deep_linking',  -- 'deep_linking' | 'seed'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS resource_links_course_idx ON resource_links(course_id);

-- ---------------------------------------------------------------------------
-- LAUNCH SESSIONS
-- One row per launch this platform initiates, tracking it through the OIDC
-- round trip. `nonce` and `state` are the values the TOOL generated and we
-- echoed back, kept here for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS launch_sessions (
  id                UUID PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_id           INTEGER NOT NULL REFERENCES lti_tools(id) ON DELETE CASCADE,
  course_id         TEXT REFERENCES courses(id) ON DELETE SET NULL,
  resource_link_id  TEXT,
  message_type      TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'initiated', -- initiated | authorized | failed
  state             TEXT,
  nonce             TEXT,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_at     TIMESTAMPTZ,
  ip_address        TEXT,
  user_agent        TEXT,

  -- Filled in later by the provider over the LTI service call. The consumer
  -- displays this; it never computes it, because it does not host the video.
  reported_started_at    TIMESTAMPTZ,
  reported_ended_at      TIMESTAMPTZ,
  reported_presence_secs INTEGER,
  reported_watched_secs  INTEGER
);
CREATE INDEX IF NOT EXISTS launch_sessions_user_idx ON launch_sessions(user_id);

-- Login hints handed to the tool at initiation and redeemed at /lti/authorize.
CREATE TABLE IF NOT EXISTS login_hints (
  hint            TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  launch_session_id UUID NOT NULL REFERENCES launch_sessions(id) ON DELETE CASCADE,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ
);
