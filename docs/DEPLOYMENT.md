# Deployment, integrations, and GitHub

This document summarizes what the **Elevate Backend** uses, how auth and storage work, and the **step-by-step** checklist to configure services and push the repo to **GitHub** safely.

---

## 1. What this service is

| Concern | Implementation |
|--------|----------------|
| **HTTP API** | Fastify, versioned under `/v1`; OpenAPI JSON at `/v1/openapi.json` (hidden in production unless `OPENAPI_PUBLIC_IN_PRODUCTION=true`); Swagger UI at `/v1/docs` when `NODE_ENV` is not `production` |
| **Primary storage** | **PostgreSQL** (Neon, Supabase, RDS, etc.) via Drizzle ORM + SQL migrations in `drizzle/` |
| **Tenancy** | Shared DB with `organization_id` on tenant rows; queries scoped by org (JWT or site key) |
| **Public marketing sites** | **Site keys** (`X-Site-Key` or `Authorization: Bearer <key>`), hashed with `SITE_KEY_PEPPER` |
| **Admin / staff** | **JWT** after `POST /v1/auth/login` (email + password + `organizationSlug`); roles `org_admin` / `org_viewer` |
| **Super admin** | Separate **`super_admins`** table + **`SUPER_ADMIN_JWT_SECRET`**; `POST /v1/super-admin/auth/login`; cross-tenant routes under `/v1/super-admin/*` |
| **Super admin UI** | Static SPA from [`super-admin-web/`](../super-admin-web/) — deploy to e.g. `https://backend.elevatewebandmarketing.com`; API at `https://api.elevatewebandmarketing.com` |
| **Optional: media** | **Cloudinary** — signed direct uploads via `POST /v1/admin/cloudinary/upload-signature` when env is set |
| **Optional: email** | **Resend** — `POST /v1/admin/email/test` when `RESEND_API_KEY` is set (`org_admin` only) |
Nothing in the **domain** layer hard-codes vendor URLs; secrets come from **environment variables**.

---

## 2. Environment variables (production checklist)

Copy [`.env.example`](../.env.example) and set these for your host (Render, Railway, Fly, VPS, etc.):

### Required (API will not start without them)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (use SSL for cloud DBs, e.g. `?sslmode=require`) |
| `JWT_SECRET` | At least 32 characters; used to sign admin JWTs |
| `SITE_KEY_PEPPER` | At least 16 characters; hashes publishable site keys |
| `NODE_ENV` | Set to **`production`** on public deployments |
| `CORS_ORIGINS` | Comma-separated **exact** origins of your admin app, marketing sites, and **super-admin SPA** origin (e.g. `https://backend.elevatewebandmarketing.com`) — no `*` in production if possible |
| `SUPER_ADMIN_JWT_SECRET` | At least 32 characters; signs super-admin JWTs (separate from `JWT_SECRET`) |

If the browser console shows **“Method PATCH is not allowed by Access-Control-Allow-Methods”**, the API must advertise **PATCH** (and related verbs) in CORS preflight — current `build-server` registers `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` for allowed origins. Deploy an up-to-date backend build.

### Common optional

| Variable | Purpose |
|----------|---------|
| `PORT` / `HOST` | Listen address (hosts often set `PORT` automatically) |
| `JWT_ACCESS_EXPIRES_IN` | Access token lifetime (e.g. `15m`) |
| `SUPER_ADMIN_ACCESS_EXPIRES_IN` | Super-admin JWT lifetime (e.g. `8h`) |
| `SUPER_ADMIN_BOOTSTRAP_EMAIL` / `SUPER_ADMIN_BOOTSTRAP_PASSWORD` | Optional paired vars: create first super admin when `super_admins` is empty (`npm run super-admin:bootstrap`); remove password from env after use |
| `SUPER_ADMIN_ALLOWED_IPS` | Optional comma-separated client IPs allowed for `/v1/super-admin/*` (empty = no IP restriction) |
| `TRUST_PROXY` | `true` when Node sits behind a reverse proxy / CDN so client IP + rate limits use `X-Forwarded-For` correctly |
| `AUTH_LOGIN_RATE_MAX` / `AUTH_LOGIN_RATE_WINDOW_MS` | Per-IP limits for `POST /v1/auth/login` and `POST /v1/super-admin/auth/login` |
| `OPENAPI_PUBLIC_IN_PRODUCTION` | When `true`, exposes `GET /v1/openapi.json` in production (default: hidden / 404) |

### Optional integrations (enable features when all related vars are set)

| Integration | Variables |
|-------------|-----------|
| **Cloudinary** | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (all three, or omit all) |
| **Resend** | `RESEND_API_KEY`; optional `RESEND_FROM` (e.g. `Acme <mail@yourdomain.com>` — must be allowed in Resend) |

`GET /v1/health` includes `integrations.cloudinary` and `integrations.email` booleans (no secrets exposed).

### Troubleshooting: `DELETE /v1/leads/:id` returns 404

Open DevTools → **Network** → select the failing **DELETE** request → **Response** (not only the status code).

| What you see | Likely cause |
|--------------|--------------|
| JSON body `{"error":"not_found"}` | No row deleted: that **lead id** does not exist for **your org** in the DB (wrong id, already deleted, or list/cache stale). Refresh **GET /v1/leads** and delete again using the `id` from the response. |
| Empty body, HTML, or no `not_found` JSON | **`DELETE` is not registered** on the server you are calling—almost always **Render (or host) is still running an older API build** before `DELETE /v1/leads/:id` existed. Redeploy the API from the current repo `main` (or the branch your service tracks), then retry. |
| 403 | Authenticated but not **`org_admin`** (viewers cannot delete). |

Quick check without the admin UI: same host as the app, `DELETE /v1/leads/<uuid>` with `Authorization: Bearer <staff JWT>`—if you still get 404 with an empty/non-JSON body, treat it as a **deploy/version** issue on the API.

---

## 3. Third-party setup (in order)

### A. PostgreSQL (Neon or other)

1. Create a project/database.
2. Copy the connection string → `DATABASE_URL`.
3. From your machine (with env loaded): `npm run db:migrate` against that URL (or run migrations in CI/deploy step).

### B. Resend (email)

1. Sign up at [resend.com](https://resend.com).
2. Create an **API key** → `RESEND_API_KEY`.
3. For **production**, add and verify your **domain** in Resend, then set `RESEND_FROM` to an address on that domain (e.g. `Notifications <notify@yourdomain.com>`).
4. For quick tests only, you can omit `RESEND_FROM` and the API defaults to Resend’s test sender (`onboarding@resend.dev`) — **not** for production deliverability.
5. Restart the API; `GET /v1/health` should show `"email": true`.
6. As an **org_admin** user, call `POST /v1/admin/email/test` with `{ "to": "your@email.com" }` to verify delivery.

### C. Cloudinary (images/videos)

1. Dashboard → copy **Cloud name**, **API Key**, **API Secret**.
2. Set all three env vars (see [.env.example](../.env.example)).
3. Restart; health shows `"cloudinary": true`.
4. Staff JWT → `POST /v1/admin/cloudinary/upload-signature` for signed browser uploads.
5. After each Cloudinary upload, call `POST /v1/admin/cloudinary/assets` to store metadata + uploader identity/tags in `media_assets`.
6. Super admin can review all uploads via `GET /v1/super-admin/media-assets` (also surfaced in the super-admin SPA media tab).

### D. Hosting the Node process

1. **Build:** `npm run build` → output in `dist/`.
2. **Start:** `npm start` (runs `node dist/index.js`).
3. Set all required env vars on the platform (including `SUPER_ADMIN_JWT_SECRET`).
4. Run **`npm run db:migrate`** once per database (or as part of release job) before traffic hits new versions.
5. **First super admin:** if `super_admins` is empty, set bootstrap email/password, run `npm run super-admin:bootstrap`, then unset the bootstrap password from env.
6. **Change super-admin email or password later:** use the super-admin SPA **Account** tab, or call `GET /v1/super-admin/me`, `PATCH /v1/super-admin/me/email`, and `POST /v1/super-admin/me/password` with a valid super-admin JWT (current password required for each change).

### D2. Two-subdomain layout (Elevate)

| Host | Role |
|------|------|
| `api.elevatewebandmarketing.com` | This Node API (`CORS_ORIGINS` must include the SPA origin below) |
| `backend.elevatewebandmarketing.com` | Super-admin SPA static files from `super-admin-web/dist` (build with `VITE_API_BASE_URL=https://api.elevatewebandmarketing.com`) |

Tenant marketing sites and org staff admin apps keep using `/v1/public/*` and `/v1/auth/login` as today; only platform operators use `/v1/super-admin/*` and the super-admin SPA.

### D3. Super-admin SPA build

From repo root:

```bash
cd super-admin-web
npm ci
echo "VITE_API_BASE_URL=https://api.elevatewebandmarketing.com" > .env.production
npm run build
```

Deploy the `super-admin-web/dist` folder to your static host for `backend.`.

### D4. Super-admin SPA on Vercel

1. **New Project** → connect this repo.
2. Set **Root Directory** to `super-admin-web`.
3. Build: `npm run build`; Output: `dist` (Vite default).
4. **Environment variable:** `VITE_API_BASE_URL=https://api.elevatewebandmarketing.com`.
5. **Domains:** add `backend.elevatewebandmarketing.com` and point DNS (CNAME) per Vercel instructions.
6. [`super-admin-web/vercel.json`](../super-admin-web/vercel.json) adds security headers and **CSP-Report-Only**. After deploy, open the site, watch the browser console for CSP reports, then tighten `connect-src` to your exact API origin and switch to enforcing CSP when ready.

### D5. Super-admin SPA on Netlify

1. **New site** from Git; **Base directory** `super-admin-web`.
2. Build command `npm run build`; **Publish directory** `dist`.
3. Set `VITE_API_BASE_URL` under Site configuration → Environment.
4. [`super-admin-web/netlify.toml`](../super-admin-web/netlify.toml) sets headers; edit CSP `connect-src` if your API host differs from `api.elevatewebandmarketing.com`.

### D6. Production security (defense in depth)

| Layer | What to do |
|-------|------------|
| **TLS** | Terminate HTTPS at the host or CDN; redirect HTTP → HTTPS. |
| **API headers** | `@fastify/helmet` adds baseline security headers on API responses. |
| **CORS** | Never use `*` in production; list every marketing + admin origin. |
| **Super-admin** | Strong unique password; optional `SUPER_ADMIN_ALLOWED_IPS`; consider WAF rules on `/v1/super-admin/*`. |
| **Edge** | Rate-limit and bot protection at CDN (Cloudflare, etc.) for login routes. |
| **SPA** | [`super-admin-web/src/api.ts`](../super-admin-web/src/api.ts) clears session on 401; idle timeout and password re-entry for destructive actions in [`App.tsx`](../super-admin-web/src/App.tsx). |

### E. Uptime monitoring (optional)

- Add an HTTP monitor to `https://your-api-host/v1/health` (e.g. UptimeRobot); optional keyword `"ok"` in body.

---

## 4. GitHub: repository and secrets

### Before you push

1. **Never commit:** `.env` or `.env.local`. They are listed in [.gitignore](../.gitignore).
2. Commit **`.env.example`** (no real secrets) so others know which variables exist.
3. Optionally add a **CI workflow** (see [.github/workflows/ci.yml](../.github/workflows/ci.yml)) that runs `npm ci`, `npm test`, `npm run build`, and builds `super-admin-web`. Tests use [`test/setup-env.ts`](../test/setup-env.ts) — adjust if CI needs a real `DATABASE_URL` for stricter tests later.

### Create the GitHub repository

1. On GitHub: **New repository** → name it (e.g. `elevate-backend`), **private** recommended until you intend to open-source.
2. **Do not** add a README/license on GitHub if you already have them locally (avoid merge pain), or choose “Add README” and merge carefully.
3. Locally (replace URL):

   ```bash
   git init
   git add .
   git commit -m "Initial commit: Elevate backend API"
   git branch -M main
   git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
   git push -u origin main
   ```

### GitHub Actions / deploy secrets (if you deploy from GitHub)

In the repo: **Settings → Secrets and variables → Actions**, add secrets your workflow or host integration expects, for example:

- `DATABASE_URL` (sometimes only on the host, not in GitHub — depends on pipeline)
- `JWT_SECRET`, `SITE_KEY_PEPPER`, `SUPER_ADMIN_JWT_SECRET` (when CI loads full env)
- Optional: `RESEND_API_KEY`, Cloudinary vars

**Prefer** storing production secrets in the **hosting provider** (Render/Railway/Fly secrets UI) and keeping GitHub secrets only for CI that truly needs them.

---

## 5. Admin websites and frontends (outside this repo)

- Marketing sites: `PUBLIC_API_BASE_URL` + `PUBLIC_SITE_KEY` (raw key from seed/ops).
- Org staff admin app: same API base URL; login via `POST /v1/auth/login`; send `Authorization: Bearer <access_token>` to `/v1/leads`.
- **Super-admin console (in-repo):** [`super-admin-web/`](../super-admin-web/) — build with `VITE_API_BASE_URL` pointing at the API; token from `POST /v1/super-admin/auth/login` stored in `sessionStorage`.
- Ensure **CORS** includes every browser origin that will call the API (including the super-admin SPA origin).

---

## 6. Quick verification after deploy

1. `GET /v1/health` → `200`, JSON with `status: "ok"` and `integrations` flags.
2. Non-production: `GET /v1/docs` → Swagger UI loads. Production: skip or protect docs at the proxy.
3. `POST /v1/auth/login` → `access_token`.
4. `GET /v1/leads` with Bearer token → `200`.
5. Super admin: `POST /v1/super-admin/auth/login` → use token on `/v1/super-admin/organizations`.
6. If Resend configured: `POST /v1/admin/email/test` as `org_admin`.
7. Production: `GET /v1/openapi.json` → **404** unless `OPENAPI_PUBLIC_IN_PRODUCTION=true`.
8. `curl -I https://backend.elevatewebandmarketing.com` → security headers present (HSTS, `X-Frame-Options`, CSP-Report-Only on static host).

---

## 7. Post-deploy validation and rollback

**Validate**

- API: `GET /v1/health`, smoke test `POST /v1/super-admin/auth/login` and one read-only super-admin `GET`.
- SPA: login, idle timeout (30m), lead delete and site key rotation (password confirmation modals).
- Headers: `curl -I` on API and SPA origins; fix CSP violations before enforcing CSP.

**Rollback**

- Redeploy the previous API release from your host’s dashboard.
- Database: avoid destructive migrations without backups; keep Neon/Postgres snapshots for production.

**Monitoring**

- Uptime on `/v1/health` (e.g. UptimeRobot).
- Alert on elevated 401/429 rates on `/v1/auth/login` and `/v1/super-admin/auth/login`.

---

## 8. Summary table

| Piece | You configure in… |
|-------|-------------------|
| Database | Neon/host → `DATABASE_URL` |
| API secrets | Host env: `JWT_SECRET`, `SITE_KEY_PEPPER`, `SUPER_ADMIN_JWT_SECRET` |
| CORS | `CORS_ORIGINS` (no `*` in production) |
| Proxy IP | `TRUST_PROXY=true` behind load balancers/CDNs |
| Login abuse | `AUTH_LOGIN_RATE_*` + edge WAF optional |
| OpenAPI in prod | `OPENAPI_PUBLIC_IN_PRODUCTION` (default hidden) |
| Email | Resend dashboard + `RESEND_API_KEY`, `RESEND_FROM` |
| Media | Cloudinary dashboard + three `CLOUDINARY_*` vars |
| Super-admin SPA | Vercel/Netlify + `VITE_API_BASE_URL` + `vercel.json` / `netlify.toml` |
| GitHub | Repo + `.gitignore`; optional Actions secrets |
| Runtime | `NODE_ENV=production`, `npm run build` + `npm start`, run migrations |

For local development steps, see the main [README](../README.md).
