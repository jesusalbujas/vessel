"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Account = { username: string; role: string };

export default function ProfilePage() {
  const router = useRouter();
  const { language } = useI18n();
  const es = language === "es";
  const [account, setAccount] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" }).then((response) => response.json()).then((data) => setAccount(data.user ?? null)).catch(() => setAccount(null));
  }, []);
  async function logout() {
    setBusy(true);
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    window.localStorage.removeItem("vessel-token");
    router.replace("/login");
  }
  return <main className="module-main profile-page"><header className="module-header"><div><span className="overview-eyebrow">VESSEL / {es ? "CUENTA" : "ACCOUNT"}</span><h1>{es ? "Mi perfil" : "My profile"}</h1><p>{es ? "Tu identidad y acceso al plano de control." : "Your identity and access to the control plane."}</p></div></header><section className="profile-card"><div className="profile-avatar">{account?.username.slice(0, 1).toUpperCase() ?? <UserRound size={25} />}</div><div className="profile-identity"><strong>{account?.username ?? (es ? "Cargando…" : "Loading…")}</strong><span><ShieldCheck size={15} />{account?.role ?? "—"}</span></div></section><section className="profile-detail-card"><h2><UserRound size={19} />{es ? "Datos de la cuenta" : "Account details"}</h2><dl><div><dt>{es ? "Usuario" : "Username"}</dt><dd>{account?.username ?? "—"}</dd></div><div><dt>{es ? "Rol" : "Role"}</dt><dd>{account?.role ?? "—"}</dd></div></dl><button type="button" onClick={logout} disabled={busy}><LogOut size={16} />{es ? "Cerrar sesión" : "Sign out"}</button></section></main>;
}
