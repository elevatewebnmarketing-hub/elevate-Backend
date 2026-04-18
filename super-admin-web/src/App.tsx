import { useCallback, useEffect, useState } from "react";
import {
  apiFetch,
  clearSuperAdminSession,
  fetchPublicHealth,
  getSuperAdminEmail,
  getToken,
  SESSION_LOST_EVENT,
  setSuperAdminEmail,
  setToken,
  type HealthResponse,
} from "./api";

const IDLE_SIGN_OUT_MS = 30 * 60 * 1000;

type Tab =
  | "dashboard"
  | "account"
  | "orgs"
  | "sites"
  | "users"
  | "leads"
  | "media";

type Organization = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

type SiteRow = {
  id: string;
  organizationId: string;
  keyHash: string;
  label: string;
  allowedOrigins: string[] | null;
  isActive: boolean;
  createdAt: string;
  rotatedAt: string | null;
  organizationName: string;
  organizationSlug: string;
  keyPreview: string;
};

type UserRow = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  createdAt: string;
  organizationName: string;
  organizationSlug: string;
};

type LeadRow = {
  id: string;
  organizationId: string;
  siteId: string;
  email: string;
  fullName: string;
  submittedAt: string;
  organizationName: string;
  siteLabel: string;
};

type MediaAssetRow = {
  id: string;
  organizationId: string;
  uploadedByUserId: string;
  cloudinaryPublicId: string;
  cloudinaryResourceType: "image" | "video";
  secureUrl: string;
  bytes: string | null;
  width: string | null;
  height: string | null;
  durationSeconds: string | null;
  format: string | null;
  folder: string | null;
  title: string | null;
  purpose: string | null;
  tags: string[] | null;
  createdAt: string;
  organizationName: string;
  organizationSlug: string;
  uploaderEmail: string;
};

function formatTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Re-authenticate with password before destructive / high-impact actions. */
function ReauthModal({
  title,
  description,
  onClose,
  onAfterReauth,
  onError,
}: {
  title: string;
  description: string;
  onClose: () => void;
  onAfterReauth: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const email = getSuperAdminEmail();
    if (!email) {
      onError(
        new Error("Missing session email — sign out and sign in again."),
      );
      return;
    }
    setBusy(true);
    try {
      const loginRes = await apiFetch<{ access_token: string }>(
        "/v1/super-admin/auth/login",
        {
          method: "POST",
          json: { email, password },
          skipSessionResetOn401: true,
        },
      );
      setToken(loginRes.access_token);
      await onAfterReauth();
      setPassword("");
      onClose();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-md rounded-xl border border-amber-500/30 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-medium text-amber-100">{title}</h3>
        <p className="mt-2 text-sm text-slate-400">{description}</p>
        <label className="mt-4 block text-sm">
          <span className="text-slate-400">Super-admin password</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || password.length < 1}
            className="rounded-lg bg-amber-700 px-4 py-2 text-sm text-white hover:bg-amber-600 disabled:opacity-50"
            onClick={() => void submit()}
          >
            {busy ? "Verifying…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loggedIn, setLoggedIn] = useState(() => Boolean(getToken()));
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showError = useCallback((e: unknown) => {
    setBanner(e instanceof Error ? e.message : String(e));
  }, []);

  const clearBanner = useCallback(() => setBanner(null), []);

  useEffect(() => {
    if (banner) {
      const t = window.setTimeout(() => setBanner(null), 12000);
      return () => window.clearTimeout(t);
    }
  }, [banner]);

  useEffect(() => {
    const onSessionLost = () => {
      setLoggedIn(false);
      setBanner("Session ended — please sign in again.");
    };
    window.addEventListener(SESSION_LOST_EVENT, onSessionLost);
    return () => window.removeEventListener(SESSION_LOST_EVENT, onSessionLost);
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    let lastActivity = Date.now();
    const bump = () => {
      lastActivity = Date.now();
    };
    const tick = window.setInterval(() => {
      if (Date.now() - lastActivity > IDLE_SIGN_OUT_MS) {
        clearSuperAdminSession(false);
        setLoggedIn(false);
        setBanner("Signed out after 30 minutes of inactivity.");
      }
    }, 60_000);
    window.addEventListener("keydown", bump);
    window.addEventListener("click", bump);
    window.addEventListener("mousemove", bump);
    return () => {
      clearInterval(tick);
      window.removeEventListener("keydown", bump);
      window.removeEventListener("click", bump);
      window.removeEventListener("mousemove", bump);
    };
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <LoginView
        onLoggedIn={() => setLoggedIn(true)}
        onError={showError}
        banner={banner}
        onDismissBanner={clearBanner}
        busy={busy}
        setBusy={setBusy}
      />
    );
  }

  return (
    <div className="app-shell min-h-screen">
      {banner && (
        <div
          className="border-b border-amber-500/30 bg-amber-950/90 px-4 py-3 text-amber-50 backdrop-blur-md"
          role="alert"
        >
          <div className="mx-auto flex max-w-6xl items-start justify-between gap-4">
            <p className="text-sm leading-relaxed">{banner}</p>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-amber-200/90 hover:bg-amber-900/50"
              onClick={clearBanner}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-slate-950/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/20">
              <span className="text-lg font-bold text-white" aria-hidden>
                E
              </span>
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-white md:text-lg">
                Elevate super admin
              </h1>
              <p className="text-xs text-slate-500">
                Cross-tenant control plane · restrict access to trusted networks
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/[0.06]"
            onClick={() => {
              clearSuperAdminSession(false);
              setLoggedIn(false);
            }}
          >
            Sign out
          </button>
        </div>
        <nav className="mx-auto flex max-w-6xl flex-wrap gap-1.5 px-4 pb-4">
          {(
            [
              ["dashboard", "Overview"],
              ["account", "Account"],
              ["orgs", "Organizations"],
              ["sites", "Sites"],
              ["users", "Users"],
              ["leads", "Leads"],
              ["media", "Media"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                tab === id
                  ? "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-md shadow-violet-500/25"
                  : "text-slate-400 hover:bg-white/[0.05] hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 md:py-10">
        {tab === "dashboard" && (
          <DashboardPanel onError={showError} onNavigate={setTab} />
        )}
        {tab === "account" && (
          <AccountPanel onError={showError} onSuccessMsg={setBanner} />
        )}
        {tab === "orgs" && (
          <OrgsPanel onError={showError} onSuccessMsg={setBanner} />
        )}
        {tab === "sites" && (
          <SitesPanel onError={showError} onSuccessMsg={setBanner} />
        )}
        {tab === "users" && (
          <UsersPanel onError={showError} onSuccessMsg={setBanner} />
        )}
        {tab === "leads" && <LeadsPanel onError={showError} />}
        {tab === "media" && <MediaPanel onError={showError} />}
      </main>
    </div>
  );
}

function DashboardPanel({
  onError,
  onNavigate,
}: {
  onError: (e: unknown) => void;
  onNavigate: (t: Tab) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [counts, setCounts] = useState<{
    orgs: number;
    sites: number;
    users: number;
    leads: number;
    media: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const h = await fetchPublicHealth();
      setHealth(h);
      const [orgRes, siteRes, userRes, leadsRes, mediaRes] = await Promise.all([
        apiFetch<{ items: Organization[] }>("/v1/super-admin/organizations"),
        apiFetch<{ items: SiteRow[] }>("/v1/super-admin/sites"),
        apiFetch<{ items: UserRow[] }>("/v1/super-admin/users"),
        apiFetch<{ total: number }>("/v1/super-admin/leads?limit=1&offset=0"),
        apiFetch<{ total: number }>(
          "/v1/super-admin/media-assets?limit=1&offset=0",
        ),
      ]);
      setCounts({
        orgs: orgRes.items.length,
        sites: siteRes.items.length,
        users: userRes.items.length,
        leads: leadsRes.total,
        media: mediaRes.total,
      });
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const integ = health?.integrations;

  const statCards: {
    label: string;
    value: string | number;
    hint: string;
    tab: Tab;
  }[] =
    counts && !loading
      ? [
          {
            label: "Organizations",
            value: counts.orgs,
            hint: "Tenants on the platform",
            tab: "orgs",
          },
          {
            label: "Sites",
            value: counts.sites,
            hint: "Publishable site keys",
            tab: "sites",
          },
          {
            label: "Staff users",
            value: counts.users,
            hint: "Org logins (JWT)",
            tab: "users",
          },
          {
            label: "Leads (all time)",
            value: counts.leads,
            hint: "Form submissions",
            tab: "leads",
          },
          {
            label: "Media assets",
            value: counts.media,
            hint: "Cloudinary-backed uploads",
            tab: "media",
          },
        ]
      : [];

  return (
    <div className="space-y-10">
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-slate-900/90 via-slate-900/50 to-violet-950/30 p-6 shadow-2xl shadow-black/40 md:p-8">
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-fuchsia-500/15 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-violet-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-widest text-violet-300/90">
            Platform overview
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">
            Operations dashboard
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Monitor tenants, keys, and content pipeline. Tenant-facing CMS (blog,
            hiring, portfolio) and lead notification emails are managed in each org’s
            staff admin — this console is for provisioning and cross-org visibility.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-white/[0.08] px-4 py-2 text-sm font-medium text-white ring-1 ring-white/10 transition hover:bg-white/[0.12]"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Refreshing…" : "Refresh data"}
            </button>
            <button
              type="button"
              className="rounded-lg px-4 py-2 text-sm font-medium text-slate-300 hover:bg-white/[0.05]"
              onClick={() => onNavigate("orgs")}
            >
              New organization →
            </button>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
          API status
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-white/[0.06] bg-slate-900/40 p-4 backdrop-blur-sm">
            <p className="text-xs text-slate-500">Health</p>
            <p className="mt-1 text-lg font-semibold text-emerald-400">
              {health?.status === "ok" ? "OK" : health ? String(health.status) : "—"}
            </p>
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              {health?.apiVersion ? `API ${health.apiVersion}` : "GET /v1/health"}
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-slate-900/40 p-4 backdrop-blur-sm">
            <p className="text-xs text-slate-500">Email (Resend)</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {integ?.email === true ? (
                <span className="text-emerald-400">Enabled</span>
              ) : integ?.email === false ? (
                <span className="text-amber-400/90">Not configured</span>
              ) : (
                "—"
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Lead delivery requires <code className="text-slate-400">RESEND_API_KEY</code> on the API host.
            </p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-slate-900/40 p-4 backdrop-blur-sm">
            <p className="text-xs text-slate-500">Cloudinary</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {integ?.cloudinary === true ? (
                <span className="text-emerald-400">Enabled</span>
              ) : integ?.cloudinary === false ? (
                <span className="text-slate-500">Off</span>
              ) : (
                "—"
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Required for media uploads & CMS images in tenant apps.
            </p>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium uppercase tracking-wider text-slate-500">
          Inventory
        </h3>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">Loading metrics…</p>
        ) : counts ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {statCards.map((c) => (
              <button
                key={c.label}
                type="button"
                onClick={() => onNavigate(c.tab)}
                className="group rounded-xl border border-white/[0.06] bg-slate-900/30 p-4 text-left transition hover:border-violet-500/30 hover:bg-slate-900/60"
              >
                <p className="text-xs font-medium text-slate-500">{c.label}</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-white">
                  {c.value}
                </p>
                <p className="mt-2 text-xs text-slate-500 group-hover:text-slate-400">
                  {c.hint} · <span className="text-violet-400/90">Open</span>
                </p>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">No data.</p>
        )}
      </div>

      <div className="rounded-2xl border border-white/[0.06] bg-slate-900/25 p-6">
        <h3 className="text-sm font-semibold text-white">Quick reference</h3>
        <ul className="mt-4 list-inside list-disc space-y-2 text-sm text-slate-400">
          <li>
            <strong className="text-slate-300">CORS</strong> must allow PATCH/DELETE for
            tenant staff admins (API registers GET, HEAD, POST, PUT, PATCH, DELETE,
            OPTIONS).
          </li>
          <li>
            <strong className="text-slate-300">Leads</strong>: org staff delete via{" "}
            <code className="rounded bg-slate-800 px-1 text-xs">DELETE /v1/leads/:id</code>
            ; super-admin can list/delete cross-tenant from the Leads tab.
          </li>
          <li>
            <strong className="text-slate-300">Tenant CMS</strong> (blog, hiring,
            portfolio) uses org JWT routes under{" "}
            <code className="rounded bg-slate-800 px-1 text-xs">/v1/admin/…</code> — not
            this console.
          </li>
        </ul>
      </div>
    </div>
  );
}

function LoginView({
  onLoggedIn,
  onError,
  banner,
  onDismissBanner,
  busy,
  setBusy,
}: {
  onLoggedIn: () => void;
  onError: (e: unknown) => void;
  banner: string | null;
  onDismissBanner: () => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await apiFetch<{
        access_token: string;
      }>("/v1/super-admin/auth/login", {
        method: "POST",
        json: { email, password },
      });
      setToken(res.access_token);
      setSuperAdminEmail(email.trim());
      onLoggedIn();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell flex min-h-screen flex-col items-center justify-center px-4 py-12">
      {banner && (
        <div
          className="mb-6 w-full max-w-md rounded-xl border border-rose-500/30 bg-rose-950/80 px-4 py-3 text-sm text-rose-50 backdrop-blur-sm"
          role="alert"
        >
          <div className="flex justify-between gap-2">
            <span>{banner}</span>
            <button
              type="button"
              className="shrink-0 rounded-md px-2 py-0.5 text-rose-200 hover:bg-rose-900/50"
              onClick={onDismissBanner}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.08] bg-slate-900/70 p-8 shadow-2xl shadow-black/50 backdrop-blur-md">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-violet-600/20 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 shadow-lg shadow-violet-500/30">
            <span className="text-xl font-bold text-white">E</span>
          </div>
          <h1 className="text-center text-xl font-semibold tracking-tight text-white">
            Super admin sign in
          </h1>
          <p className="mt-2 text-center text-sm text-slate-400">
            Credentials from the{" "}
            <code className="rounded bg-slate-800/80 px-1.5 py-0.5 text-slate-200">
              super_admins
            </code>{" "}
            table.
          </p>
          <form className="mt-8 space-y-4" onSubmit={submit}>
            <label className="block text-sm">
              <span className="text-slate-400">Email</span>
              <input
                className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-slate-950/80 px-3 py-2.5 text-slate-100 outline-none ring-violet-500/50 transition focus:ring-2"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Password</span>
              <input
                className="mt-1.5 w-full rounded-xl border border-white/[0.08] bg-slate-950/80 px-3 py-2.5 text-slate-100 outline-none ring-violet-500/50 transition focus:ring-2"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/25 transition hover:from-violet-500 hover:to-fuchsia-500 disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

type SuperAdminMe = {
  id: string;
  email: string;
  createdAt: string;
};

function AccountPanel({
  onError,
  onSuccessMsg,
}: {
  onError: (e: unknown) => void;
  onSuccessMsg: (s: string | null) => void;
}) {
  const [me, setMe] = useState<SuperAdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [emailNew, setEmailNew] = useState("");
  const [emailCurrentPwd, setEmailCurrentPwd] = useState("");
  const [pwdCurrent, setPwdCurrent] = useState("");
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<SuperAdminMe>("/v1/super-admin/me");
      setMe(res);
      setEmailNew(res.email);
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    if (emailNew.trim().toLowerCase() === me.email.toLowerCase()) {
      onSuccessMsg("Email is unchanged.");
      return;
    }
    setSavingEmail(true);
    try {
      const res = await apiFetch<
        SuperAdminMe & {
          access_token: string;
          token_type: string;
          expires_in: string | number;
        }
      >("/v1/super-admin/me/email", {
        method: "PATCH",
        json: {
          email: emailNew.trim(),
          currentPassword: emailCurrentPwd,
        },
      });
      setToken(res.access_token);
      setSuperAdminEmail(res.email);
      setMe({ id: res.id, email: res.email, createdAt: res.createdAt });
      setEmailCurrentPwd("");
      onSuccessMsg("Email updated. Your session token was refreshed.");
    } catch (e) {
      onError(e);
    } finally {
      setSavingEmail(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (pwdNew !== pwdConfirm) {
      onError(new Error("New passwords do not match."));
      return;
    }
    setSavingPwd(true);
    try {
      await apiFetch("/v1/super-admin/me/password", {
        method: "POST",
        json: { currentPassword: pwdCurrent, newPassword: pwdNew },
      });
      setPwdCurrent("");
      setPwdNew("");
      setPwdConfirm("");
      onSuccessMsg("Password updated.");
    } catch (e) {
      onError(e);
    } finally {
      setSavingPwd(false);
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h2 className="text-lg font-medium text-white">Account</h2>
        <p className="mt-1 text-sm text-slate-400">
          Change the platform super-admin email or password. Your current password
          is required for each change.
        </p>
      </div>
      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : me ? (
        <>
          <p className="text-sm text-slate-400">
            Signed in as{" "}
            <span className="font-medium text-slate-200">{me.email}</span>
            <span className="text-slate-600"> · </span>
            <span className="text-slate-500">
              account since {formatTs(me.createdAt)}
            </span>
          </p>

          <form
            className="max-w-lg space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6"
            onSubmit={(e) => void submitEmail(e)}
          >
            <h3 className="text-sm font-medium text-slate-200">Change email</h3>
            <label className="block text-sm">
              <span className="text-slate-400">New email</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-violet-500 focus:ring-2"
                type="email"
                autoComplete="email"
                value={emailNew}
                onChange={(e) => setEmailNew(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Current password</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-violet-500 focus:ring-2"
                type="password"
                autoComplete="current-password"
                value={emailCurrentPwd}
                onChange={(e) => setEmailCurrentPwd(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              disabled={savingEmail}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {savingEmail ? "Saving…" : "Update email"}
            </button>
          </form>

          <form
            className="max-w-lg space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6"
            onSubmit={(e) => void submitPassword(e)}
          >
            <h3 className="text-sm font-medium text-slate-200">
              Change password
            </h3>
            <label className="block text-sm">
              <span className="text-slate-400">Current password</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-violet-500 focus:ring-2"
                type="password"
                autoComplete="current-password"
                value={pwdCurrent}
                onChange={(e) => setPwdCurrent(e.target.value)}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">New password (min 8 characters)</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-violet-500 focus:ring-2"
                type="password"
                autoComplete="new-password"
                value={pwdNew}
                onChange={(e) => setPwdNew(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-400">Confirm new password</span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-violet-500 focus:ring-2"
                type="password"
                autoComplete="new-password"
                value={pwdConfirm}
                onChange={(e) => setPwdConfirm(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <button
              type="submit"
              disabled={savingPwd}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            >
              {savingPwd ? "Saving…" : "Update password"}
            </button>
          </form>
        </>
      ) : (
        <p className="text-slate-500">Could not load profile.</p>
      )}
    </div>
  );
}

function OrgsPanel({
  onError,
  onSuccessMsg,
}: {
  onError: (e: unknown) => void;
  onSuccessMsg: (s: string | null) => void;
}) {
  const [items, setItems] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<Organization | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ items: Organization[] }>(
        "/v1/super-admin/organizations",
      );
      setItems(res.items);
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-white">Organizations</h2>
        <button
          type="button"
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
          onClick={() => setCreateOpen(true)}
        >
          New organization
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : (
              items.map((o) => (
                <tr key={o.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-slate-200">{o.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-400">
                    {o.slug}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatTs(o.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-violet-400 hover:underline"
                      onClick={() => setEdit(o)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {createOpen && (
        <OrgModal
          title="Create organization"
          initial={null}
          onClose={() => setCreateOpen(false)}
          onSave={async (body) => {
            await apiFetch("/v1/super-admin/organizations", {
              method: "POST",
              json: body,
            });
            onSuccessMsg("Organization created.");
            setCreateOpen(false);
            await load();
          }}
          onError={onError}
        />
      )}
      {edit && (
        <OrgModal
          title="Edit organization"
          initial={edit}
          onClose={() => setEdit(null)}
          onSave={async (body) => {
            await apiFetch(`/v1/super-admin/organizations/${edit.id}`, {
              method: "PATCH",
              json: body,
            });
            onSuccessMsg("Organization updated.");
            setEdit(null);
            await load();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function OrgModal({
  title,
  initial,
  onClose,
  onSave,
  onError,
}: {
  title: string;
  initial: Organization | null;
  onClose: () => void;
  onSave: (body: { name: string; slug: string }) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-medium text-white">{title}</h3>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-400">Name</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Slug</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              try {
                await onSave({ name, slug });
              } catch (e) {
                onError(e);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SitesPanel({
  onError,
  onSuccessMsg,
}: {
  onError: (e: unknown) => void;
  onSuccessMsg: (s: string | null) => void;
}) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgFilter, setOrgFilter] = useState<string>("");
  const [items, setItems] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [keyModal, setKeyModal] = useState<string | null>(null);
  const [rotatePending, setRotatePending] = useState<SiteRow | null>(null);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: Organization[] }>(
        "/v1/super-admin/organizations",
      );
      setOrgs(res.items);
    } catch (e) {
      onError(e);
    }
  }, [onError]);

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const q = orgFilter
        ? `?organizationId=${encodeURIComponent(orgFilter)}`
        : "";
      const res = await apiFetch<{ items: SiteRow[] }>(
        `/v1/super-admin/sites${q}`,
      );
      setItems(res.items);
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [onError, orgFilter]);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-white">Sites</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
          >
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
            onClick={() => setCreateOpen(true)}
          >
            New site
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Label</th>
              <th className="px-4 py-3 font-medium">Organization</th>
              <th className="px-4 py-3 font-medium">Active</th>
              <th className="px-4 py-3 font-medium">Key preview</th>
              <th className="px-4 py-3 font-medium">Last rotated</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : (
              items.map((s) => (
                <tr key={s.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-slate-200">{s.label}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {s.organizationName}{" "}
                    <span className="font-mono text-xs text-slate-500">
                      ({s.organizationSlug})
                    </span>
                  </td>
                  <td className="px-4 py-3">{s.isActive ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">
                    {s.keyPreview}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {formatTs(s.rotatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-violet-400 hover:underline"
                      onClick={() => setRotatePending(s)}
                    >
                      Rotate key
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {createOpen && (
        <SiteCreateModal
          orgs={orgs}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await loadSites();
          }}
          onError={onError}
          onKey={(k) => setKeyModal(k)}
        />
      )}
      {keyModal && (
        <PlaintextKeyModal value={keyModal} onClose={() => setKeyModal(null)} />
      )}
      {rotatePending && (
        <ReauthModal
          title="Rotate site key"
          description="Enter your super-admin password to issue a new publishable key for this site."
          onClose={() => setRotatePending(null)}
          onError={onError}
          onAfterReauth={async () => {
            const res = await apiFetch<{ plaintextKey: string }>(
              `/v1/super-admin/sites/${rotatePending.id}/rotate-key`,
              { method: "POST" },
            );
            setKeyModal(res.plaintextKey);
            onSuccessMsg("Key rotated — copy the new key from the dialog.");
            await loadSites();
          }}
        />
      )}
    </div>
  );
}

function PlaintextKeyModal({
  value,
  onClose,
}: {
  value: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-amber-500/40 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-medium text-amber-100">Site key (copy now)</h3>
        <p className="mt-2 text-sm text-slate-400">
          This value is shown once. Store it as{" "}
          <code className="text-slate-300">PUBLIC_SITE_KEY</code> or similar.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 p-3 text-xs text-violet-300">
          {value}
        </pre>
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SiteCreateModal({
  orgs,
  onClose,
  onCreated,
  onError,
  onKey,
}: {
  orgs: Organization[];
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (e: unknown) => void;
  onKey: (k: string) => void;
}) {
  const [organizationId, setOrganizationId] = useState(orgs[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-medium text-white">New site</h3>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-400">Organization</span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Label</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || !label.trim()}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              try {
                const res = await apiFetch<{
                  plaintextKey: string;
                }>("/v1/super-admin/sites", {
                  method: "POST",
                  json: {
                    organizationId,
                    label: label.trim(),
                    allowedOrigins: null,
                  },
                });
                onKey(res.plaintextKey);
                await onCreated();
              } catch (e) {
                onError(e);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersPanel({
  onError,
  onSuccessMsg,
}: {
  onError: (e: unknown) => void;
  onSuccessMsg: (s: string | null) => void;
}) {
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [orgFilter, setOrgFilter] = useState("");
  const [items, setItems] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState<UserRow | null>(null);

  const loadOrgs = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: Organization[] }>(
        "/v1/super-admin/organizations",
      );
      setOrgs(res.items);
    } catch (e) {
      onError(e);
    }
  }, [onError]);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const q = orgFilter
        ? `?organizationId=${encodeURIComponent(orgFilter)}`
        : "";
      const res = await apiFetch<{ items: UserRow[] }>(
        `/v1/super-admin/users${q}`,
      );
      setItems(res.items);
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [onError, orgFilter]);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-white">Org users</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
          >
            <option value="">All organizations</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500"
            onClick={() => setCreateOpen(true)}
          >
            New user
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Organization</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : (
              items.map((u) => (
                <tr key={u.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-slate-200">{u.email}</td>
                  <td className="px-4 py-3 text-slate-400">{u.role}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {u.organizationName}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="text-violet-400 hover:underline"
                      onClick={() => setPwdUser(u)}
                    >
                      Set password
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {createOpen && (
        <UserCreateModal
          orgs={orgs}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => {
            setCreateOpen(false);
            await loadUsers();
            onSuccessMsg("User created.");
          }}
          onError={onError}
        />
      )}
      {pwdUser && (
        <PasswordModal
          email={pwdUser.email}
          onClose={() => setPwdUser(null)}
          onSave={async (password) => {
            await apiFetch(`/v1/super-admin/users/${pwdUser.id}/password`, {
              method: "POST",
              json: { password },
            });
            onSuccessMsg("Password updated.");
            setPwdUser(null);
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function UserCreateModal({
  orgs,
  onClose,
  onCreated,
  onError,
}: {
  orgs: Organization[];
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [organizationId, setOrganizationId] = useState(orgs[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"org_admin" | "org_viewer">("org_viewer");
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-medium text-white">New org user</h3>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-400">Organization</span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Email</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Password (min 8)</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">Role</span>
            <select
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              value={role}
              onChange={(e) =>
                setRole(e.target.value as "org_admin" | "org_viewer")
              }
            >
              <option value="org_admin">org_admin</option>
              <option value="org_viewer">org_viewer</option>
            </select>
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || password.length < 8}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              try {
                await apiFetch("/v1/super-admin/users", {
                  method: "POST",
                  json: {
                    organizationId,
                    email,
                    password,
                    role,
                  },
                });
                await onCreated();
              } catch (e) {
                onError(e);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PasswordModal({
  email,
  onClose,
  onSave,
  onError,
}: {
  email: string;
  onClose: () => void;
  onSave: (password: string) => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <h3 className="text-lg font-medium text-white">Set password</h3>
        <p className="mt-1 text-sm text-slate-400">{email}</p>
        <label className="mt-4 block text-sm">
          <span className="text-slate-400">New password</span>
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving || password.length < 8}
            className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white hover:bg-violet-500 disabled:opacity-50"
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(password);
              } catch (e) {
                onError(e);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Update"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MediaPanel({ onError }: { onError: (e: unknown) => void }) {
  const [items, setItems] = useState<MediaAssetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resourceType, setResourceType] = useState<"" | "image" | "video">("");
  const [qInput, setQInput] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 24;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (qApplied.trim()) params.set("q", qApplied.trim());
      if (resourceType) params.set("resourceType", resourceType);
      const res = await apiFetch<{ items: MediaAssetRow[]; total: number }>(
        `/v1/super-admin/media-assets?${params.toString()}`,
      );
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [offset, onError, qApplied, resourceType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-lg font-medium text-white">Media library</h2>
        <div className="flex flex-1 flex-wrap gap-2">
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            value={resourceType}
            onChange={(e) => {
              setResourceType(e.target.value as "" | "image" | "video");
              setOffset(0);
            }}
          >
            <option value="">All types</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </select>
          <input
            className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            placeholder="Search public id, org, uploader, purpose..."
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setOffset(0);
                setQApplied(qInput);
              }
            }}
          />
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
            onClick={() => {
              setOffset(0);
              setQApplied(qInput);
            }}
          >
            Search
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        Showing {items.length} of {total} assets (offset {offset})
      </p>
      {loading ? (
        <div className="rounded-xl border border-slate-800 px-4 py-10 text-center text-slate-500">
          Loading media…
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((m) => (
            <article
              key={m.id}
              className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/40"
            >
              <div className="aspect-video w-full bg-slate-950">
                {m.cloudinaryResourceType === "image" ? (
                  <img
                    src={m.secureUrl}
                    alt={m.title ?? m.cloudinaryPublicId}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <video
                    src={m.secureUrl}
                    controls
                    preload="metadata"
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="space-y-2 px-3 py-3 text-xs">
                <p className="font-mono text-slate-300">{m.cloudinaryPublicId}</p>
                <p className="text-slate-400">
                  {m.organizationName} ({m.organizationSlug})
                </p>
                <p className="text-slate-500">Uploaded by: {m.uploaderEmail}</p>
                <p className="text-slate-500">Created: {formatTs(m.createdAt)}</p>
                <p className="text-slate-500">
                  {m.format ? `${m.format.toUpperCase()} ` : ""}
                  {m.width && m.height ? `${m.width}x${m.height}` : ""}
                  {m.durationSeconds ? ` • ${m.durationSeconds}s` : ""}
                </p>
                {m.tags?.length ? (
                  <p className="line-clamp-2 text-slate-500">
                    Tags: {m.tags.join(", ")}
                  </p>
                ) : null}
                <a
                  href={m.secureUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-violet-400 hover:underline"
                >
                  Open original
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={offset === 0}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={offset + limit >= total}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => setOffset((o) => o + limit)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function LeadsPanel({ onError }: { onError: (e: unknown) => void }) {
  const [qInput, setQInput] = useState("");
  const [qApplied, setQApplied] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const [items, setItems] = useState<LeadRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [deletePending, setDeletePending] = useState<LeadRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (qApplied.trim()) params.set("q", qApplied.trim());
      const res = await apiFetch<{
        items: LeadRow[];
        total: number;
      }>(`/v1/super-admin/leads?${params.toString()}`);
      setItems(res.items);
      setTotal(res.total);
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [onError, offset, qApplied]);

  useEffect(() => {
    void load();
  }, [load]);

  function applySearch() {
    setOffset(0);
    setQApplied(qInput);
  }

  async function openDetail(id: string) {
    setDetailId(id);
    try {
      const row = await apiFetch<Record<string, unknown>>(
        `/v1/super-admin/leads/${id}`,
      );
      setDetail(row);
    } catch (e) {
      onError(e);
      setDetailId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="text-lg font-medium text-white">Leads</h2>
        <div className="flex flex-1 flex-wrap gap-2">
          <input
            className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
            placeholder="Search email, name, message…"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") applySearch();
            }}
          />
          <button
            type="button"
            className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700"
            onClick={() => applySearch()}
          >
            Search
          </button>
        </div>
      </div>
      <p className="text-sm text-slate-500">
        Showing {items.length} of {total} (offset {offset})
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="min-w-full divide-y divide-slate-800 text-left text-sm">
          <thead className="bg-slate-900/80 text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Submitted</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Org / Site</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            ) : (
              items.map((l) => (
                <tr key={l.id} className="hover:bg-slate-900/50">
                  <td className="px-4 py-3 text-slate-500">
                    {formatTs(l.submittedAt)}
                  </td>
                  <td className="px-4 py-3 text-slate-200">{l.fullName}</td>
                  <td className="px-4 py-3 text-slate-300">{l.email}</td>
                  <td className="px-4 py-3 text-slate-400">
                    {l.organizationName}
                    <span className="text-slate-600"> / {l.siteLabel}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      className="mr-3 text-violet-400 hover:underline"
                      onClick={() => void openDetail(l.id)}
                    >
                      View
                    </button>
                    <button
                      type="button"
                      className="text-rose-400 hover:underline"
                      onClick={() => {
                        if (
                          !confirm(
                            "Delete this lead permanently? You will be asked for your password next.",
                          )
                        ) {
                          return;
                        }
                        setDeletePending(l);
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={offset === 0}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
        >
          Previous
        </button>
        <button
          type="button"
          disabled={offset + limit >= total}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm disabled:opacity-40"
          onClick={() => setOffset((o) => o + limit)}
        >
          Next
        </button>
      </div>
      {detailId && detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <h3 className="text-lg font-medium text-white">Lead detail</h3>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-300">
              {JSON.stringify(detail, null, 2)}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg bg-slate-800 px-4 py-2 text-sm"
                onClick={() => {
                  setDetailId(null);
                  setDetail(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {deletePending && (
        <ReauthModal
          title="Delete lead"
          description="Enter your super-admin password to permanently delete this lead."
          onClose={() => setDeletePending(null)}
          onError={onError}
          onAfterReauth={async () => {
            await apiFetch(`/v1/super-admin/leads/${deletePending.id}`, {
              method: "DELETE",
            });
            await load();
          }}
        />
      )}
    </div>
  );
}
