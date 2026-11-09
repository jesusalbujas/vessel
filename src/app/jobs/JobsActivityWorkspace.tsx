"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, CalendarClock, Eye, FileClock, FolderKanban, RefreshCw, Search, Terminal, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { notifyVessel } from "@/app/components/ToastNotice";
import "../globals.css";

type Run = {
  id: string; taskId: string; taskName: string; projectId: string | null; projectName: string | null;
  startedBy: string | null; trigger: "manual" | "schedule"; status: "running" | "succeeded" | "failed";
  exitCode: number | null; error: string | null; startedAt: string; finishedAt: string | null; durationSeconds: number; output?: string;
};

function elapsed(seconds: number, es: boolean) {
  if (seconds < 60) return es ? `${seconds} s` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return es ? `${minutes} min` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return es ? `${hours} h ${minutes % 60} min` : `${hours}h ${minutes % 60}m`;
}

export default function JobsActivityWorkspace() {
  const { language } = useI18n();
  const es = language === "es";
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState("all");
  const [page, setPage] = useState(0);
  const [logRun, setLogRun] = useState<Run | null>(null);
  const [deleteRun, setDeleteRun] = useState<Run | null>(null);
  const [deletingRun, setDeletingRun] = useState(false);
  const [error, setError] = useState("");
  const pageSize = 20;

  async function refresh(silent = false) {
    if (!silent) setRefreshing(true);
    try {
      const response = await fetch("/api/scheduled-tasks?resource=activity&limit=5000", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudo cargar la actividad." : "Could not load activity."));
      setRuns(payload.data.runs ?? []);
      setError("");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : (es ? "No se pudo cargar la actividad." : "Could not load activity.");
      setError(message);
      if (!silent) notifyVessel({ kind: "error", title: message });
    } finally { setLoading(false); setRefreshing(false); }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refresh(true), 10_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const since = period === "day" ? Date.now() - 86_400_000 : period === "week" ? Date.now() - 7 * 86_400_000 : 0;
    return runs.filter((run) => (status === "all" || run.status === status)
      && (!since || Date.parse(run.startedAt) >= since)
      && (!needle || `${run.taskName} ${run.projectName ?? ""} ${run.startedBy ?? ""} ${run.id}`.toLocaleLowerCase().includes(needle)));
  }, [runs, query, status, period]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice(page * pageSize, (page + 1) * pageSize);

  async function showDetails(run: Run) {
    setLogRun({ ...run, output: "" });
    try {
      const response = await fetch(`/api/scheduled-tasks?runId=${encodeURIComponent(run.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudo cargar la salida." : "Could not load run output."));
      setLogRun({ ...run, ...payload.data });
    } catch (cause) {
      setLogRun({ ...run, output: cause instanceof Error ? cause.message : (es ? "No se pudo cargar la salida." : "Could not load run output.") });
    }
  }

  async function confirmDeleteRun() {
    if (!deleteRun || deletingRun) return;
    setDeletingRun(true);
    try {
      const response = await fetch("/api/scheduled-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "run.delete", id: deleteRun.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudo eliminar la ejecución." : "Could not delete execution."));
      const deletedId = deleteRun.id;
      setDeleteRun(null);
      if (logRun?.id === deletedId) setLogRun(null);
      await refresh(true);
      notifyVessel({ kind: "success", title: es ? "Ejecución eliminada" : "Execution deleted", detail: `#${deletedId.slice(0, 8)}` });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : (es ? "No se pudo eliminar la ejecución." : "Could not delete execution.");
      notifyVessel({ kind: "error", title: message });
    } finally { setDeletingRun(false); }
  }

  return <main className="module-main scheduled-tasks-page">
    <header className="module-header"><div><span className="module-kicker"><Activity size={14} /> VESSEL RUN · {es ? "ACTIVIDAD" : "ACTIVITY"}</span><h1>{es ? "Actividad" : "Activity"}</h1><p>{es ? "Ejecuciones recientes de todos los proyectos y trabajos." : "Recent runs across all projects and jobs."}</p></div><button className="secondary-button" type="button" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={15} className={refreshing ? "spinning" : ""} />{es ? "Actualizar" : "Refresh"}</button></header>
    <nav className="scheduled-workspace-tabs" aria-label={es ? "Navegación de Vessel Run" : "Vessel Run navigation"}><Link href="/jobs"><FolderKanban size={15} />{es ? "Proyectos" : "Projects"}</Link><Link className="active" href="/jobs/activity"><Activity size={15} />{es ? "Actividad" : "Activity"}</Link></nav>
    <section className="module-panel scheduled-activity-panel">
      <div className="scheduled-activity-toolbar">
        <label className="scheduled-project-search"><Search size={16} /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={es ? "Buscar trabajo, proyecto, usuario o ID…" : "Search job, project, user, or ID…"} aria-label={es ? "Buscar actividad" : "Search activity"} />{query ? <button type="button" className="scheduled-project-search-clear" onClick={() => { setQuery(""); setPage(0); }} aria-label={es ? "Limpiar búsqueda" : "Clear search"}><X size={14} /></button> : null}</label>
        <label className="scheduled-activity-select"><span>{es ? "Estado" : "Status"}</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }}><option value="all">{es ? "Todos" : "All"}</option><option value="succeeded">{es ? "Correctas" : "Succeeded"}</option><option value="failed">{es ? "Fallidas" : "Failed"}</option><option value="running">{es ? "En ejecución" : "Running"}</option></select></label>
        <label className="scheduled-activity-select"><span>{es ? "Período" : "Period"}</span><select value={period} onChange={(event) => { setPeriod(event.target.value); setPage(0); }}><option value="all">{es ? "Cualquier fecha" : "Any time"}</option><option value="day">{es ? "Últimas 24 horas" : "Last 24 hours"}</option><option value="week">{es ? "Últimos 7 días" : "Last 7 days"}</option></select></label>
        <label className="scheduled-activity-auto"><input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />{es ? "Actualización automática" : "Auto refresh"}</label>
      </div>
      <div className="scheduled-activity-summary"><span><Activity size={15} />{loading ? (es ? "Cargando…" : "Loading…") : es ? `${filtered.length} ejecuciones` : `${filtered.length} executions`}</span><span>{es ? `${filtered.length ? page * pageSize + 1 : 0}–${Math.min((page + 1) * pageSize, filtered.length)} de ${filtered.length}` : `${filtered.length ? page * pageSize + 1 : 0}–${Math.min((page + 1) * pageSize, filtered.length)} of ${filtered.length}`}</span></div>
      {error ? <div className="scheduled-error" role="alert">{error}</div> : null}
      {loading ? <div className="scheduled-activity-loading"><i /><i /><i /><i /></div> : visible.length ? <div className="scheduled-activity-table-wrap"><table className="scheduled-activity-table"><thead><tr><th>{es ? "Fecha" : "Date"}</th><th>{es ? "Resultado" : "Result"}</th><th>{es ? "Duración" : "Duration"}</th><th>{es ? "Iniciado por" : "Started by"}</th><th>{es ? "Trabajo" : "Job"}</th><th>{es ? "Proyecto" : "Project"}</th><th>ID</th><th>{es ? "Acciones" : "Actions"}</th></tr></thead><tbody>{visible.map((run) => <tr key={run.id}><td><time dateTime={run.startedAt}>{new Intl.DateTimeFormat(es ? "es-VE" : "en-US", { dateStyle: "short", timeStyle: "short" }).format(new Date(run.startedAt))}</time></td><td><span className={`scheduled-run-status ${run.status}`}><i />{run.status === "running" ? (es ? "En ejecución" : "Running") : run.status === "succeeded" ? (es ? "Correcta" : "Succeeded") : (es ? "Fallida" : "Failed")}</span></td><td>{elapsed(run.durationSeconds, es)}</td><td>{run.startedBy ?? (run.trigger === "schedule" ? (es ? "Programador" : "Scheduler") : "—")}</td><td><strong>{run.taskName}</strong><small>{run.trigger === "schedule" ? (es ? "Programada" : "Scheduled") : (es ? "Manual" : "Manual")}</small></td><td>{run.projectName ?? "—"}</td><td><code>#{run.id.slice(0, 8)}</code></td><td><div className="scheduled-activity-actions"><button className="scheduled-log-button" type="button" onClick={() => void showDetails(run)}><Eye size={14} />{es ? "Detalle" : "Details"}</button>{run.status !== "running" ? <button className="scheduled-icon-button is-danger" type="button" onClick={() => setDeleteRun(run)} aria-label={es ? "Eliminar ejecución" : "Delete execution"} title={es ? "Eliminar ejecución" : "Delete execution"}><Trash2 size={15} /></button> : null}</div></td></tr>)}</tbody></table></div> : <div className="scheduled-history-empty"><CalendarClock size={19} />{es ? "No hay ejecuciones que coincidan con estos filtros." : "No executions match these filters."}</div>}
      {filtered.length > pageSize ? <footer className="scheduled-project-pagination"><span>{es ? `Página ${page + 1} de ${pageCount}` : `Page ${page + 1} of ${pageCount}`}</span><div><button className="secondary-button" type="button" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>{es ? "Anterior" : "Previous"}</button><button className="secondary-button" type="button" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1}>{es ? "Siguiente" : "Next"}</button></div></footer> : null}
    </section>
    {logRun ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogRun(null); }}><section className="confirm-modal scheduled-log-modal scheduled-run-detail-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-run-detail-title"><header className="scheduled-modal-header"><div><span className={`scheduled-run-status ${logRun.status}`}><i />{logRun.status === "running" ? (es ? "En ejecución" : "Running") : logRun.status === "succeeded" ? (es ? "Correcta" : "Succeeded") : (es ? "Fallida" : "Failed")}</span><h2 id="scheduled-run-detail-title">{logRun.taskName}</h2><p>{logRun.projectName ?? (es ? "Trabajo eliminado o proyecto no disponible" : "Job deleted or project unavailable")}</p></div><button className="scheduled-modal-close" type="button" onClick={() => setLogRun(null)} aria-label={es ? "Cerrar" : "Close"}><X size={19} /></button></header><dl className="scheduled-run-detail-grid"><div><dt>{es ? "ID de ejecución" : "Execution ID"}</dt><dd><code>{logRun.id}</code></dd></div><div><dt>{es ? "Iniciada" : "Started"}</dt><dd>{new Intl.DateTimeFormat(es ? "es-VE" : "en-US", { dateStyle: "full", timeStyle: "medium" }).format(new Date(logRun.startedAt))}</dd></div><div><dt>{es ? "Desencadenador" : "Trigger"}</dt><dd>{logRun.trigger === "schedule" ? (es ? "Programador" : "Scheduler") : (es ? "Manual" : "Manual")}</dd></div><div><dt>{es ? "Iniciado por" : "Started by"}</dt><dd>{logRun.startedBy ?? (logRun.trigger === "schedule" ? (es ? "Programador" : "Scheduler") : "—")}</dd></div><div><dt>{es ? "Duración" : "Duration"}</dt><dd>{elapsed(logRun.durationSeconds, es)}</dd></div><div><dt>{es ? "Código de salida" : "Exit code"}</dt><dd>{logRun.exitCode ?? "—"}</dd></div></dl>{logRun.error ? <div className="scheduled-log-error">{logRun.error}</div> : null}<section className="scheduled-run-detail-output"><h3><Terminal size={15} />{es ? "Salida de la ejecución" : "Execution output"}</h3><pre>{logRun.output || (es ? "Sin salida registrada." : "No output recorded.")}</pre></section><footer><button className="secondary-button" type="button" onClick={() => setLogRun(null)}>{es ? "Cerrar" : "Close"}</button>{logRun.status !== "running" ? <button className="danger-button" type="button" onClick={() => setDeleteRun(logRun)}><Trash2 size={15} />{es ? "Eliminar ejecución" : "Delete execution"}</button> : null}</footer></section></div> : null}
    {deleteRun ? <div className="modal-backdrop modal-backdrop-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deletingRun) setDeleteRun(null); }}><section className="confirm-modal scheduled-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-run-title"><span className="module-kicker"><Trash2 size={14} />{es ? "ELIMINAR EJECUCIÓN" : "DELETE EXECUTION"}</span><h2 id="delete-run-title">{deleteRun.taskName}</h2><p>{es ? "Se eliminarán esta ejecución y su salida del historial. Esta acción no se puede deshacer." : "This execution and its output will be removed from history. This action cannot be undone."}</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDeleteRun(null)} disabled={deletingRun}>{es ? "Cancelar" : "Cancel"}</button><button type="button" className="danger-button" onClick={() => void confirmDeleteRun()} disabled={deletingRun}><Trash2 size={15} />{deletingRun ? (es ? "Eliminando…" : "Deleting…") : (es ? "Eliminar" : "Delete")}</button></div></section></div> : null}
  </main>;
}
