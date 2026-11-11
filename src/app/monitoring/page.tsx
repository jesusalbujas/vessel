"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Bell, BellRing, Check, CircleAlert, CircleHelp, Clock3, Cpu, Gauge, HardDrive, LoaderCircle, MemoryStick, Save, Server, ShieldAlert, SlidersHorizontal, Trash2, X } from "lucide-react";
import VesselSelect from "@/app/components/VesselSelect";
import { notifyVessel } from "@/app/components/ToastNotice";
import { useI18n } from "@/lib/i18n";

type Metric = "cpu" | "memory" | "disk";
type Rule = { id: string; name: string; engineId: string; metric: Metric; operator: "above" | "below"; threshold: number; consecutiveSamples: number; enabled: boolean; lastValue: number | null; createdAt: string; updatedAt: string };
type Event = { id: string; ruleId: string; ruleName: string; engineId: string; engineName: string; metric: Metric; operator: "above" | "below"; threshold: number; value: number; state: "active" | "resolved"; triggeredAt: string; resolvedAt: string | null };
type Engine = { id: string; name: string; host: string };
type Payload = { rules: Rule[]; events: Event[]; engines: Engine[]; canManage: boolean };
const initialForm = (engineId = "local") => ({ name: "", engineId, metric: "disk" as Metric, operator: "above" as "above" | "below", threshold: 90, consecutiveSamples: 2 });

export default function MonitoringPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState(initialForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const metricText = (metric: Metric) => metric === "cpu" ? "CPU" : metric === "memory" ? (es ? "Memoria" : "Memory") : (es ? "Disco" : "Disk");
  const formatDate = (value: string) => new Intl.DateTimeFormat(es ? "es-VE" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/resource-alerts", { cache: "no-store" });
      if (!response.ok) throw new Error(es ? "No se pudieron cargar las alertas." : "Could not load alerts.");
      setData(await response.json() as Payload);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : (es ? "Error de conexión." : "Connection error.")); }
    finally { setLoading(false); }
  }, [es]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(true), 30_000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => {
    if (!editingId) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) resetForm(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [editingId, saving]);
  const activeEvents = useMemo(() => data?.events.filter((event) => event.state === "active") ?? [], [data]);
  function resetForm() { setEditingId(null); setForm(initialForm(data?.engines[0]?.id ?? "local")); }
  function editRule(rule: Rule) {
    setEditingId(rule.id);
    setForm({ name: rule.name, engineId: rule.engineId, metric: rule.metric, operator: rule.operator, threshold: rule.threshold, consecutiveSamples: rule.consecutiveSamples });
  }
  async function saveRule(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch("/api/resource-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", ...form, id: editingId ?? undefined }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || (es ? "No se pudo guardar la regla." : "Could not save the rule."));
      notifyVessel({ kind: "success", title: es ? "Regla de monitoreo guardada" : "Monitoring rule saved", detail: form.name });
      resetForm(); await refresh(true);
    } catch (cause) { notifyVessel({ kind: "error", title: cause instanceof Error ? cause.message : (es ? "No se pudo guardar." : "Could not save.") }); }
    finally { setSaving(false); }
  }
  async function removeRule(rule: Rule) {
    if (!window.confirm(es ? "¿Eliminar la regla «" + rule.name + "» y su historial de alertas?" : "Delete rule “" + rule.name + "” and its alert history?")) return;
    const response = await fetch("/api/resource-alerts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: rule.id }) });
    if (!response.ok) { notifyVessel({ kind: "error", title: es ? "No se pudo eliminar la regla" : "Could not delete rule" }); return; }
    notifyVessel({ kind: "success", title: es ? "Regla eliminada" : "Rule deleted" }); await refresh(true);
  }
  const ruleFormFields = () => <form className="monitoring-rule-form" onSubmit={saveRule}>
    <label className="monitoring-field monitoring-field-name"><span className="monitoring-field-label"><BellRing size={14} />{es ? "Nombre" : "Name"}</span><input maxLength={100} required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={es ? "Ej. Disco casi lleno" : "e.g. Disk nearly full"} /></label>
    <label className="monitoring-field"><span className="monitoring-field-label"><Server size={14} />Engine<CircleHelp className="monitoring-help-icon" size={14} data-tooltip={es ? "Engine Docker donde se medirá este recurso." : "Docker Engine where this resource will be measured."} /></span><VesselSelect portalMenu value={form.engineId} onChange={(event) => setForm({ ...form, engineId: event.target.value })}>{engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}{engine.host && engine.id !== "local" ? " · " + engine.host : ""}</option>)}</VesselSelect></label>
    <label className="monitoring-field"><span className="monitoring-field-label">{form.metric === "cpu" ? <Cpu size={14} /> : form.metric === "memory" ? <MemoryStick size={14} /> : <HardDrive size={14} />}{es ? "Recurso" : "Resource"}<CircleHelp className="monitoring-help-icon" size={14} data-tooltip={es ? "Métrica del Engine que activará la alerta: procesador, memoria o espacio en disco." : "Engine metric that triggers the alert: processor, memory, or disk space."} /></span><VesselSelect portalMenu value={form.metric} onChange={(event) => setForm({ ...form, metric: event.target.value as Metric })}><option value="cpu">CPU</option><option value="memory">{es ? "Memoria" : "Memory"}</option><option value="disk">{es ? "Almacenamiento" : "Storage"}</option></VesselSelect></label>
    <label className="monitoring-field"><span className="monitoring-field-label"><SlidersHorizontal size={14} />{es ? "Condición" : "Condition"}<CircleHelp className="monitoring-help-icon" size={14} data-tooltip={es ? "Define si la alerta se activa al alcanzar el umbral o al bajar de él." : "Choose whether the alert triggers above the threshold or below it."} /></span><VesselSelect portalMenu value={form.operator} onChange={(event) => setForm({ ...form, operator: event.target.value as "above" | "below" })}><option value="above">{es ? "Alcance o supere" : "Reaches or exceeds"}</option><option value="below">{es ? "Baje de" : "Falls below"}</option></VesselSelect></label>
    <label className="monitoring-field"><span className="monitoring-field-label"><Gauge size={14} />{es ? "Umbral" : "Threshold"}<CircleHelp className="monitoring-help-icon" size={14} data-tooltip={es ? "Porcentaje de uso que debe alcanzar o cruzar el recurso." : "Usage percentage the resource must reach or cross."} /></span><div className="monitoring-percent-input"><Gauge size={16} aria-hidden="true" /><input aria-label={es ? "Porcentaje del umbral" : "Threshold percentage"} type="number" min={1} max={100} required value={form.threshold} onChange={(event) => setForm({ ...form, threshold: Number(event.target.value) })} /><span>%</span></div></label>
    <label className="monitoring-field"><span className="monitoring-field-label"><Clock3 size={14} />{es ? "Confirmar durante" : "Confirm for"}<CircleHelp className="monitoring-help-icon" size={14} data-tooltip={es ? "Una muestra es una revisión de métricas, realizada cada minuto. Se requieren ese número de revisiones consecutivas fuera del umbral para activar la alerta." : "A sample is one metrics check, performed every minute. The alert triggers only after this many consecutive checks exceed the threshold."} /></span><VesselSelect portalMenu value={String(form.consecutiveSamples)} onChange={(event) => setForm({ ...form, consecutiveSamples: Number(event.target.value) })}><option value="1">{es ? "1 muestra" : "1 sample"}</option><option value="2">{es ? "2 muestras" : "2 samples"}</option><option value="3">{es ? "3 muestras" : "3 samples"}</option><option value="5">{es ? "5 muestras" : "5 samples"}</option></VesselSelect><small className="monitoring-field-hint">{es ? `${form.consecutiveSamples} ${form.consecutiveSamples === 1 ? "revisión consecutiva" : "revisiones consecutivas"} · aprox. ${form.consecutiveSamples} min` : `${form.consecutiveSamples} consecutive ${form.consecutiveSamples === 1 ? "check" : "checks"} · about ${form.consecutiveSamples} min`}</small></label>
    <div className="monitoring-form-actions">{editingId ? <button className="secondary-button" type="button" onClick={resetForm} disabled={saving}>{es ? "Cancelar" : "Cancel"}</button> : null}<button className="primary-button" type="submit" disabled={saving || !engines.length}>{saving ? <LoaderCircle size={16} className="spinning" /> : <Save size={16} />}{saving ? (es ? "Guardando…" : "Saving…") : editingId ? (es ? "Guardar cambios" : "Save changes") : (es ? "Crear regla" : "Create rule")}</button></div>
  </form>;
  const engines = data?.engines ?? [];
  return <main className="module-main monitoring-page">
    <header className="module-header"><div><span className="module-kicker"><Activity size={15} />{es ? "OBSERVABILIDAD / ALERTAS" : "OBSERVABILITY / ALERTS"}</span><h1>{es ? "Monitoreo y alertas" : "Monitoring & alerts"}</h1><p>{es ? "Define límites para los recursos de tus Engines y recibe avisos cuando se alcancen." : "Set resource limits for your Engines and get notified when they are reached."}</p></div><button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}><LoaderCircle size={16} className={loading ? "spinning" : ""} />{es ? "Actualizar" : "Refresh"}</button></header>
    <section className="monitoring-summary-grid">
      <article className="monitoring-summary-card"><span className="monitoring-summary-icon"><BellRing size={19} /></span><div><small>{es ? "Alertas activas" : "Active alerts"}</small><strong>{loading && !data ? "—" : activeEvents.length}</strong></div></article>
      <article className="monitoring-summary-card"><span className="monitoring-summary-icon is-blue"><Activity size={19} /></span><div><small>{es ? "Reglas configuradas" : "Configured rules"}</small><strong>{loading && !data ? "—" : data?.rules.length ?? 0}</strong></div></article>
      <article className="monitoring-summary-card monitoring-summary-help"><span className="monitoring-summary-icon is-green"><Clock3 size={19} /></span><div><strong>{es ? "Comprobación cada minuto" : "Checked every minute"}</strong><small>{es ? "La condición debe cumplirse en varias muestras para evitar avisos por picos breves." : "Conditions must persist across samples to avoid alerts for brief spikes."}</small></div></article>
    </section>
    {error ? <div className="monitoring-error" role="alert"><CircleAlert size={18} />{error}</div> : null}
    {data?.canManage && !editingId ? <section className="monitoring-panel">
      <div className="monitoring-panel-heading"><span className="monitoring-panel-icon"><ShieldAlert size={19} /></span><div><h2>{es ? "Nueva regla de alerta" : "New alert rule"}</h2><p>{es ? "Compara el uso actual con un umbral y elige cuántas muestras consecutivas lo deben confirmar." : "Compare current usage with a threshold and choose how many consecutive samples must confirm it."}</p></div></div>
      {ruleFormFields()}
    </section> : null}
    <section className="monitoring-panel">
      <div className="monitoring-panel-heading"><span className="monitoring-panel-icon is-amber"><Bell size={19} /></span><div><h2>{es ? "Reglas" : "Rules"}</h2><p>{es ? "Una regla activa genera un evento cuando se cumple y se cierra cuando el recurso vuelve al rango." : "An active rule creates an event when its condition is met and resolves when usage returns to range."}</p></div></div>
      {loading && !data ? <div className="monitoring-skeleton-list"><div className="monitoring-skeleton-row"><i /><i /><i /></div><div className="monitoring-skeleton-row"><i /><i /><i /></div></div> : data?.rules.length ? <div className="monitoring-rule-list">{data.rules.map((rule) => {
        const Icon = rule.metric === "cpu" ? Cpu : rule.metric === "memory" ? MemoryStick : HardDrive;
        const engine = engines.find((item) => item.id === rule.engineId);
        return <article className="monitoring-rule-row" key={rule.id}><span className="monitoring-metric-icon"><Icon size={18} /></span><div className="monitoring-rule-copy"><strong>{rule.name}</strong><span>{engine?.name ?? rule.engineId} · {metricText(rule.metric)} {rule.operator === "above" ? "≥" : "<"} {rule.threshold}%</span></div><div className="monitoring-rule-state"><span className={rule.enabled ? "monitoring-state-dot is-on" : "monitoring-state-dot"} />{rule.lastValue === null ? (es ? "Esperando muestra" : "Waiting for sample") : rule.lastValue.toFixed(1) + "%"}</div><small className="monitoring-rule-samples">{rule.consecutiveSamples} {es ? (rule.consecutiveSamples === 1 ? "muestra" : "muestras") : (rule.consecutiveSamples === 1 ? "sample" : "samples")}</small>{data.canManage ? <div className="monitoring-row-actions"><button className="secondary-button" type="button" onClick={() => editRule(rule)}>{es ? "Editar" : "Edit"}</button><button className="monitoring-icon-button" type="button" aria-label={es ? "Eliminar " + rule.name : "Delete " + rule.name} title={es ? "Eliminar regla" : "Delete rule"} onClick={() => void removeRule(rule)}><Trash2 size={16} /></button></div> : null}</article>;
      })}</div> : <div className="monitoring-empty"><BellRing size={22} /><strong>{es ? "Aún no hay reglas" : "No alert rules yet"}</strong><span>{es ? "Crea una regla para recibir avisos cuando CPU, memoria o disco crucen un límite." : "Create a rule to get notified when CPU, memory, or disk crosses a threshold."}</span></div>}
    </section>
    <section className="monitoring-panel">
      <div className="monitoring-panel-heading"><span className="monitoring-panel-icon is-red"><CircleAlert size={19} /></span><div><h2>{es ? "Historial de alertas" : "Alert history"}</h2><p>{es ? "Eventos activos y condiciones que ya se resolvieron." : "Active events and conditions that have been resolved."}</p></div><span className="monitoring-count">{activeEvents.length} {es ? "activas" : "active"}</span></div>
      {loading && !data ? <div className="monitoring-skeleton-list"><div className="monitoring-skeleton-row"><i /><i /><i /></div></div> : data?.events.length ? <div className="monitoring-event-list">{data.events.map((event) => <article className="monitoring-event-row" key={event.id}><span className={"monitoring-event-mark " + event.state} /><div className="monitoring-event-copy"><strong>{event.ruleName}</strong><span>{event.engineName} · {metricText(event.metric)} {event.operator === "above" ? "≥" : "<"} {event.threshold}% · {es ? "registró" : "reached"} {event.value.toFixed(1)}%</span><small>{formatDate(event.triggeredAt)}{event.resolvedAt ? " · " + (es ? "Resuelta " : "Resolved ") + formatDate(event.resolvedAt) : ""}</small></div><span className={"monitoring-event-badge " + event.state}>{event.state === "active" ? (es ? "Activa" : "Active") : <><Check size={13} />{es ? "Resuelta" : "Resolved"}</>}</span></article>)}</div> : <div className="monitoring-empty is-compact"><Check size={21} /><strong>{es ? "Todo dentro de los límites" : "Everything is within limits"}</strong><span>{es ? "Las alertas que se activen aparecerán aquí." : "Triggered alerts will appear here."}</span></div>}
    </section>
    <p className="monitoring-footnote">{es ? "Las métricas se consultan cada 60 segundos. Las alertas se registran en Vessel; los avisos del navegador se muestran mientras Vessel está abierto." : "Metrics are checked every 60 seconds. Alerts are stored in Vessel; browser notifications appear while Vessel is open."}</p>
    {editingId ? <div className="modal-backdrop monitoring-edit-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) resetForm(); }}><section className="confirm-modal monitoring-edit-modal" role="dialog" aria-modal="true" aria-labelledby="monitoring-edit-title"><header className="monitoring-edit-heading"><div><span className="modal-kicker"><ShieldAlert size={15} />{es ? "REGLA DE MONITOREO" : "MONITORING RULE"}</span><h2 id="monitoring-edit-title">{es ? "Editar regla" : "Edit rule"}</h2><p>{es ? "Ajusta el recurso, el límite o el tiempo de confirmación." : "Adjust the resource, threshold, or confirmation period."}</p></div><button className="monitoring-edit-close" type="button" onClick={resetForm} disabled={saving} aria-label={es ? "Cerrar" : "Close"}><X size={18} /></button></header>{ruleFormFields()}</section></div> : null}
  </main>;
}
