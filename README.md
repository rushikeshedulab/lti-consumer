# Consumer LMS — LTI 1.3 **Platform**

A small LMS: students, courses, enrolments, and a lecture list. It holds **no lecture content** — every lecture is opened by signing an LTI 1.3 `id_token` and handing the browser to the content provider.

Runs on <http://localhost:4001>.

---

## Table of contents

0. [**Quick start — running this project**](#0-quick-start--running-this-project)
1. [Architecture](#1-architecture)
2. [The LTI 1.3 flow](#2-the-lti-13-flow)
3. [Provider setup](#3-provider-setup)
4. [Consumer setup](#4-consumer-setup)
5. [Environment variables](#5-environment-variables)
6. [Key generation](#6-key-generation)
7. [Platform registration](#7-platform-registration)
8. [Tool registration](#8-tool-registration)
9. [Starting both applications](#9-starting-both-applications)
10. [Testing an LTI launch](#10-testing-an-lti-launch)
11. [How activity logging works](#11-how-activity-logging-works)
12. [What this database deliberately does not contain](#what-this-database-deliberately-does-not-contain)

---

## 0. Quick start — running this project

Follow these steps in order and you end up with a working LTI 1.3 demo: Postgres on `:5433`, the content provider on `:4000`, this LMS on `:4001`.

> This app is only half the system. It signs launches and hands the browser to the content provider, so **both applications and the database must be running** before anything is visible. Start the provider first — the very first launch fetches its JWKS.

### Step 0 — Prerequisites

| Requirement | Version | Verify with |
|---|---|---|
| Node.js | **≥ 20.19** (see `engines`) | `node -v` |
| npm | ≥ 10 | `npm -v` |
| Docker Desktop | any recent | `docker --version` |
| Free TCP ports | `4001` (this app), `4000` (provider), `5433` (Postgres) | `netstat -ano \| findstr "4000 4001 5433"` |

Already running your own PostgreSQL 16? Skip Docker, create the databases yourself (see Step 1) and point `DATABASE_URL` at them.

On Windows, run everything in **PowerShell** or **Git Bash**. In `cmd.exe`, replace `cp` with `copy`.

### Step 1 — Start PostgreSQL (from the repository root, once)

```bash
cd ..                    # repository root, the folder holding docker-compose.yml
docker compose up -d
docker compose ps        # wait until the STATUS column reads "healthy"
```

One Postgres 16 container listens on **`localhost:5433`**. On first start `infra/init-databases.sql` creates the two independent databases this demo uses:

| Database | Owned by |
|---|---|
| `lti_consumer` | this LMS |
| `lti_provider` | the content provider |

Without Docker, create them manually and keep the credentials in `DATABASE_URL` in sync:

```sql
CREATE USER lti WITH PASSWORD 'lti';
CREATE DATABASE lti_consumer OWNER lti;
CREATE DATABASE lti_provider OWNER lti;
```

### Step 2 — Bring up the content provider first

The provider is a separate application with its own README. In short, from the repository root:

```bash
cd lti-content-provider
cp .env.example .env
npm install
npm run frontend:install
npm run setup            # keys:generate + db:migrate + db:seed
npm run frontend:build
npm run dev              # http://localhost:4000
```

Leave that terminal running and open a **new terminal** for the steps below. Full detail: [`../lti-content-provider/README.md`](../lti-content-provider/README.md).

### Step 3 — Configure this application

```bash
cd lti-consumer-lms
cp .env.example .env
```

The defaults work as-is for a local run. Three values **must be byte-identical to the provider's `.env`**, or launches fail with `unknown_platform`:

| Variable here | Default | Must match the provider's |
|---|---|---|
| `LTI_ISSUER` | `http://localhost:4001` | registered platform issuer |
| `LTI_CLIENT_ID` | `edulab-content-provider` | `LTI_CLIENT_ID` |
| `LTI_DEPLOYMENT_ID` | `deployment-fin-001` | `LTI_DEPLOYMENT_IDS` |

Change `SESSION_SECRET` (and `DEMO_PASSWORD`) before running this anywhere other than your own machine. Full table: [§5 Environment variables](#5-environment-variables).

### Step 4 — Install dependencies

```bash
npm install                  # backend: Express, pg, jose, tsx
npm run frontend:install     # React app under frontend/
```

### Step 5 — Generate keys, create the schema, seed demo data

```bash
npm run setup
```

One command, three steps, safe to re-run:

| Sub-step | What it does |
|---|---|
| `npm run keys:generate` | Writes an RSA-2048 keypair to `keys/`. **Skips if one already exists** — pass `-- --force` to replace it |
| `npm run db:migrate` | Applies `db/schema.sql` to `lti_consumer` |
| `npm run db:seed` | Inserts demo users, the course, enrolments, the tool registration and six seeded resource links |

Failing with `ECONNREFUSED … 5433` means Postgres from Step 1 is not ready — re-check `docker compose ps`.

### Step 6 — Build the React frontend

```bash
npm run frontend:build       # Vite → public/, served by Express
```

Required, not optional: the backend serves the **already built** app from `public/`. Skipping this leaves you on a blank page.

### Step 7 — Start the server

```bash
npm run dev                  # tsx watch, restarts on backend changes
```

Expect a line like:

```
listening on            http://localhost:4001
```

Production-style instead — compiles TypeScript to `dist/`, builds the frontend, runs plain Node:

```bash
npm run build && npm start
```

Health checks:

```bash
curl http://localhost:4001/health          # {"ok":true,"service":"lti-consumer-lms"}
curl http://localhost:4001/.well-known/jwks.json
```

### Step 8 — Verify the deployment

Automated, from the repository root, with **both** servers running:

```bash
node scripts/verify-lti-flow.mjs
```

Or by hand:

1. Open <http://localhost:4001> and sign in as `angad@example.com` / `demo1234`.
2. **My courses → Introduction to Financial Markets → Launch lecture**.
3. The provider's player renders inside the iframe. **Close lecture**, then check <http://localhost:4000/admin> (password `admin123`) for the logged events.

### Copy-paste: the whole thing

```bash
# terminal 1 — database + provider
docker compose up -d
cd lti-content-provider && cp .env.example .env
npm install && npm run frontend:install && npm run setup && npm run frontend:build
npm run dev

# terminal 2 — this LMS
cd lti-consumer-lms && cp .env.example .env
npm install && npm run frontend:install && npm run setup && npm run frontend:build
npm run dev
```

### Optional — frontend hot reload

```bash
npm run frontend:dev         # Vite on :5174, proxying /api, /lti, /.well-known to :4001
```

Useful while editing React, but **drive the demo from :4001** — that is the origin registered with the tool.

### Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `ECONNREFUSED … 5433` during `npm run setup` | Postgres not running or still starting — `docker compose up -d`, then `docker compose ps` |
| `database "lti_consumer" does not exist` | The container volume predates `infra/init-databases.sql` — `docker compose down -v && docker compose up -d`, then re-run `npm run setup` |
| Blank page at `:4001` | `npm run frontend:build` was skipped, so `public/` is empty |
| `EADDRINUSE :4001` | Another process holds the port — free it, or change `PORT` **and** `CONSUMER_BASE_URL`/`LTI_ISSUER` together |
| Launch fails `401 invalid_signature` | The provider cannot reach `:4001/.well-known/jwks.json`, or keys were regenerated on one side only |
| Launch fails `401 unknown_platform` | `LTI_ISSUER` / `LTI_CLIENT_ID` / `LTI_DEPLOYMENT_ID` differ between the two `.env` files |
| Iframe stays blank, console mentions `frame-ancestors` | This origin is missing from the provider's `ALLOWED_FRAME_ANCESTORS` |
| `Cannot find module 'tsx'` | `npm install` was not run in this folder |

### Deploying beyond localhost

The demo is wired for `http://localhost`. For a shared or hosted deployment:

1. Set `CONSUMER_BASE_URL` and `LTI_ISSUER` to the public **https** origin, and the `TOOL_*` URLs to the provider's public origin — then make the mirror-image edit in the provider's `.env`.
2. Add this origin to the provider's `ALLOWED_FRAME_ANCESTORS`, or the iframe is blocked.
3. Replace `SESSION_SECRET` and `DEMO_PASSWORD` with real secrets. Never commit `.env` or `keys/` — both are gitignored.
4. Serve over TLS. The launch runs in a cross-site iframe, so the state cookie only becomes `SameSite=None; Secure` under HTTPS.
5. Point `DATABASE_URL` at a managed Postgres, run `npm run db:migrate`, and run `npm run db:seed` only if you want the demo accounts.
6. Run `npm run build && npm start` behind a process manager — not `npm run dev`.
7. Confirm both sides still agree: `npm run registration:print` here and in the provider.

---

## 1. Architecture

```
Consumer LMS   ← you are here
      |
      | LTI 1.3 Launch
      ↓
LTI Content Provider
      |
      ↓
Course / Lecture
      |
      ↓
Video Content
      |
      ↓
Activity Logging
```

```
src/
├── config/         env + tool registration values
├── db/             pg pool + query helpers (raw SQL, no ORM)
├── lti/            ── the LTI integration layer ──
│   ├── claims.ts       claim URIs and message types
│   ├── keys.ts         the platform's RSA keypair, JWKS export
│   ├── idToken.ts      builds and signs LTI id_tokens
│   └── toolStore.ts    registered tools
├── middleware/     demo session cookie handling
├── routes/         auth, courses, lti (initiate/authorize/deep-link),
│                   token endpoint, service endpoints
└── utils/          the self-submitting form that carries LTI messages

frontend/           React (Vite) — login, courses, course detail, iframe host
db/                 schema.sql + seed.sql
```

### Database tables

| Table | Purpose |
|---|---|
| `users` | Demo students and one instructor |
| `courses` | Course **metadata only** — title, description, content source |
| `enrollments` | Who can open what |
| `lti_tools` | Registered tools: client_id, deployment_id, endpoints, JWKS URL |
| `resource_links` | Links to provider content: id, title, module label, custom params |
| `launch_sessions` | One row per launch, plus any duration the provider reports back |
| `login_hints` | One-time, short-lived handles that carry identity across the OIDC hop |

---

## 2. The LTI 1.3 flow

### Step 0 — Launch initiation (`GET /lti/initiate?resourceLinkId=…`)

Requires a signed-in student enrolled in the course. Creates a `launch_sessions` row and a **one-time `login_hint`**, then form-POSTs the tool's login initiation URL with `iss`, `login_hint`, `client_id`, `lti_deployment_id`, `target_link_uri` and `lti_message_hint` (the launch session id).

> **Why a `login_hint` and not the session cookie?** The browser returns to `/lti/authorize` from *inside the tool's iframe*, which is a cross-site navigation — `SameSite` rules mean our own session cookie may not be sent. The `login_hint` is an unguessable, single-use, 5-minute handle that carries the identity instead. This is exactly what the parameter exists for.

### Step 1 — The tool responds

The tool generates `state` and `nonce` and redirects the browser to our authorization endpoint. See the [provider README](../lti-content-provider/README.md).

### Step 2 — Authorization endpoint (`GET /lti/authorize`)

Validates, and refuses with an explained error page otherwise:

| Check | Requirement |
|---|---|
| `scope` | must be `openid` |
| `response_type` | must be `id_token` |
| `response_mode` | must be `form_post` |
| `client_id` | must be a registered, active tool |
| `redirect_uri` | must be on that tool's registered allow-list |
| `login_hint` | unknown / expired / already used ⇒ rejected (consumed atomically) |
| `lti_message_hint` | must match the launch session bound to the `login_hint` |
| launch session | must belong to the same tool and have a course context |
| `state`, `nonce` | must both be present, and are echoed back untouched |

### Step 3 — Signing the `id_token`

`src/lti/idToken.ts` builds the claim set and signs it **RS256** with the platform's private key and `kid`:

```jsonc
{
  "iss": "http://localhost:4001",          // this platform
  "aud": "edulab-content-provider",        // the tool's client_id
  "sub": "user-angad",                     // the student
  "exp": …, "iat": …, "nonce": "…", "jti": "…",
  "name": "Angad Singh", "email": "angad@example.com",

  ".../claim/message_type":   "LtiResourceLinkRequest",
  ".../claim/version":        "1.3.0",
  ".../claim/deployment_id":  "deployment-fin-001",
  ".../claim/target_link_uri":"http://localhost:4000/lti/launch",
  ".../claim/roles":          ["…membership#Learner"],
  ".../claim/resource_link":  { "id": "link-lec-1-1", "title": "Understanding Stock Markets" },
  ".../claim/context":        { "id": "fin-101", "title": "Introduction to Financial Markets" },
  ".../claim/tool_platform":  { "guid": "http://localhost:4001", "name": "EduLab Consumer LMS" },
  ".../claim/launch_presentation": { "document_target": "iframe", "return_url": "…" },
  ".../claim/custom":         { "lecture_id": "lec-1-1", "module_id": "mod-1", "course_id": "course-fin-101" }
}
```

The **`custom`** claim is the hinge of the whole design: it carries the *provider's own* lecture id, obtained from the provider during Deep Linking. It is how the provider resolves exactly which lecture to serve while this database holds none of the content.

The token is then form-POSTed to the tool's `redirect_uri` together with the unchanged `state`.

### Step 4 — Deep Linking (`/lti/deep-link/initiate` and `/lti/deep-link/return`)

An instructor triggers an `LtiDeepLinkingRequest`. The request carries `deep_linking_settings` including our `deep_link_return_url`, `accept_types: ["ltiResourceLink"]` and an opaque `data` value (the launch session id).

The tool returns a **signed** `LtiDeepLinkingResponse`. We verify it against the tool's JWKS with the roles reversed (`iss` = the tool's `client_id`, `aud` = our issuer), confirm the `deployment_id` and that the opaque `data` came back untouched, then store each `ltiResourceLink` item as a `resource_links` row — id, title, module label and `custom` params. **No video URLs, no lecture bodies.**

### Step 5 — Token endpoint (`POST /lti/token`)

OAuth 2.0 **client_credentials** with a **`private_key_jwt`** client assertion:

- `grant_type=client_credentials`
- `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
- `client_assertion=<JWT signed by the tool>`

We verify the assertion against the tool's JWKS, require `aud` to be *this exact token endpoint*, require `sub == iss == client_id`, and reject a reused `jti`. On success we issue a bearer access token carrying the granted scope. There is no shared secret between the two systems at any point.

`POST /lti/services/viewing-summary` is protected by that token and records the duration the provider reports. It is a **demo service, not part of the LTI specification** — it exists to exercise the grant end to end and to let the LMS display watch time it did not measure.

---

## 3. Provider setup

See [`../lti-content-provider/README.md`](../lti-content-provider/README.md). Start it first, or the JWKS fetch during the first launch will fail.

## 4. Consumer setup

```bash
cd lti-consumer-lms
cp .env.example .env
npm install
npm run frontend:install
npm run setup            # keys:generate + db:migrate + db:seed
npm run frontend:build
npm run dev
```

**Demo accounts** (shared password `demo1234`):

| Email | Role |
|---|---|
| `angad@example.com` | student |
| `priya@example.com` | student |
| `instructor@example.com` | instructor — can run Deep Linking |

`npm run db:seed` also creates six `resource_links` marked `created_via='seed'`, purely so the scripted demo runs without an admin step first. Running Deep Linking replaces them with rows the provider itself supplied (`created_via='deep_linking'`), which is the real mechanism.

---

## 5. Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `4001` | HTTP port |
| `CONSUMER_BASE_URL` | `http://localhost:4001` | Public base URL |
| `LTI_ISSUER` | `http://localhost:4001` | The `iss` claim of every signed `id_token` — must match the provider's registration exactly |
| `DATABASE_URL` | `postgres://lti:lti@localhost:5433/lti_consumer` | Consumer database |
| `LTI_PRIVATE_KEY_PATH` | `./keys/private.pem` | **Signs id_tokens — backend only** |
| `LTI_PUBLIC_KEY_PATH` | `./keys/public.pem` | Published via JWKS |
| `LTI_KEY_ID` | `platform-key-1` | `kid` in the JWKS and signed JWT headers |
| `LTI_CLIENT_ID` | `edulab-content-provider` | Client ID issued to the tool |
| `LTI_DEPLOYMENT_ID` | `deployment-fin-001` | Deployment ID issued to the tool |
| `TOOL_NAME` | `EduLab Content Provider` | Display name |
| `TOOL_LOGIN_INITIATION_URL` | `http://localhost:4000/lti/login` | Where launches start |
| `TOOL_REDIRECT_URIS` | `http://localhost:4000/lti/launch` | Comma-separated allow-list |
| `TOOL_JWKS_URL` | `http://localhost:4000/.well-known/jwks.json` | Tool public keys |
| `SESSION_SECRET` | *(change me)* | Signs the demo session cookie |
| `DEMO_PASSWORD` | `demo1234` | Shared password for the seeded users |
| `ID_TOKEN_TTL_SECONDS` | `300` | `id_token` lifetime |
| `ACCESS_TOKEN_TTL_SECONDS` | `3600` | Access token lifetime |

---

## 6. Key generation

```bash
npm run keys:generate            # RSA-2048, PKCS#8 private + SPKI public
npm run keys:generate -- --force # replace an existing pair
```

- Written to `keys/`, **gitignored**, private key mode `0600` where supported.
- Loaded only by `src/lti/keys.ts` in the backend. **No file under `frontend/` imports it and it is never served.**
- The public half is published at <http://localhost:4001/.well-known/jwks.json>. This is the key the content provider fetches to verify every launch, so **do not regenerate it casually** — the tool caches the JWKS for five minutes and refetches on an unknown `kid`.

---

## 7. Platform registration

What the tool's administrator needs from this platform. Also at <http://localhost:4001/lti/config>, or:

```bash
npm run registration:print
```

| Field | Demo value |
|---|---|
| Platform name | `EduLab Consumer LMS` |
| Issuer (`iss`) | `http://localhost:4001` |
| Client ID | `edulab-content-provider` |
| Deployment ID | `deployment-fin-001` |
| Authorization endpoint | `http://localhost:4001/lti/authorize` |
| Token endpoint | `http://localhost:4001/lti/token` |
| JWKS URI | `http://localhost:4001/.well-known/jwks.json` |
| Deep Link return URL | `http://localhost:4001/lti/deep-link/return` |
| Key ID | `platform-key-1` |

## 8. Tool registration

What this platform stores about the tool it launches (`lti_tools`, seeded from `src/config/registration.ts`):

| Field | Demo value |
|---|---|
| Name | `EduLab Content Provider` |
| Client ID | `edulab-content-provider` |
| Deployment ID | `deployment-fin-001` |
| Login initiation URL | `http://localhost:4000/lti/login` |
| Redirect URIs | `http://localhost:4000/lti/launch` |
| Target link URI | `http://localhost:4000/lti/launch` |
| Tool JWKS URL | `http://localhost:4000/.well-known/jwks.json` |

Change any of these on one side and launches fail with an explained error — a useful thing to demonstrate.

---

## 9. Starting both applications

| | Command | URL |
|---|---|---|
| Postgres | `docker compose up -d` (repo root) | `localhost:5433` |
| Provider | `npm run dev` in `lti-content-provider` | <http://localhost:4000> |
| Consumer | `npm run dev` in `lti-consumer-lms` | <http://localhost:4001> |

`npm run dev` runs the backend with `tsx watch` and serves the built React app from `public/`. For hot-reload, also run `npm run frontend:dev` (Vite on :5174, proxying to :4001) — but drive the demo from :4001, the origin the tool has registered.

Production-style: `npm run build && npm start`.

---

## 10. Testing an LTI launch

Automated, from the repository root with both servers running:

```bash
node scripts/verify-lti-flow.mjs
```

Manually:

1. Sign in at <http://localhost:4001> as `angad@example.com` / `demo1234`.
2. **My courses → Introduction to Financial Markets → Launch lecture**.
3. The page shows the three-hop flow above the frame; the provider's player renders inside it.
4. **Close lecture**, then check <http://localhost:4000/admin> for the logged events.
5. Reload the course page — **Your launch history** shows the launch, its status, and the watch time the provider reported back over the authorised service call.

Deep Linking: sign in as `instructor@example.com`, open the course, click **Add content from provider**, select lectures, and watch the resource links change from `seeded link` to `via deep linking`.

Negative tests worth showing:

| Try this | Expected |
|---|---|
| Open `/lti/authorize` with no parameters | `400` with the specific missing parameter named |
| Reuse a `login_hint` | `400` — "unknown, expired, or already used" |
| Change `redirect_uri` to something unregistered | `400` — not registered for this tool |
| Sign in as a student and hit `/lti/deep-link/initiate` | `403` — instructors only |
| Post a Deep Linking response with a broken signature | `401` — signature check failed |

---

## 11. How activity logging works

**The detailed activity log lives on the provider**, because the provider owns the content and is the only side that can see playback. See [the provider's logging section](../lti-content-provider/README.md#11-how-activity-logging-works).

This side records what a platform legitimately knows:

- **`launch_sessions`** — one row per launch: user, tool, course, resource link, message type, `status` (`initiated` → `authorized`), the `state` and `nonce` that were echoed, IP, user agent, timestamps.
- **`reported_*` columns** — start, end, presence and watched seconds, filled in when the provider pushes a viewing summary over the token-endpoint-authorised service call. The LMS *displays* these; it never computes them.

Both are visible per course under **Your launch history**.

---

## What this database deliberately does not contain

- No video URLs.
- No lecture descriptions authored by the provider beyond the title text returned by Deep Linking.
- No copy of the provider's `courses` / `modules` / `lectures` tables.

`resource_links` holds only an id, a display title, a module label, and the `custom` parameters the provider asked us to send back on every launch. Delete the provider and this LMS has nothing to show — which is the point being demonstrated.
