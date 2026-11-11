"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, CircleAlert, CircleCheck, Clock3, ExternalLink, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type ResourceAlertEvent = { id: string; ruleName: string; engineName: string; metric: "cpu" | "memory" | "disk"; operator: "above" | "below"; threshold: number; value: number; state: "active" | "resolved"; triggeredAt: string; resolvedAt: string | null };
const READ_KEY = "vessel-resource-alert-read";

export function ResourceNotificationBell() {
  const { language } = useI18n();
  const es = language === "es";
  const [events, setEvents] = useState<ResourceAlertEvent[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<ResourceAlertEvent | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/resource-alerts", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { events?: ResourceAlertEvent[] };
      setEvents(payload.events ?? []);
    } catch { /* Keep the last notification snapshot if the Engine is temporarily unavailable. */ }
  }, []);

  useEffect(() => {
    try { setReadIds(JSON.parse(window.localStorage.getItem(READ_KEY) || "[]") as string[]); } catch { setReadIds([]); }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!open && !selectedEvent) return;
    const closeOutside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); setSelectedEvent(null); } };
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => { document.removeEventListener("mousedown", closeOutside); document.removeEventListener("keydown", closeEscape); };
  }, [open, selectedEvent]);

  const unreadCount = useMemo(() => events.filter((event) => !readIds.includes(event.id)).length, [events, readIds]);
  const activeCount = useMemo(() => events.filter((event) => event.state === "active").length, [events]);
  const pendingCount = activeCount || unreadCount;
  const markAllRead = () => {
    const next = [...new Set([...readIds, ...events.map((event) => event.id)])].slice(-500);
    setReadIds(next);
    window.localStorage.setItem(READ_KEY, JSON.stringify(next));
  };
  const markRead = (id: string) => {
    if (readIds.includes(id)) return;
    const next = [...readIds, id].slice(-500);
    setReadIds(next);
    window.localStorage.setItem(READ_KEY, JSON.stringify(next));
  };
  const metricName = (metric: ResourceAlertEvent["metric"]) => metric === "cpu" ? "CPU" : metric === "memory" ? (es ? "Memoria" : "Memory") : (es ? "Disco" : "Disk");
  const dateLabel = (date: string) => new Intl.DateTimeFormat(es ? "es-VE" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date));

  return <div className="resource-notification-center" ref={root}>
    <button className="resource-notification-trigger" type="button" aria-label={es ? "Notificaciones" : "Notifications"} aria-expanded={open} aria-haspopup="dialog" onClick={() => { setOpen((value) => !value); void refresh(); }}>
      <Bell size={18} />
      {pendingCount > 0 ? <span className="resource-notification-count" aria-label={es ? `${pendingCount} alertas pendientes` : `${pendingCount} pending alerts`}>{pendingCount > 99 ? "99+" : pendingCount}</span> : null}
    </button>
    {open ? <section className="resource-notification-popover" role="dialog" aria-label={es ? "Notificaciones de recursos" : "Resource notifications"}>
      <header className="resource-notification-header"><div className="resource-notification-heading"><span className="resource-notification-heading-icon"><Bell size={18} /></span><div><strong>{es ? "Notificaciones" : "Notifications"}</strong><small>{es ? "Alertas de recursos" : "Resource alerts"}</small></div></div><div className="resource-notification-header-actions">{unreadCount ? <span className="resource-notification-unread-count">{unreadCount} {es ? "nuevas" : "new"}</span> : <span className="resource-notification-caught-up"><CircleCheck size={14} />{es ? "Al día" : "All caught up"}</span>}{unreadCount ? <button type="button" className="resource-notification-read-all" onClick={markAllRead} title={es ? "Marcar todo como leído" : "Mark all as read"}><CheckCheck size={16} /></button> : null}<button type="button" className="resource-notification-close" onClick={() => setOpen(false)} aria-label={es ? "Cerrar" : "Close"}><X size={17} /></button></div></header>
      <div className="resource-notification-list">
        {events.length ? events.slice(0, 30).map((event) => {
          const unread = !readIds.includes(event.id);
          const active = event.state === "active";
          return <button type="button" className={"resource-notification-item" + (unread ? " is-unread" : "")} key={event.id} onClick={() => { markRead(event.id); setSelectedEvent(event); setOpen(false); }}>
            <span className={"resource-notification-item-icon" + (active ? " is-alert" : " is-resolved")}>{active ? <CircleAlert size={18} /> : <CircleCheck size={18} />}</span>
            <span className="resource-notification-item-content"><span className="resource-notification-item-title"><strong>{event.ruleName}</strong><span className={"resource-notification-status " + (active ? "is-active" : "is-resolved")}>{active ? (es ? "Activa" : "Active") : (es ? "Resuelta" : "Resolved")}</span></span><span className="resource-notification-metric"><span>{event.engineName} <i>·</i> {metricName(event.metric)}</span><strong>{event.value.toFixed(1)}%</strong></span><small><Clock3 size={13} /><span>{dateLabel(event.resolvedAt || event.triggeredAt)}</span></small></span>
            {unread ? <span className="resource-notification-unread-dot" aria-label={es ? "Sin leer" : "Unread"} /> : <span className="resource-notification-dot-space" aria-hidden="true" />}
          </button>;
        }) : <div className="resource-notification-empty"><span><Bell size={20} /></span><strong>{es ? "No hay notificaciones" : "No notifications"}</strong><small>{es ? "Las alertas de recursos aparecerán aquí cuando se activen." : "Resource alerts will appear here when triggered."}</small></div>}
      </div>
    </section> : null}
    {selectedEvent ? <div className="modal-backdrop resource-alert-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedEvent(null); }}><section className="confirm-modal resource-alert-detail-modal" role="dialog" aria-modal="true" aria-labelledby="resource-alert-detail-title"><header className="resource-alert-detail-header"><span className={"resource-notification-item-icon " + (selectedEvent.state === "active" ? "is-alert" : "is-resolved")}>{selectedEvent.state === "active" ? <CircleAlert size={20} /> : <CircleCheck size={20} />}</span><button type="button" className="resource-alert-detail-close" onClick={() => setSelectedEvent(null)} aria-label={es ? "Cerrar detalle" : "Close details"}><X size={18} /></button></header><span className="modal-kicker">{selectedEvent.state === "active" ? (es ? "ALERTA ACTIVA" : "ACTIVE ALERT") : (es ? "ALERTA RESUELTA" : "RESOLVED ALERT")}</span><h2 id="resource-alert-detail-title">{selectedEvent.ruleName}</h2><p className="resource-alert-detail-summary">{selectedEvent.engineName} · {metricName(selectedEvent.metric)} {selectedEvent.state === "active" ? (es ? "está en" : "is at") : (es ? "quedó en" : "was at")} <strong>{selectedEvent.value.toFixed(1)}%</strong>.</p><div className="resource-alert-detail-facts"><div><span>{es ? "Condición" : "Condition"}</span><strong>{metricName(selectedEvent.metric)} {selectedEvent.operator === "above" ? "≥" : "≤"} {selectedEvent.threshold}%</strong></div><div><span>{es ? "Engine" : "Engine"}</span><strong>{selectedEvent.engineName}</strong></div><div><span>{selectedEvent.state === "active" ? (es ? "Activada" : "Triggered") : (es ? "Resuelta" : "Resolved")}</span><strong>{dateLabel(selectedEvent.resolvedAt || selectedEvent.triggeredAt)}</strong></div></div><footer className="resource-alert-detail-actions"><button type="button" className="secondary-button" onClick={() => setSelectedEvent(null)}><X size={15} />{es ? "Cerrar" : "Close"}</button><Link className="primary-button" href="/monitoring" onClick={() => setSelectedEvent(null)}><ExternalLink size={15} />{es ? "Abrir monitoreo y alertas" : "Open monitoring & alerts"}</Link></footer></section></div> : null}
  </div>;
}
