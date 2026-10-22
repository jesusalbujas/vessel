"use client";

import { useEffect, useState } from "react";
import { Check, CircleCheck, Fingerprint, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, Users } from "lucide-react";
import { SettingsNavigation } from "@/app/components/SettingsNavigation";
import { useI18n } from "@/lib/i18n";
import "../../globals.css";

type Settings = { refreshIntervalSeconds: number; sessionLifetimeHours: number; passwordMinLength: number; passwordRequireStrong: boolean };

export default function AuthenticationSettingsPage() {
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
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json", authorization: "Bearer " + (window.localStorage.getItem("vessel-token") ?? "") }, body: JSON.stringify({ sessionLifetimeHours: settings.sessionLifetimeHours, passwordMinLength: settings.passwordMinLength, passwordRequireStrong: settings.passwordRequireStrong }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSettings(data.data); setNotice(es ? "Política de autenticación guardada." : "Authentication policy saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo guardar." : "Could not save settings."); }
    finally { setSaving(false); }
  }

  return <main className="module-main settings-page"><header className="module-header"><div><span className="module-kicker">VESSEL / {es ? "SEGURIDAD" : "SECURITY"}</span><h1>{es ? "Autenticación" : "Authentication"}</h1><p>{es ? "Sesiones, método de acceso y política de contraseñas." : "Sessions, sign-in method, and password policy."}</p></div><span className="module-header-badge"><ShieldCheck size={15} />{es ? "Acceso protegido" : "Protected access"}</span></header>
    <SettingsNavigation />
    {!canManage && !error ? <div className="settings-callout"><ShieldCheck size={18} />{es ? "Solo administradores pueden cambiar la configuración de Vessel." : "Only administrators can change Vessel settings."}</div> : null}
    {error ? <div className="settings-feedback is-error" role="alert">{error}</div> : null}
    {!settings && !error ? <div className="settings-loading"><LoaderCircle size={18} className="spinning" />{es ? "Cargando…" : "Loading…"}</div> : null}
    {settings ? <>
      <section className="module-panel settings-panel"><div className="settings-panel-heading"><span className="settings-panel-icon"><Fingerprint size={19} /></span><div><h2>{es ? "Método de autenticación" : "Authentication method"}</h2><p>{es ? "Vessel utiliza autenticación interna con cuentas locales." : "Vessel currently uses internal authentication with local accounts."}</p></div></div>
        <div className="auth-method-active"><span><LockKeyhole size={18} /></span><div><strong>{es ? "Autenticación interna" : "Internal authentication"}</strong><small>{es ? "Activa · contraseñas protegidas con hash scrypt." : "Active · passwords are protected with scrypt hashes."}</small></div><CircleCheck size={18} /></div>
        <div className="auth-method-unavailable"><Users size={17} /><div><strong>LDAP · Active Directory · OAuth</strong><small>{es ? "Integraciones externas no disponibles todavía. No se mostrarán como configurables hasta que Vessel incluya su flujo completo." : "External identity providers are not available yet. They will not be presented as configurable until Vessel implements their complete flows."}</small></div><span>{es ? "No disponible" : "Unavailable"}</span></div>
      </section>
      <section className="module-panel settings-panel"><div className="settings-panel-heading"><span className="settings-panel-icon"><KeyRound size={19} /></span><div><h2>{es ? "Sesión y contraseñas" : "Session and passwords"}</h2><p>{es ? "La política se aplica a las nuevas sesiones y a la creación de cuentas." : "The policy applies to new sessions and newly created accounts."}</p></div></div>
        <label className="settings-field"><span><strong>{es ? "Duración de sesión" : "Session lifetime"}</strong><small>{es ? "Las sesiones existentes mantienen su vencimiento actual; el cambio aplica al próximo inicio de sesión." : "Existing sessions keep their current expiry; the change applies at the next sign-in."}</small></span><select value={settings.sessionLifetimeHours} onChange={(event) => setSettings({ ...settings, sessionLifetimeHours: Number(event.target.value) })} disabled={!canManage}><option value={1}>1 {es ? "hora" : "hour"}</option><option value={2}>2 {es ? "horas" : "hours"}</option><option value={4}>4 {es ? "horas" : "hours"}</option><option value={8}>8 {es ? "horas" : "hours"}</option><option value={12}>12 {es ? "horas" : "hours"}</option><option value={24}>24 {es ? "horas" : "hours"}</option></select></label>
        <label className="settings-field"><span><strong>{es ? "Longitud mínima" : "Minimum length"}</strong><small>{es ? "Entre 8 y 64 caracteres." : "Between 8 and 64 characters."}</small></span><div className="settings-number-field"><input type="number" min={8} max={64} value={settings.passwordMinLength} onChange={(event) => setSettings({ ...settings, passwordMinLength: Number(event.target.value) })} disabled={!canManage} /><span>{es ? "caracteres" : "characters"}</span></div></label>
        <label className="settings-toggle"><input type="checkbox" checked={settings.passwordRequireStrong} onChange={(event) => setSettings({ ...settings, passwordRequireStrong: event.target.checked })} disabled={!canManage} /><span className="settings-toggle-mark"><Check size={13} /></span><span><strong>{es ? "Exigir contraseña segura" : "Require a strong password"}</strong><small>{es ? "Requiere mayúscula, minúscula, número y símbolo, además de la longitud mínima." : "Requires uppercase, lowercase, a number, and a symbol in addition to the minimum length."}</small></span></label>
        <div className="settings-help-row"><ShieldCheck size={15} /><span>{es ? "En producción, Vessel marca la cookie de sesión como Secure. Publica la interfaz detrás de HTTPS." : "In production, Vessel marks the session cookie as Secure. Serve the interface behind HTTPS."}</span></div>
        {canManage ? <div className="settings-actions"><button className="primary-button" type="button" onClick={save} disabled={saving}>{saving ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{es ? saving ? "Guardando…" : "Guardar cambios" : saving ? "Saving…" : "Save changes"}</button></div> : null}
      </section>
      {notice ? <div className="settings-feedback is-success" role="status"><Check size={16} />{notice}</div> : null}
    </> : null}
  </main>;
}
