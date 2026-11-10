"use client";

import { useEffect, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, RefreshCw, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Event = { id: string; createdAt: string; actor: string; actorRole: string; action: string; resource: string; resourceId: string | null; resourceName: string | null; outcome: "success" | "failure"; status: number };

export function AuditWorkspace() {
  const { language } = useI18n();
  const es = language === "es";
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [offset, setOffset] = useState(0);
  const pageSize = 100;

  async function refresh(nextOffset = offset) {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/audit?limit=${pageSize}&offset=${nextOffset}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || (es ? "No se pudo cargar la auditoría." : "Could not load the audit log."));
      setEvents(data.data ?? []); setTotal(data.total ?? 0); setOffset(nextOffset);
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo cargar la auditoría." : "Could not load the audit log."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void refresh(); }, []);
  const date = (value: string) => new Intl.DateTimeFormat(es ? "es" : "en", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(`${value.replace(" ", "T")}Z`));
  const label = (value: string) => value.replaceAll("_", " ").replaceAll(".", " / ");

  return <main className="module-main audit-page">
    <header className="module-header"><div><span className="module-kicker">VESSEL / {es ? "SEGURIDAD" : "SECURITY"}</span><h1>{es ? "Registro de auditoría" : "Audit log"}</h1><p>{es ? "Consulta los cambios y operaciones sensibles realizados en Vessel." : "Review changes and sensitive operations performed in Vessel."}</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spinning" : ""} />{es ? "Actualizar" : "Refresh"}</button></header>
    <section className="module-panel audit-summary"><span className="settings-panel-icon"><ShieldCheck size={20} /></span><div><strong>{total.toLocaleString(es ? "es" : "en")} {es ? "eventos registrados" : "events recorded"}</strong><p>{es ? "Se conservan hasta 10.000 eventos recientes. Los secretos y cuerpos de solicitudes no se guardan." : "Up to 10,000 recent events are retained. Secrets and request bodies are never stored."}</p></div><Activity size={20} /></section>
    {error ? <div className="settings-feedback is-error" role="alert">{error}</div> : null}
    <section className="module-panel audit-table-wrap"><div className="audit-heading"><h2>{es ? "Actividad reciente" : "Recent activity"}</h2><span>{events.length} / {total}</span></div>
      {loading ? <div className="audit-empty">{es ? "Cargando eventos…" : "Loading events…"}</div> : events.length ? <><div className="table-scroll"><table className="audit-table"><thead><tr><th>{es ? "Fecha" : "Date"}</th><th>{es ? "Usuario" : "User"}</th><th>{es ? "Acción" : "Action"}</th><th>{es ? "Recurso" : "Resource"}</th><th>{es ? "Resultado" : "Result"}</th></tr></thead><tbody>{events.map((event) => <tr key={event.id}><td>{date(event.createdAt)}</td><td><strong>{event.actor}</strong><small>{event.actorRole}</small></td><td><span className="audit-action">{label(event.action)}</span></td><td><strong>{event.resourceName || label(event.resource)}</strong>{event.resourceId ? <code>{event.resourceId}</code> : <small>{label(event.resource)}</small>}</td><td><span className={`status-pill ${event.outcome === "success" ? "is-running" : "is-stopped"}`}>{event.outcome === "success" ? (es ? "Correcto" : "Success") : (es ? "Falló" : "Failed")} · {event.status}</span></td></tr>)}</tbody></table></div><div className="audit-pagination"><span>{es ? `${offset + 1}–${Math.min(offset + events.length, total)} de ${total}` : `${offset + 1}–${Math.min(offset + events.length, total)} of ${total}`}</span><div><button className="secondary-button" type="button" onClick={() => void refresh(Math.max(0, offset - pageSize))} disabled={loading || offset === 0}><ChevronLeft size={15} />{es ? "Anterior" : "Previous"}</button><button className="secondary-button" type="button" onClick={() => void refresh(offset + pageSize)} disabled={loading || offset + pageSize >= total}><ChevronRight size={15} />{es ? "Siguiente" : "Next"}</button></div></div></> : <div className="audit-empty">{es ? "Aún no hay cambios auditados." : "No audited changes yet."}</div>}
    </section>
  </main>;
}
