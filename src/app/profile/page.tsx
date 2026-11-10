"use client";
import VesselSelect from "@/app/components/VesselSelect";

import { useEffect, useState } from "react";
import { AtSign, Check, Copy, KeyRound, LogOut, Mail, Plus, ShieldCheck, Trash2, UserRound, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ToastNotice, type Notice } from "@/app/components/ToastNotice";
import { UserAvatar } from "@/app/components/UserAvatar";

type Account = { username: string; role: string; email: string | null; avatarUrl: string | null };
type ApiToken = { id: string; name: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null };

export default function ProfilePage() {
  const { language } = useI18n();
  const es = language === "es";
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState("");
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [tokenName, setTokenName] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [issuedToken, setIssuedToken] = useState("");
  const [revokeToken, setRevokeToken] = useState<ApiToken | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  async function loadTokens() {
    const response = await fetch("/api/tokens", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? (es ? "No se pudieron cargar los tokens." : "Could not load API tokens."));
    setTokens(data.data ?? []);
  }

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" }).then((response) => response.json()).then((data) => { setAccount(data.user ?? null); setEmail(data.user?.email ?? ""); }).catch(() => setAccount(null));
    void loadTokens().catch((error) => setNotice({ kind: "error", title: error instanceof Error ? error.message : (es ? "No se pudieron cargar los tokens." : "Could not load API tokens.") }));
  }, []);

  async function saveEmail() {
    setSaving(true);
    try {
      const response = await fetch("/api/auth", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? (es ? "No se pudo guardar el correo." : "Could not save email."));
      setAccount(data.user);
      setEmail(data.user.email ?? "");
      window.dispatchEvent(new Event("vessel-user-updated"));
      setNotice({ kind: "success", title: es ? "Perfil actualizado" : "Profile updated" });
    } catch (error) {
      setNotice({ kind: "error", title: error instanceof Error ? error.message : (es ? "No se pudo guardar el correo." : "Could not save email.") });
    } finally { setSaving(false); }
  }

  async function createToken(event: React.FormEvent) {
    event.preventDefault();
    setTokenBusy(true);
    try {
      const response = await fetch("/api/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: tokenName, expiresInDays: expiresInDays === "never" ? null : Number(expiresInDays) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? (es ? "No se pudo crear el token." : "Could not create token."));
      setTokens((current) => [data.data.record, ...current]);
      setIssuedToken(data.data.token);
      setTokenName("");
      setNotice({ kind: "success", title: es ? "Token API creado" : "API token created", detail: es ? "Cópialo ahora; no volverá a mostrarse." : "Copy it now; it will not be shown again." });
    } catch (error) {
      setNotice({ kind: "error", title: error instanceof Error ? error.message : (es ? "No se pudo crear el token." : "Could not create token.") });
    } finally { setTokenBusy(false); }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(issuedToken);
      setNotice({ kind: "success", title: es ? "Token copiado" : "Token copied" });
    } catch { setNotice({ kind: "error", title: es ? "No se pudo copiar el token." : "Could not copy token." }); }
  }

  async function confirmRevoke() {
    if (!revokeToken) return;
    setTokenBusy(true);
    try {
      const response = await fetch("/api/tokens", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: revokeToken.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? (es ? "No se pudo revocar el token." : "Could not revoke token."));
      setTokens((current) => current.filter((token) => token.id !== revokeToken.id));
      setRevokeToken(null);
      setNotice({ kind: "success", title: es ? "Token revocado" : "Token revoked" });
    } catch (error) {
      setNotice({ kind: "error", title: error instanceof Error ? error.message : (es ? "No se pudo revocar el token." : "Could not revoke token.") });
    } finally { setTokenBusy(false); }
  }

  async function logout() {
    setBusy(true);
    window.location.assign("/api/auth/logout");
  }

  const date = (value: string | null) => value ? new Intl.DateTimeFormat(es ? "es-VE" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : (es ? "Sin vencimiento" : "Never expires");

  return <main className="module-main profile-page"><ToastNotice notice={notice} onClose={() => setNotice(null)} /><header className="module-header"><div><span className="overview-eyebrow">VESSEL / {es ? "CUENTA" : "ACCOUNT"}</span><h1>{es ? "Mi perfil" : "My profile"}</h1><p>{es ? "Tu identidad y acceso al plano de control." : "Your identity and access to the control plane."}</p></div></header><section className="profile-card"><UserAvatar className="profile-avatar" username={account?.username ?? "?"} avatarUrl={account?.avatarUrl} /><div className="profile-identity"><strong>{account?.username ?? (es ? "Cargando…" : "Loading…")}</strong><span><ShieldCheck size={15} />{account?.role ?? "—"}</span></div></section>
    <section className="profile-detail-card"><h2><UserRound size={19} />{es ? "Datos de la cuenta" : "Account details"}</h2><dl><div><dt>{es ? "Usuario" : "Username"}</dt><dd>{account?.username ?? "—"}</dd></div><div><dt>{es ? "Rol" : "Role"}</dt><dd>{account?.role ?? "—"}</dd></div></dl><label className="profile-email-field"><span><Mail size={15} />{es ? "Correo electrónico (opcional)" : "Email address (optional)"}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" /><small><AtSign size={13} />{es ? "Se usará para buscar tu avatar en Gravatar." : "Used to look up your Gravatar avatar."}</small></label><div className="profile-actions"><button type="button" onClick={saveEmail} disabled={saving || email.trim() === (account?.email ?? "")}><Check size={16} />{saving ? (es ? "Guardando…" : "Saving…") : (es ? "Guardar perfil" : "Save profile")}</button><button type="button" onClick={logout} disabled={busy}><LogOut size={16} />{es ? "Cerrar sesión" : "Sign out"}</button></div></section>
    <section className="profile-detail-card profile-api-tokens"><div className="profile-api-heading"><div><h2><KeyRound size={19} />{es ? "Tokens API" : "API tokens"}</h2><p>{es ? "Crea credenciales para integraciones. Cada token hereda el rol y los permisos de tu cuenta." : "Create credentials for integrations. Each token inherits your account role and permissions."}</p></div></div>
      <form className="profile-token-form" onSubmit={(event) => void createToken(event)}><label><span>{es ? "Nombre" : "Name"}</span><input required maxLength={80} value={tokenName} onChange={(event) => setTokenName(event.target.value)} placeholder={es ? "Por ejemplo, automatización CI" : "e.g. CI automation"} /></label><label><span>{es ? "Expiración" : "Expiration"}</span><VesselSelect value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}><option value="30">{es ? "30 días" : "30 days"}</option><option value="90">{es ? "90 días" : "90 days"}</option><option value="365">{es ? "1 año" : "1 year"}</option><option value="never">{es ? "Sin vencimiento" : "Never"}</option></VesselSelect></label><button type="submit" disabled={tokenBusy || !tokenName.trim()}><Plus size={15} />{tokenBusy ? (es ? "Creando…" : "Creating…") : (es ? "Crear token" : "Create token")}</button></form>
      <div className="profile-token-note"><ShieldCheck size={15} />{es ? "El secreto completo aparece una sola vez. Guárdalo en un almacén seguro; no lo incluyas en código ni logs." : "The full secret is shown only once. Store it securely; do not put it in code or logs."}</div>
      {issuedToken ? <div className="profile-issued-token"><div><strong>{es ? "Copia este token ahora" : "Copy this token now"}</strong><button type="button" onClick={() => setIssuedToken("")} aria-label={es ? "Ocultar token" : "Hide token"}><X size={15} /></button></div><code>{issuedToken}</code><button type="button" onClick={() => void copyToken()}><Copy size={14} />{es ? "Copiar token" : "Copy token"}</button></div> : null}
      <div className="profile-token-list">{tokens.length ? tokens.map((token) => <article key={token.id}><div className="profile-token-icon"><KeyRound size={16} /></div><div className="profile-token-meta"><strong>{token.name}</strong><span>{es ? "Creado" : "Created"}: {date(token.createdAt)} · {date(token.expiresAt)}</span><small>{token.lastUsedAt ? `${es ? "Último uso" : "Last used"}: ${date(token.lastUsedAt)}` : (es ? "Aún no utilizado" : "Not used yet")}</small></div><button type="button" className="profile-token-revoke" onClick={() => setRevokeToken(token)} aria-label={`${es ? "Revocar" : "Revoke"} ${token.name}`} title={es ? "Revocar token" : "Revoke token"}><Trash2 size={15} /></button></article>) : <div className="profile-token-empty"><KeyRound size={18} />{es ? "Todavía no tienes tokens API." : "You do not have any API tokens yet."}</div>}</div>
    </section>
    {revokeToken ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !tokenBusy) setRevokeToken(null); }}><section className="confirm-modal scheduled-delete-modal" role="alertdialog" aria-modal="true"><span className="module-kicker"><Trash2 size={14} />{es ? "REVOCAR TOKEN" : "REVOKE TOKEN"}</span><h2>{revokeToken.name}</h2><p>{es ? "Las aplicaciones que usan este token perderán acceso inmediatamente." : "Applications using this token will lose access immediately."}</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setRevokeToken(null)} disabled={tokenBusy}>{es ? "Cancelar" : "Cancel"}</button><button type="button" className="danger-button" onClick={() => void confirmRevoke()} disabled={tokenBusy}><Trash2 size={15} />{es ? "Revocar" : "Revoke"}</button></div></section></div> : null}
    </main>;
}
