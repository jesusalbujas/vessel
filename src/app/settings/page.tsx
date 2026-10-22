"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, ArrowRight, Check, Clock3, LoaderCircle, RefreshCw, ShieldCheck, Settings2 } from "lucide-react";
import { SettingsNavigation } from "@/app/components/SettingsNavigation";
import { useI18n } from "@/lib/i18n";
import "../globals.css";

type Settings = { refreshIntervalSeconds: number; sessionLifetimeHours: number; passwordMinLength: number; passwordRequireStrong: boolean };

export default function SettingsPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store", headers: { authorization: "Bearer " + (window.localStorage.getItem("vessel-token") ?? "") } })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setSettings(data.data); setCanManage(Boolean(data.canManage)); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : es ? "No se pudo cargar la configuración." : "Could not load settings."));
  }, [es]);

  async function save() {
    if (!settings) return;
    setSaving(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json", authorization: "Bearer " + (window.localStorage.getItem("vessel-token") ?? "") }, body: JSON.stringify({ refreshIntervalSeconds: settings.refreshIntervalSeconds }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSettings(data.data); setNotice(es ? "Configuración general guardada." : "General settings saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo guardar." : "Could not save settings."); }
    finally { setSaving(false); }
  }

  return <main className="module-main settings-page"><header className="module-header"><div><span className="module-kicker">VESSEL / {es ? "PLATAFORMA" : "PLATFORM"}</span><h1>{es ? "Configuración" : "Settings"}</h1><p>{es ? "Preferencias compartidas para el plano de control." : "Shared preferences for the control plane."}</p></div><span className="module-header-badge"><Settings2 size={15} />{es ? "Administración" : "Administration"}</span></header>
    <SettingsNavigation />
    {!canManage && !error ? <div className="settings-callout"><ShieldCheck size={18} />{es ? "Solo administradores pueden cambiar la configuración de Vessel." : "Only administrators can change Vessel settings."}</div> : null}
    {error ? <div className="settings-feedback is-error" role="alert">{error}</div> : null}
    {!settings && !error ? <div className="settings-loading"><LoaderCircle size={18} className="spinning" />{es ? "Cargando…" : "Loading…"}</div> : null}
    {settings ? <>
      <section className="module-panel settings-panel"><div className="settings-panel-heading"><span className="settings-panel-icon"><Activity size={19} /></span><div><h2>{es ? "Actualización del entorno" : "Environment refresh"}</h2><p>{es ? "Controla cada cuánto Vessel vuelve a consultar contenedores y métricas del host." : "Choose how often Vessel refreshes containers and host metrics."}</p></div></div>
        <label className="settings-field"><span><strong>{es ? "Intervalo de actualización" : "Refresh interval"}</strong><small>{es ? "Aplica al inventario de contenedores y a las métricas del resumen. El progreso de operaciones conserva su frecuencia rápida." : "Applies to the container inventory and overview metrics. Operation progress keeps its faster polling interval."}</small></span><select value={settings.refreshIntervalSeconds} onChange={(event) => setSettings({ ...settings, refreshIntervalSeconds: Number(event.target.value) })} disabled={!canManage}><option value={5}>5 {es ? "segundos" : "seconds"}</option><option value={10}>10 {es ? "segundos" : "seconds"}</option><option value={15}>15 {es ? "segundos" : "seconds"}</option><option value={30}>30 {es ? "segundos" : "seconds"}</option><option value={60}>60 {es ? "segundos" : "seconds"}</option></select></label>
        <div className="settings-help-row"><Clock3 size={15} /><span>{es ? "Un intervalo corto actualiza el estado antes, a cambio de más consultas al Docker Engine." : "Short intervals surface changes sooner, at the cost of more Docker Engine requests."}</span></div>
        {canManage ? <div className="settings-actions"><button className="primary-button" type="button" onClick={save} disabled={saving}>{saving ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{es ? saving ? "Guardando…" : "Guardar cambios" : saving ? "Saving…" : "Save changes"}</button></div> : null}
      </section>
      <section className="settings-link-grid"><Link href="/settings/authentication" className="settings-link-card"><span className="settings-panel-icon"><ShieldCheck size={19} /></span><span><strong>{es ? "Autenticación y seguridad" : "Authentication & security"}</strong><small>{es ? "Sesiones de " + settings.sessionLifetimeHours + " h · contraseñas desde " + settings.passwordMinLength + " caracteres" : settings.sessionLifetimeHours + " h sessions · passwords from " + settings.passwordMinLength + " characters"}</small></span><ArrowRight size={17} /></Link><Link href="/terms" className="settings-link-card"><span className="settings-panel-icon"><RefreshCw size={19} /></span><span><strong>{es ? "Términos y condiciones" : "Terms & conditions"}</strong><small>{es ? "Alcance, seguridad y uso de recursos Docker" : "Scope, security, and Docker resource use"}</small></span><ArrowRight size={17} /></Link></section>
      {notice ? <div className="settings-feedback is-success" role="status"><Check size={16} />{notice}</div> : null}
    </> : null}
  </main>;
}
