"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Clock3, Globe2, Laptop, RefreshCw, ShieldCheck, X } from "lucide-react";
import { ToastNotice, type Notice } from "@/app/components/ToastNotice";
import { useI18n } from "@/lib/i18n";
import "../globals.css";

type Session = {
  id: string;
  userId: string;
  username: string;
  email: string | null;
  clientIp: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  status: "active" | "expired";
  isCurrent: number;
};

type SessionFilter = "all" | "active" | "expired";

function clientName(userAgent: string | null, language: string) {
  if (!userAgent) return language === "es" ? "Desconocido" : "Unknown";
  const browser = /Edg\//.test(userAgent) ? "Microsoft Edge" : /OPR\//.test(userAgent) ? "Opera" : /Firefox\//.test(userAgent) ? "Firefox" : /Chrome\//.test(userAgent) ? "Chrome" : /Safari\//.test(userAgent) ? "Safari" : (language === "es" ? "Navegador" : "Browser");
  const platform = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "";
  return platform ? `${browser} · ${platform}` : browser;
}

function formatDate(value: string, language: string) {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(language === "es" ? "es-VE" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function SessionsPage() {
  const { language } = useI18n();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<SessionFilter>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [accessError, setAccessError] = useState<"unauthorized" | "forbidden" | null>(null);
  const [confirmSession, setConfirmSession] = useState<Session | null>(null);
  const [revoking, setRevoking] = useState(false);

  const copy = language === "es" ? {
    title: "Sesiones", subtitle: "Consulta los accesos recientes y revoca sesiones que ya no deban tener acceso a Vessel.",
    badge: "Seguridad de cuenta", refresh: "Actualizar", all: "Todas", active: "Activas", expired: "Vencidas",
    search: "Buscar usuario, dirección IP o navegador…", user: "Usuario", device: "Dispositivo", ip: "Dirección IP", status: "Estado", created: "Inicio", expires: "Vencimiento", actions: "Acciones",
    current: "Esta sesión", activeState: "Activa", expiredState: "Vencida", revoke: "Revocar", remove: "Quitar registro", empty: "No hay sesiones que coincidan con estos filtros.", loading: "Cargando sesiones…",
    unauthorized: "Inicia sesión para consultar las sesiones.", forbidden: "Se requiere acceso de administrador para gestionar sesiones.", loadError: "No se pudieron cargar las sesiones.",
    confirmTitle: "Revocar sesión", confirmActive: "Esta sesión perderá acceso a Vessel inmediatamente.", confirmExpired: "Se eliminará el registro de esta sesión vencida.", cancel: "Cancelar", confirm: "Confirmar revocación", deleting: "Revocando…", removing: "Eliminando…", revoked: "Sesión revocada", removed: "Registro de sesión eliminado", failure: "No se pudo revocar la sesión.", count: (n: number) => `${n} sesión(es)`,
  } : {
    title: "Sessions", subtitle: "Review recent access and revoke sessions that should no longer have access to Vessel.",
    badge: "Account security", refresh: "Refresh", all: "All", active: "Active", expired: "Expired",
    search: "Search user, IP address, or browser…", user: "User", device: "Device", ip: "IP address", status: "Status", created: "Created", expires: "Expires", actions: "Actions",
    current: "This session", activeState: "Active", expiredState: "Expired", revoke: "Revoke", remove: "Remove record", empty: "No sessions match these filters.", loading: "Loading sessions…",
    unauthorized: "Sign in to view sessions.", forbidden: "Administrator access is required to manage sessions.", loadError: "Could not load sessions.",
    confirmTitle: "Revoke session", confirmActive: "This session will immediately lose access to Vessel.", confirmExpired: "This expired session record will be removed.", cancel: "Cancel", confirm: "Confirm revocation", deleting: "Revoking…", removing: "Removing…", revoked: "Session revoked", removed: "Session record removed", failure: "Could not revoke the session.", count: (n: number) => `${n} session(s)`,
  };

  const loadSessions = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      const data = await response.json();
      if (response.status === 401) { setAccessError("unauthorized"); setSessions([]); return; }
      if (response.status === 403) { setAccessError("forbidden"); setSessions([]); return; }
      if (!response.ok) throw new Error(data.error ?? copy.loadError);
      setAccessError(null);
      setSessions(Array.isArray(data.data) ? data.data : []);
    } catch (error) {
      if (!quiet) setNotice({ kind: "error", title: error instanceof Error ? error.message : copy.loadError });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    void loadSessions();
    const timer = window.setInterval(() => void loadSessions(true), 30_000);
    return () => window.clearInterval(timer);
  }, [loadSessions]);

  const filteredSessions = useMemo(() => sessions.filter((session) => {
    if (filter !== "all" && session.status !== filter) return false;
    const needle = query.trim().toLocaleLowerCase();
    return !needle || [session.username, session.email, session.clientIp, clientName(session.userAgent, language)].some((value) => value?.toLocaleLowerCase().includes(needle));
  }), [sessions, filter, query, language]);

  async function revoke() {
    if (!confirmSession) return;
    setRevoking(true);
    try {
      const response = await fetch(`/api/sessions?id=${encodeURIComponent(confirmSession.id)}`, { method: "DELETE", cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? copy.failure);
      const wasCurrent = Boolean(data.current);
      setSessions((current) => current.filter((session) => session.id !== confirmSession.id));
      setNotice({ kind: "success", title: confirmSession.status === "active" ? copy.revoked : copy.removed, detail: confirmSession.username });
      setConfirmSession(null);
      if (wasCurrent) window.setTimeout(() => window.location.assign("/login"), 900);
    } catch (error) {
      setNotice({ kind: "error", title: error instanceof Error ? error.message : copy.failure });
    } finally {
      setRevoking(false);
    }
  }

  return <main className="module-main sessions-page">
    <ToastNotice notice={notice} onClose={() => setNotice(null)} />
    <header className="module-header">
      <div><span className="module-kicker">VESSEL / SECURITY</span><h1>{copy.title}</h1><p>{copy.subtitle}</p></div>
      <div className="sessions-header-actions"><span className="module-header-badge"><ShieldCheck size={15} />{copy.badge}</span><button type="button" onClick={() => void loadSessions(true)} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "sessions-spin" : ""} />{copy.refresh}</button></div>
    </header>
    <section className="module-panel sessions-panel">
      <div className="sessions-summary"><div className="sessions-summary-icon"><Activity size={19} /></div><div><strong>{copy.count(sessions.length)}</strong><span>{language === "es" ? "La lista se actualiza automáticamente cada 30 segundos." : "This list refreshes automatically every 30 seconds."}</span></div><div className="sessions-summary-count"><strong>{sessions.filter((session) => session.status === "active").length}</strong><span>{copy.active.toLocaleLowerCase()}</span></div></div>
      {accessError ? <div className={`sessions-access-state${accessError === "unauthorized" ? " is-warning" : ""}`}><ShieldCheck size={19} /><span>{accessError === "unauthorized" ? copy.unauthorized : copy.forbidden}</span></div> : <>
        <div className="sessions-toolbar"><div className="sessions-filters" role="group" aria-label={copy.status}>{(["all", "active", "expired"] as SessionFilter[]).map((item) => <button type="button" key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item === "all" ? copy.all : item === "active" ? copy.active : copy.expired}<span>{item === "all" ? sessions.length : sessions.filter((session) => session.status === item).length}</span></button>)}</div><label className="sessions-search"><Globe2 size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} /></label></div>
        <div className="resource-table-wrap sessions-table-wrap"><table className="resource-data-table sessions-table"><thead><tr><th>{copy.user}</th><th>{copy.device}</th><th>{copy.ip}</th><th>{copy.status}</th><th>{copy.created}</th><th>{copy.expires}</th><th>{copy.actions}</th></tr></thead><tbody>
          {filteredSessions.map((session) => <tr key={session.id}>
            <td className="sessions-user-cell"><strong>{session.username}</strong>{session.email ? <small>{session.email}</small> : null}{session.isCurrent ? <span className="sessions-current"><span />{copy.current}</span> : null}</td>
            <td><span className="sessions-device"><Laptop size={15} />{clientName(session.userAgent, language)}</span></td>
            <td className="sessions-ip">{session.clientIp ?? "—"}</td>
            <td><span className={`sessions-status ${session.status}`}><span />{session.status === "active" ? copy.activeState : copy.expiredState}</span></td>
            <td>{formatDate(session.createdAt, language)}</td><td><span className="sessions-date"><Clock3 size={14} />{formatDate(session.expiresAt, language)}</span></td>
            <td><button className="sessions-revoke" type="button" onClick={() => setConfirmSession(session)} title={session.status === "active" ? copy.revoke : copy.remove}><X size={14} />{session.status === "active" ? copy.revoke : copy.remove}</button></td>
          </tr>)}
          {!loading && !filteredSessions.length ? <tr><td colSpan={7} className="sessions-empty">{copy.empty}</td></tr> : null}
          {loading ? <tr><td colSpan={7} className="sessions-empty">{copy.loading}</td></tr> : null}
        </tbody></table></div>
        <div className="sessions-footnote"><ShieldCheck size={14} />{language === "es" ? "Los tokens no se muestran ni se envían al navegador. Revocar una sesión elimina su credencial del servidor." : "Session tokens are never displayed or sent to the browser. Revoking a session removes its credential from the server."}</div>
      </>}
    </section>
    {confirmSession ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !revoking) setConfirmSession(null); }}><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="session-revoke-title"><span className="modal-kicker"><ShieldCheck size={14} />{copy.badge}</span><h2 id="session-revoke-title"><X size={19} />{copy.confirmTitle}</h2><p>{confirmSession.status === "active" ? copy.confirmActive : copy.confirmExpired} <strong>{confirmSession.username}</strong>.</p><div className="modal-actions"><button type="button" onClick={() => setConfirmSession(null)} disabled={revoking}><X size={14} />{copy.cancel}</button><button className="danger-button" type="button" onClick={() => void revoke()} disabled={revoking}><X size={15} />{revoking ? (confirmSession.status === "active" ? copy.deleting : copy.removing) : confirmSession.status === "active" ? copy.confirm : copy.remove}</button></div></section></div> : null}
  </main>;
}
