# Super-admin console (static SPA)

Vite + React UI for `/v1/super-admin/*`. Build with `VITE_API_BASE_URL` pointing at your API (e.g. `https://api.elevatewebandmarketing.com`).

## Deploy

- **Vercel:** set project root to `super-admin-web`; use [`vercel.json`](vercel.json) for security headers (CSP starts as Report-Only).
- **Netlify:** use [`netlify.toml`](netlify.toml); adjust CSP `connect-src` to your API host if needed.

Full checklist: [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) (sections D4–D6, 6–8).
