import { useCallback, useEffect, useState } from "react";
import {
  apiFetch,
  clearSuperAdminSession,
  getSuperAdminEmail,
  getToken,
  SESSION_LOST_EVENT,
  setSuperAdminEmail,
  setToken,
} from "./api";

const IDLE_SIGN_OUT_MS = 30 * 60 * 1000;

type Tab = "orgs" | "sites" | "users" | "leads" | "media";

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
  const [tab, setTab] = useState<Tab>("orgs");
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
    <div className="min-h-screen">
      {banner && (
        <div
          className="border-b border-amber-500/40 bg-amber-950/80 px-4 py-3 text-amber-100"
          role="alert"
        >
          <div className="mx-auto flex max-w-6xl items-start justify-between gap-4">
            <p className="text-sm">{banner}</p>
            <button
              type="button"
              className="shrink-0 text-amber-300 underline"
              onClick={clearBanner}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-white">
              Elevate super admin
            </h1>
            <p className="text-xs text-slate-400">
              Cross-tenant operations — keep this deployment private.
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
            onClick={() => {
              clearSuperAdminSession(false);
              setLoggedIn(false);
            }}
          >
            Sign out
          </button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 px-4 pb-3">
          {(
            [
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
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tab === id
                  ? "bg-violet-600 text-white"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
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
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      {banner && (
        <div
          className="mb-6 w-full max-w-md rounded-lg border border-rose-500/40 bg-rose-950/60 px-4 py-3 text-sm text-rose-100"
          role="alert"
        >
          <div className="flex justify-between gap-2">
            <span>{banner}</span>
            <button
              type="button"
              className="shrink-0 underline"
              onClick={onDismissBanner}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-black/40">
        <h1 className="text-center text-xl font-semibold text-white">
          Super admin sign in
        </h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Uses credentials from the <code className="text-slate-300">super_admins</code>{" "}
          table.
        </p>
        <form className="mt-8 space-y-4" onSubmit={submit}>
          <label className="block text-sm">
            <span className="text-slate-400">Email</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-violet-500 focus:ring-2"
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
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none ring-violet-500 focus:ring-2"
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
            className="w-full rounded-lg bg-violet-600 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
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
