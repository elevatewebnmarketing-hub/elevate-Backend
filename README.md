# Elevate Central API

Multi-tenant **REST + JSON** backend for marketing lead capture and staff admin. Contract is **OpenAPI 3** at `/v1/openapi.json` (Swagger UI at `/v1/docs` when `NODE_ENV` is not `production`).

**Production / GitHub / integrations (Postgres, Resend, Cloudinary, env checklist):** see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

- **Runtime:** Node.js 20+ (LTS), TypeScript
- **HTTP:** Fastify
- **Database:** PostgreSQL with **Drizzle ORM** + SQL migrations in [`drizzle/`](drizzle/)
- **Public forms:** `X-Site-Key` or `Authorization: Bearer <publishable_key>` (keys stored hashed with a server-side pepper)
- **Admin / staff:** JWT access tokens with **RBAC** (`org_admin`, `org_viewer`) scoped to `organization_id`

## Layout

- [`src/http/`](src/http/) — routes, CORS, rate limits, OpenAPI
- [`src/application/`](src/application/) — use cases (submit/list leads, login)
- [`src/domain/`](src/domain/) — shared constants (verticals, roles)
- [`src/persistence/`](src/persistence/) — Drizzle schema, repositories
- [`src/integrations/`](src/integrations/) — optional third-party helpers (Cloudinary, Resend)
- [`super-admin-web/`](super-admin-web/) — Vite + React SPA for platform super-admin (deploy separately, e.g. `backend.` subdomain)

## Prerequisites

- Node.js 20+
- A PostgreSQL instance (local Docker, [Neon](https://neon.tech), [Supabase](https://supabase.com), etc.)

## Configuration

Copy [`.env.example`](.env.example) to `.env` and set:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signing key for admin JWTs (min 32 characters in production) |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime (e.g. `15m`, `1h`) |
| `SITE_KEY_PEPPER` | Secret mixed into publishable site key hashes (min 16 characters) |
| `CORS_ORIGINS` | Comma-separated allowed browser origins (`*` only for local experiments; **not allowed when `NODE_ENV=production`**) |
| `TRUST_PROXY` | `true` behind a reverse proxy/CDN so client IP and rate limits are correct |
| `AUTH_LOGIN_RATE_MAX` / `AUTH_LOGIN_RATE_WINDOW_MS` | Per-IP limits for staff and super-admin **login** endpoints |
| `OPENAPI_PUBLIC_IN_PRODUCTION` | Set `true` only if `GET /v1/openapi.json` should be public in production (default: hidden) |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | In-memory rate limit for **public** lead submissions |
| `SUPER_ADMIN_JWT_SECRET` | Separate signing key for super-admin JWTs (min 32 characters) |
| `SUPER_ADMIN_ACCESS_EXPIRES_IN` | Super-admin token lifetime (e.g. `8h`) |
| `SUPER_ADMIN_BOOTSTRAP_EMAIL` / `SUPER_ADMIN_BOOTSTRAP_PASSWORD` | Optional: create first `super_admins` row when table is empty (`npm run super-admin:bootstrap`) |
| `SUPER_ADMIN_ALLOWED_IPS` | Optional comma list to restrict `/v1/super-admin/*` by client IP |
| `CLOUDINARY_*` (optional) | See [Cloudinary setup](#cloudinary-images--videos) — set all three or omit all |
| `RESEND_API_KEY` / `RESEND_FROM` (optional) | [Resend](https://resend.com) email; see [Resend](#resend-email) — `RESEND_FROM` recommended for production |

## Database

Generate migrations after schema changes:

```bash
npx drizzle-kit generate
```

Apply migrations:

```bash
npm run db:migrate
```

(Uses `DATABASE_URL` from the environment.)

Inspect data (optional):

```bash
npm run db:studio
```

## Seed (demo org, site key, admin user)

After migrations:

```bash
npm run seed
```

The script prints a **publishable site key** and default admin credentials. Override with env vars: `SEED_ORG_SLUG`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_SITE_KEY`.

On **Windows PowerShell**, set vars for one command like this (Unix `VAR=value cmd` does not apply):

```powershell
$env:SEED_ORG_SLUG = "new-org"; npm run seed
```

## Super admin (platform operator)

Super admins live in the `super_admins` table and authenticate with a **separate JWT** from org staff (`SUPER_ADMIN_JWT_SECRET`). API routes are under `/v1/super-admin/*`.

After migrations, if the table is empty, set `SUPER_ADMIN_BOOTSTRAP_EMAIL` and `SUPER_ADMIN_BOOTSTRAP_PASSWORD` in `.env`, then run once:

```bash
npm run super-admin:bootstrap
```

Remove the bootstrap password from the environment afterward. Build and deploy the SPA in [`super-admin-web/`](super-admin-web/) with `VITE_API_BASE_URL` pointing at your API (e.g. `https://api.example.com`). See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the two-subdomain layout (`api.` + `backend.`).

## Run

Development (watch):

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm start
```

## Tests

```bash
npm test
```

Uses default test env in [`test/setup-env.ts`](test/setup-env.ts). Point `DATABASE_URL` at a disposable DB if you add integration tests that hit Postgres.

## API quick reference

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/v1/health` | None |
| `GET` | `/v1/docs` | Swagger UI — **not** registered when `NODE_ENV=production` |
| `GET` | `/v1/openapi.json` | OpenAPI document |
| `POST` | `/v1/super-admin/auth/login` | Body: `email`, `password` — returns super-admin JWT |
| `GET` etc. | `/v1/super-admin/*` | Bearer super-admin JWT (see OpenAPI tag `super-admin`) |
| `POST` | `/v1/public/leads` | Site key + optional per-site origin allowlist |
| `POST` | `/v1/auth/login` | Body: `email`, `password`, `organizationSlug` |
| `GET` | `/v1/leads` | Bearer JWT |
| `GET` | `/v1/leads/:id` | Bearer JWT |
| `POST` | `/v1/admin/cloudinary/upload-signature` | Bearer JWT (only if Cloudinary env is configured) |
| `POST` | `/v1/admin/cloudinary/assets` | Bearer JWT — save uploaded media metadata to org media library |
| `GET` | `/v1/admin/cloudinary/assets` | Bearer JWT — list media uploaded by your org |
| `POST` | `/v1/admin/email/test` | Bearer JWT, **org_admin** only (only if `RESEND_API_KEY` is set) |

### Example: submit a lead (curl)

Replace `BASE_URL`, `SITE_KEY`, and JSON as needed.

```bash
curl -sS -X POST "$BASE_URL/v1/public/leads" \
  -H "Content-Type: application/json" \
  -H "X-Site-Key: $SITE_KEY" \
  -H "Origin: https://your-marketing-site.example" \
  -d '{
    "industryVertical": "construction",
    "sourceSystem": "marketing-site",
    "formId": "contact-main",
    "email": "prospect@example.com",
    "fullName": "Jane Doe",
    "message": "We need a quote.",
    "construction": {
      "projectType": "residential",
      "timeline": "3-6 months",
      "budgetRange": "50k-100k"
    }
  }'
```

If the site row has `allowed_origins` set in the database, the request **`Origin`** header must match one of them.

### Example: login and list leads (curl)

```bash
curl -sS -X POST "$BASE_URL/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"ChangeMe!123","organizationSlug":"demo-org"}'
```

Copy `access_token` from the JSON response, then:

```bash
curl -sS "$BASE_URL/v1/leads?limit=20" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN_HERE"
```

### Token lifetimes and rotation

- **JWT access tokens:** lifetime from `JWT_ACCESS_EXPIRES_IN` (documented in env). No refresh-token flow in this slice; add refresh tokens or shorter access TTL for stricter security.
- **Site keys:** stored as **SHA-256(rawKey + pepper)**. Rotate by creating a new `sites` row with a new hash, updating frontends (`PUBLIC_SITE_KEY`), then deactivating the old row (`is_active = false`).

### CORS

`CORS_ORIGINS` must include every browser origin that will call this API (e.g. marketing site and admin app). Per-site `allowed_origins` on `sites` adds an extra check for **public** lead posts.

## Cloudinary (images & videos)

This API does **not** proxy file bytes through Node by default. Instead, authenticated staff can request a **signed upload** payload and upload **directly to Cloudinary** from the browser or app. Files are stored under a per-organization folder: `elevate/orgs/<organization_id>/…`.

### 1. Create a Cloudinary account

1. Sign up at [cloudinary.com](https://cloudinary.com).
2. Open the **Dashboard** and note **Cloud name**, **API Key**, and **API Secret** (Product environment credentials).

### 2. Configure this service

Add to `.env` (set **all three** or leave all unset):

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

Restart the API. The route `POST /v1/admin/cloudinary/upload-signature` appears in OpenAPI (`/v1/docs`) only when Cloudinary is configured.

### 3. Request a signature (admin JWT)

```bash
curl -sS -X POST "$BASE_URL/v1/admin/cloudinary/upload-signature" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resourceType":"image","context":"gallery"}'
```

Response includes `uploadUrl`, `folder`, `timestamp`, `signature`, `apiKey`, and `cloudName`. The client then **POSTs `multipart/form-data`** to `uploadUrl` with fields including: `file`, `api_key` (= `apiKey`), `timestamp`, `signature`, and `folder` (same values as returned). Use `resourceType` `"video"` for video uploads (different `uploadUrl` path).

**Never** expose `CLOUDINARY_API_SECRET` to frontends; only use the signature returned by this API.

### 4. Storing references

After the direct upload succeeds on Cloudinary, call `POST /v1/admin/cloudinary/assets` to persist media metadata (`publicId`, `secureUrl`, dimensions/duration, purpose/tags). The backend stores uploader + org + tags so assets can be audited and shown in the super-admin media panel (`GET /v1/super-admin/media-assets`).

## Resend (email)

1. Create an API key at [resend.com](https://resend.com) → set `RESEND_API_KEY` in `.env`.
2. For production, verify your domain in Resend and set `RESEND_FROM` (e.g. `Acme <mail@yourdomain.com>`). For quick local tests you can omit `RESEND_FROM` and the API uses Resend’s test sender (not for production deliverability).
3. Restart the API; `GET /v1/health` includes `"integrations": { "email": true, ... }` when configured.
4. As a user with role **`org_admin`**, call `POST /v1/admin/email/test` with body `{ "to": "you@example.com" }` to verify delivery.

---

## UptimeRobot (uptime monitoring)

Use [UptimeRobot](https://uptimerobot.com) (or any HTTP monitor) to alert you when the API is down or slow.

### 1. Create an account

Sign up at [uptimerobot.com](https://uptimerobot.com) (free tier allows a limited number of monitors).

### 2. Add an HTTP(s) monitor

1. **Add New Monitor** → type **HTTP(s)**.
2. **Friendly name:** e.g. `Elevate API health`.
3. **URL:** your public API base + health path, e.g. `https://api.yourdomain.com/v1/health` (use your real deployment URL, not `localhost`, unless you use a tunnel for testing).
4. **Monitoring interval:** e.g. 5 minutes (free tier limits may apply).
5. Optional: enable **Keyword monitoring** and require response body to contain `"ok"` (matches the JSON from `GET /v1/health`).

### 3. Alerts

Add your **email** or **SMS** (where supported) under alert contacts so you get notified on downtime.

### 4. Deployed URL reminder

Replace `localhost` with your real host (e.g. Render/Railway/Fly). If the app **sleeps** on a free tier, monitors may show intermittent failures — that is expected unless you use a keep-alive plan or paid tier.

---

## Tenancy and hosting (free tier)

**Default model:** one PostgreSQL database, **shared by all organizations**, with **`organization_id` on every tenant-owned row** and queries always filtered by the org resolved from the JWT or from the site key.

Separate databases per major client are desirable for isolation, but **most free tiers** give you one database per project. Practical approach:

1. Start with **shared DB + `organization_id`** (this codebase).
2. Move a tenant to its own database when you need compliance isolation, noisy-neighbor separation, or scale — export that org’s rows and point a dedicated deployment at a new `DATABASE_URL`.

**Typical free stack:** app on [Render](https://render.com) / [Railway](https://railway.app) / [Fly.io](https://fly.io) + Postgres on [Neon](https://neon.tech) or Supabase. Expect **cold starts** and **sleep** on free app tiers; **in-memory rate limits** do not coordinate across multiple instances (use Redis later if you scale horizontally).

## Integrating external frontends (monorepo consumers)

This service stays in **its own repository**. Your existing `frontend/` and `admin/` apps should use env vars only, for example:

- `PUBLIC_API_BASE_URL` — base URL of this API (e.g. `https://api.yourdomain.com`)
- `PUBLIC_SITE_KEY` — publishable key from the `seed` output or ops
- Admin: same `API_BASE_URL` + login against `/v1/auth/login`, then attach `Authorization: Bearer <access_token>` to `/v1/leads` calls

Do not embed the backend inside the monorepo; treat it as an external HTTP dependency.

## Non-goals

Payment processing / PCI, clinical or patient data (HIPAA PHI), full CRM UI.

## License

Private / unlicensed unless you add one.
# elevate-Backend
