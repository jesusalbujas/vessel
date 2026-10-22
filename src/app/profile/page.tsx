"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign, Check, LogOut, Mail, ShieldCheck, UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ToastNotice, type Notice } from "@/app/components/ToastNotice";
import { UserAvatar } from "@/app/components/UserAvatar";

type Account = { username: string; role: string; email: string | null; avatarUrl: string | null };

export default function ProfilePage() {
  const router = useRouter();
  const { language } = useI18n();
  const es = language === "es";
  const [account, setAccount] = useState<Account | null>(null);
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" }).then((response) => response.json()).then((data) => { setAccount(data.user ?? null); setEmail(data.user?.email ?? ""); }).catch(() => setAccount(null));
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
  async function logout() {
    setBusy(true);
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    window.localStorage.removeItem("vessel-token");
    router.replace("/login");
  }
  return <main className="module-main profile-page"><ToastNotice notice={notice} onClose={() => setNotice(null)} /><header className="module-header"><div><span className="overview-eyebrow">VESSEL / {es ? "CUENTA" : "ACCOUNT"}</span><h1>{es ? "Mi perfil" : "My profile"}</h1><p>{es ? "Tu identidad y acceso al plano de control." : "Your identity and access to the control plane."}</p></div></header><section className="profile-card"><UserAvatar className="profile-avatar" username={account?.username ?? "?"} avatarUrl={account?.avatarUrl} /><div className="profile-identity"><strong>{account?.username ?? (es ? "Cargando…" : "Loading…")}</strong><span><ShieldCheck size={15} />{account?.role ?? "—"}</span></div></section><section className="profile-detail-card"><h2><UserRound size={19} />{es ? "Datos de la cuenta" : "Account details"}</h2><dl><div><dt>{es ? "Usuario" : "Username"}</dt><dd>{account?.username ?? "—"}</dd></div><div><dt>{es ? "Rol" : "Role"}</dt><dd>{account?.role ?? "—"}</dd></div></dl><label className="profile-email-field"><span><Mail size={15} />{es ? "Correo electrónico (opcional)" : "Email address (optional)"}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" autoComplete="email" /><small><AtSign size={13} />{es ? "Se usará para buscar tu avatar en Gravatar." : "Used to look up your Gravatar avatar."}</small></label><div className="profile-actions"><button type="button" onClick={saveEmail} disabled={saving || email.trim() === (account?.email ?? "")}><Check size={16} />{saving ? (es ? "Guardando…" : "Saving…") : (es ? "Guardar perfil" : "Save profile")}</button><button type="button" onClick={logout} disabled={busy}><LogOut size={16} />{es ? "Cerrar sesión" : "Sign out"}</button></div></section></main>;
}
