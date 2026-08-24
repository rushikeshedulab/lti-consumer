# Consumer LMS — LTI 1.3 **Platform**

A small LMS: students, courses, enrolments, and a lecture list. It holds **no lecture content** — every lecture is opened by signing an LTI 1.3 `id_token` and handing the browser to the content provider.

The course list is **mirrored from the provider automatically**. Whatever the provider's administrator uploads appears here on its own; nobody on this side selects it.

Runs on <http://localhost:4001>.

---

## Table of contents

1. [Architecture](#1-architecture)
1a. [Where the course list comes from](#1a-where-the-course-list-comes-from)
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
├── services/       catalogSync.ts - mirrors the provider's catalog
└── utils/          the self-submitting form that carries LTI messages

frontend/           React (Vite) — login, courses, course detail, iframe host
db/                 schema.sql + accounts.sql (sign-in accounts only)
```

### Database tables

| Table | Purpose |
|---|---|
| `users` | The sign-in list — the only data this project installs |
| `courses` | Course **metadata only** — title, description, content source. Mirrored from the provider (`provider_course_id`) |
| `enrollments` | Who can open what. Created by the mirror |
| `lti_tools` | Registered tools: client_id, deployment_id, endpoints, JWKS URL |
| `resource_links` | Links to provider content: id, title, module label, custom params. Mirrored from the provider (`created_via='provider_sync'`) |
| `launch_sessions` | One row per launch, plus any duration the provider reports back |
| `login_hints` | One-time, short-lived handles that carry identity across the OIDC hop |

---

## 1a. Where the course list comes from

`src/services/catalogSync.ts` mirrors the tool's catalog: it calls the provider's `GET /api/catalog` and makes this database match the answer — creating courses, creating a `resource_links` row per published item, enrolling every user, and **deleting** whatever the provider has withdrawn.

- **What crosses the wire is metadata only**: item ids, titles, module structure, content type and duration. No content URLs, no bytes. Opening anything still costs a full LTI 1.3 launch, so this changes what is *offered*, never what is *delivered*.
- **Authentication** is the mirror image of the tool's `private_key_jwt` client assertion: this platform signs a two-minute JWT with its own private key, addressed to that exact catalog URL, and the tool verifies it against our published JWKS. No shared secret.
- **When it runs**: on startup, every `CATALOG_SYNC_INTERVAL_SECONDS` in the background, and on every course page load (throttled and coalesced, so a burst of page loads makes one request). **Check for new content** on the course page forces one.
- **If the provider is down** the sync fails quietly, the last mirrored list keeps being served, and the course page says so.

Enrolment follows the catalog: with nobody curating a course here, there is nobody to build a roster either, so every user in `users` is enrolled in every provider course, keeping their LMS role (`instructor` → `Instructor`, everyone else → `Learner`).

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

The **`custom`** claim is the hinge of the whole design: it carries the *provider's own* lecture id, taken from the provider's catalog. It is how the provider resolves exactly which lecture to serve while this database holds none of the content.

The token is then form-POSTed to the tool's `redirect_uri` together with the unchanged `state`.

### Step 4 — Deep Linking (`/lti/deep-link/initiate` and `/lti/deep-link/return`)

Deep Linking is still implemented and still spec-complete, but it is **no longer how content gets here** — the catalog mirror does that. It stays in place because it is part of LTI Advantage and is worth being able to demonstrate; the automatic mirror is authoritative, so links it wrote are reconciled against the catalog on the next sync.

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
npm run setup            # keys:generate + db:migrate + db:accounts
npm run frontend:build
npm run dev
```

`npm run db:accounts` installs two things and nothing else: the sign-in list from `db/accounts.sql`, and the tool registration. **No courses, no enrolments and no lecture links** — those are mirrored from the provider, so a fresh install shows an empty course list until the provider's admin uploads something.

**Sign-in accounts** (shared password `demo1234`) — edit `db/accounts.sql` to use your own people, then re-run `npm run db:accounts`:

| Email | Role |
|---|---|
| `angad@example.com` | student |
| `priya@example.com` | student |
| `instructor@example.com` | instructor |

Coming from an older checkout with seeded courses and links in the database? `npm run db:reset-content` drops every course, enrolment and lecture link (users and the tool registration survive); the real ones come straight back on the next sync.

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
| `DEMO_PASSWORD` | `demo1234` | Shared password for the accounts in `db/accounts.sql` |
| `CATALOG_SYNC_INTERVAL_SECONDS` | `60` | Background catalog refresh interval |
| `TOOL_CATALOG_URL` | *(derived)* | Override only if the tool serves its catalog somewhere other than `<tool origin>/api/catalog` |
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

0. Publish something first: <http://localhost:4000/admin> → **Content** → create a course, add a module, upload a file.
1. Sign in at <http://localhost:4001> as `angad@example.com` / `demo1234`. The course is already there.
2. **My courses → your course → Launch lecture**.
3. The page shows the three-hop flow above the frame; the provider's player renders inside it.
4. **Close lecture**, then check <http://localhost:4000/admin> for the logged events.
5. Reload the course page — **Your launch history** shows the launch, its status, and the watch time the provider reported back over the authorised service call.
6. Delete the item in the provider's admin panel and reload: it is gone from here too.

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

- No video URLs, and no file of any kind.
- No copy of the provider's `lectures` rows: the catalog mirror deliberately carries no `content_url`.
- Nothing that would let this side serve content if the provider vanished.

`resource_links` holds only an id, a display title, a module label, and the `custom` parameters the provider asked us to send back on every launch. The mirrored `courses` rows hold a title and a description, which is what a course list needs to render and no more. Delete the provider and this LMS has nothing to show — which is the point being demonstrated.
