"use client";
import VesselSelect from "@/app/components/VesselSelect";

import { useEffect, useState } from "react";
import { Check, CircleCheck, Fingerprint, Globe2, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck, UserPlus } from "lucide-react";
import { SettingsNavigation } from "@/app/components/SettingsNavigation";
import { useI18n } from "@/lib/i18n";
import { ContentLoadingSkeleton } from "@/app/components/LoadingSkeletons";
import "../../globals.css";

type Settings = {
  refreshIntervalSeconds: number;
  sessionLifetimeHours: number;
  passwordMinLength: number;
  passwordRequireStrong: boolean;
  authMode: "internal" | "oauth";
  oauthProvider: "microsoft" | "google" | "github" | "custom";
  oauthUseSso: boolean;
  oauthHideInternalPrompt: boolean;
  oauthAutoProvision: boolean;
  oauthClientId: string;
  oauthClientSecretConfigured: boolean;
  oauthAuthorizationUrl: string;
  oauthTokenUrl: string;
  oauthResourceUrl: string;
  oauthRedirectUrl: string;
  oauthLogoutUrl: string;
  oauthUserIdentifier: string;
  oauthScopes: string;
  oauthAuthStyle: "auto" | "basic" | "post";
};

const providerDefaults = {
  google: { authorization: "https://accounts.google.com/o/oauth2/v2/auth", token: "https://oauth2.googleapis.com/token", resource: "https://openidconnect.googleapis.com/v1/userinfo", identifier: "sub", scopes: "openid email profile" },
  microsoft: { authorization: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize", token: "https://login.microsoftonline.com/common/oauth2/v2.0/token", resource: "https://graph.microsoft.com/oidc/userinfo", identifier: "sub", scopes: "openid profile email" },
  github: { authorization: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", resource: "https://api.github.com/user", identifier: "id", scopes: "read:user user:email" },
  custom: { authorization: "", token: "", resource: "", identifier: "sub", scopes: "openid email profile" },
} as const;

export default function AuthenticationSettingsPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [settings, setSettings] = useState<Settings | null>(null);
  const [clientSecret, setClientSecret] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        const next = data.data as Settings;
        next.oauthRedirectUrl ||= `${window.location.origin}/api/auth/oauth/callback`;
        setSettings(next);
        setCanManage(Boolean(data.canManage));
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : es ? "No se pudo cargar la configuración." : "Could not load settings."));
  }, [es]);

  function updateProvider(provider: Settings["oauthProvider"]) {
    if (!settings) return;
    const defaults = providerDefaults[provider];
    setSettings({ ...settings, oauthProvider: provider, oauthAuthorizationUrl: defaults.authorization, oauthTokenUrl: defaults.token, oauthResourceUrl: defaults.resource, oauthUserIdentifier: defaults.identifier, oauthScopes: defaults.scopes });
  }

  async function save() {
    if (!settings) return;
    setSaving(true); setNotice(""); setError("");
    try {
      const body: Record<string, unknown> = {
        sessionLifetimeHours: settings.sessionLifetimeHours,
        passwordMinLength: settings.passwordMinLength,
        passwordRequireStrong: settings.passwordRequireStrong,
        authMode: settings.authMode,
        oauthProvider: settings.oauthProvider,
        oauthUseSso: settings.oauthUseSso,
        oauthHideInternalPrompt: settings.oauthHideInternalPrompt,
        oauthAutoProvision: settings.oauthAutoProvision,
        oauthClientId: settings.oauthClientId,
        oauthAuthorizationUrl: settings.oauthAuthorizationUrl,
        oauthTokenUrl: settings.oauthTokenUrl,
        oauthResourceUrl: settings.oauthResourceUrl,
        oauthRedirectUrl: settings.oauthRedirectUrl,
        oauthLogoutUrl: settings.oauthLogoutUrl,
        oauthUserIdentifier: settings.oauthUserIdentifier,
        oauthScopes: settings.oauthScopes,
        oauthAuthStyle: settings.oauthAuthStyle,
      };
      if (clientSecret) body.oauthClientSecret = clientSecret;
      const response = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setSettings(data.data); setClientSecret(""); setNotice(es ? "Configuración de autenticación guardada." : "Authentication settings saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo guardar." : "Could not save settings."); }
    finally { setSaving(false); }
  }

  const text = {
    sso: es ? "Usar inicio de sesión único (SSO)" : "Use single sign-on (SSO)",
    hide: es ? "Ocultar el formulario de acceso local" : "Hide the internal authentication prompt",
    provision: es ? "Crear cuentas automáticamente" : "Automatic user provisioning",
  };

  return <main className="module-main settings-page"><header className="module-header"><div><span className="module-kicker">VESSEL / {es ? "SEGURIDAD" : "SECURITY"}</span><h1>{es ? "Autenticación" : "Authentication"}</h1><p>{es ? "Gestiona el inicio de sesión, OAuth, sesiones y política de contraseñas." : "Configure sign-in, OAuth, sessions, and password policy."}</p></div><span className="module-header-badge"><ShieldCheck size={15} />{es ? "Acceso protegido" : "Protected access"}</span></header>
    <SettingsNavigation />
    {!canManage && !error ? <div className="settings-callout"><ShieldCheck size={18} />{es ? "Solo administradores pueden cambiar la configuración de Vessel." : "Only administrators can change Vessel settings."}</div> : null}
    {error ? <div className="settings-feedback is-error" role="alert">{error}</div> : null}
    {!settings && !error ? <ContentLoadingSkeleton rows={5} label={es ? "Cargando autenticación…" : "Loading authentication…"} /> : null}
    {settings ? <>
      <section className="module-panel settings-panel"><div className="settings-panel-heading"><span className="settings-panel-icon"><Fingerprint size={19} /></span><div><h2>{es ? "Método de autenticación" : "Authentication method"}</h2><p>{es ? "Elige autenticación local o un proveedor OAuth 2.0." : "Choose internal authentication or an OAuth 2.0 provider."}</p></div></div>
        <div className="auth-mode-options">
          <button type="button" className={`auth-mode-option${settings.authMode === "internal" ? " is-selected" : ""}`} onClick={() => setSettings({ ...settings, authMode: "internal", oauthUseSso: false })} disabled={!canManage}><span><LockKeyhole size={17} /></span><strong>{es ? "Autenticación interna" : "Internal authentication"}</strong><small>{es ? "Cuentas locales de Vessel" : "Vessel local accounts"}</small>{settings.authMode === "internal" ? <CircleCheck size={17} /> : null}</button>
          <button type="button" className={`auth-mode-option${settings.authMode === "oauth" ? " is-selected" : ""}`} onClick={() => setSettings({ ...settings, authMode: "oauth", oauthUseSso: true })} disabled={!canManage}><span><Globe2 size={17} /></span><strong>OAuth 2.0</strong><small>{es ? "Proveedor de identidad externo" : "External identity provider"}</small>{settings.authMode === "oauth" ? <CircleCheck size={17} /> : null}</button>
        </div>

        <div className="settings-help-row"><ShieldCheck size={15} /><span>{es ? "El secreto OAuth se cifra en SQLite y nunca se devuelve al navegador. El callback usa state, PKCE S256 y una sesión Vessel con la duración configurada." : "The OAuth secret is encrypted in SQLite and never returned to the browser. The callback uses state, PKCE S256, and a Vessel session with the configured lifetime."}</span></div>

        <div className="oauth-settings-block">
          <div className="oauth-section-title"><span className="settings-panel-icon"><Globe2 size={18} /></span><div><h3>{es ? "Proveedor OAuth" : "OAuth provider"}</h3><p>{es ? "Configura un proveedor conocido o introduce las URL de tu proveedor propio." : "Choose a supported provider or enter endpoints for your own identity provider."}</p></div></div>
          <label className="settings-field"><span><strong>{es ? "Proveedor" : "Provider"}</strong><small>{es ? "Los valores iniciales se pueden ajustar para tu organización." : "Defaults can be adjusted for your organization."}</small></span><VesselSelect value={settings.oauthProvider} onChange={(event) => updateProvider(event.target.value as Settings["oauthProvider"])} disabled={!canManage}><option value="microsoft">Microsoft OAuth</option><option value="google">Google OAuth</option><option value="github">GitHub OAuth</option><option value="custom">{es ? "Proveedor personalizado" : "Custom OAuth provider"}</option></VesselSelect></label>
          <div className="oauth-fields-grid">
            <label><span>{es ? "Client ID" : "Client ID"}</span><input value={settings.oauthClientId} onChange={(event) => setSettings({ ...settings, oauthClientId: event.target.value })} disabled={!canManage} autoComplete="off" /></label>
            <label><span>Client Secret</span><input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} disabled={!canManage} placeholder={settings.oauthClientSecretConfigured ? (es ? "Configurado; vacío conserva el actual" : "Configured; leave blank to keep current") : (es ? "Pega el secreto del cliente" : "Enter the client secret")} autoComplete="new-password" /></label>
            <label><span>{es ? "Authorization URL" : "Authorization URL"}</span><input type="url" value={settings.oauthAuthorizationUrl} onChange={(event) => setSettings({ ...settings, oauthAuthorizationUrl: event.target.value })} disabled={!canManage} spellCheck={false} /></label>
            <label><span>{es ? "Access token URL" : "Access token URL"}</span><input type="url" value={settings.oauthTokenUrl} onChange={(event) => setSettings({ ...settings, oauthTokenUrl: event.target.value })} disabled={!canManage} spellCheck={false} /></label>
            <label><span>{es ? "Resource URL / UserInfo" : "Resource URL / UserInfo"}</span><input type="url" value={settings.oauthResourceUrl} onChange={(event) => setSettings({ ...settings, oauthResourceUrl: event.target.value })} disabled={!canManage} spellCheck={false} /></label>
            <label><span>{es ? "Redirect URL" : "Redirect URL"}</span><input type="url" value={settings.oauthRedirectUrl} onChange={(event) => setSettings({ ...settings, oauthRedirectUrl: event.target.value })} disabled={!canManage} spellCheck={false} /></label>
            <label><span>{es ? "Logout URL (opcional)" : "Logout URL (optional)"}</span><input type="url" value={settings.oauthLogoutUrl} onChange={(event) => setSettings({ ...settings, oauthLogoutUrl: event.target.value })} disabled={!canManage} spellCheck={false} /></label>
            <label><span>{es ? "Identificador de usuario" : "User identifier"}</span><input value={settings.oauthUserIdentifier} onChange={(event) => setSettings({ ...settings, oauthUserIdentifier: event.target.value })} disabled={!canManage} placeholder="sub" spellCheck={false} /></label>
            <label><span>{es ? "Scopes" : "Scopes"}</span><input value={settings.oauthScopes} onChange={(event) => setSettings({ ...settings, oauthScopes: event.target.value })} disabled={!canManage} placeholder="openid email profile" /></label>
            <label><span>{es ? "Autenticación del token" : "Token auth style"}</span><VesselSelect value={settings.oauthAuthStyle} onChange={(event) => setSettings({ ...settings, oauthAuthStyle: event.target.value as Settings["oauthAuthStyle"] })} disabled={!canManage}><option value="auto">{es ? "Detección automática" : "Auto detect"}</option><option value="basic">Client secret basic</option><option value="post">Client secret post</option></VesselSelect></label>
          </div>

          <label className="settings-toggle"><input type="checkbox" checked={settings.oauthUseSso} onChange={(event) => setSettings({ ...settings, oauthUseSso: event.target.checked, authMode: event.target.checked ? "oauth" : "internal" })} disabled={!canManage} /><span className="settings-toggle-mark"><Check size={13} /></span><span><strong>{text.sso}</strong><small>{es ? "Activa el botón SSO en el formulario de inicio de sesión y permite el flujo OAuth." : "Show the SSO button on the sign-in screen and enable the OAuth flow."}</small></span></label>
          <label className="settings-toggle"><input type="checkbox" checked={settings.oauthHideInternalPrompt} onChange={(event) => setSettings({ ...settings, oauthHideInternalPrompt: event.target.checked })} disabled={!canManage || !settings.oauthUseSso} /><span className="settings-toggle-mark"><Check size={13} /></span><span><strong>{text.hide}</strong><small>{es ? "Oculta usuario y contraseña en la pantalla; el endpoint local de acceso sigue disponible para recuperación." : "Hides username and password on the sign-in page; the internal login endpoint remains available for recovery."}</small></span></label>
          <label className="settings-toggle"><input type="checkbox" checked={settings.oauthAutoProvision} onChange={(event) => setSettings({ ...settings, oauthAutoProvision: event.target.checked })} disabled={!canManage} /><span className="settings-toggle-mark"><Check size={13} /></span><span><strong>{text.provision}</strong><small>{es ? "Si está desactivado, solo se permite asociar una identidad con una cuenta existente mediante su correo verificado. Los usuarios nuevos reciben rol Operador." : "When disabled, an identity can only be linked to an existing account using its verified email. New users receive the Operator role."}</small></span></label>
          {settings.authMode === "oauth" ? <div className="settings-help-row is-warning"><UserPlus size={15} /><span>{es ? "Antes de activar, registra en el proveedor esta URL de retorno exacta. Mantén al menos una cuenta de administrador local para recuperación." : "Register this exact callback URL with your provider before enabling. Keep at least one local administrator account for recovery."}</span></div> : null}
        </div>
      </section>

      <section className="module-panel settings-panel"><div className="settings-panel-heading"><span className="settings-panel-icon"><KeyRound size={19} /></span><div><h2>{es ? "Sesión y contraseñas" : "Session and passwords"}</h2><p>{es ? "La política se aplica a sesiones nuevas y a cuentas locales nuevas." : "The policy applies to new sessions and newly created local accounts."}</p></div></div>
        <label className="settings-field"><span><strong>{es ? "Duración de sesión" : "Session lifetime"}</strong><small>{es ? "El cambio aplica al próximo inicio de sesión, incluido SSO." : "The change applies at the next sign-in, including SSO."}</small></span><VesselSelect value={settings.sessionLifetimeHours} onChange={(event) => setSettings({ ...settings, sessionLifetimeHours: Number(event.target.value) })} disabled={!canManage}><option value={1}>1 {es ? "hora" : "hour"}</option><option value={2}>2 {es ? "horas" : "hours"}</option><option value={4}>4 {es ? "horas" : "hours"}</option><option value={8}>8 {es ? "horas" : "hours"}</option><option value={12}>12 {es ? "horas" : "hours"}</option><option value={24}>24 {es ? "horas" : "hours"}</option></VesselSelect></label>
        <label className="settings-field"><span><strong>{es ? "Longitud mínima de contraseña local" : "Minimum local password length"}</strong><small>{es ? "Entre 8 y 64 caracteres." : "Between 8 and 64 characters."}</small></span><div className="settings-number-field"><input type="number" min={8} max={64} value={settings.passwordMinLength} onChange={(event) => setSettings({ ...settings, passwordMinLength: Number(event.target.value) })} disabled={!canManage} /><span>{es ? "caracteres" : "characters"}</span></div></label>
        <label className="settings-toggle"><input type="checkbox" checked={settings.passwordRequireStrong} onChange={(event) => setSettings({ ...settings, passwordRequireStrong: event.target.checked })} disabled={!canManage} /><span className="settings-toggle-mark"><Check size={13} /></span><span><strong>{es ? "Exigir contraseña segura" : "Require a strong password"}</strong><small>{es ? "Requiere mayúscula, minúscula, número y símbolo." : "Requires uppercase, lowercase, a number, and a symbol."}</small></span></label>
        <div className="settings-help-row"><ShieldCheck size={15} /><span>{es ? "En producción, publica Vessel detrás de HTTPS para proteger credenciales y sesiones." : "In production, serve Vessel behind HTTPS to protect credentials and sessions."}</span></div>
        {canManage ? <div className="settings-actions"><button className="primary-button" type="button" onClick={save} disabled={saving}>{saving ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{es ? saving ? "Guardando…" : "Guardar cambios" : saving ? "Saving…" : "Save changes"}</button></div> : null}
      </section>
      {notice ? <div className="settings-feedback is-success" role="status"><Check size={16} />{notice}</div> : null}
    </> : null}
  </main>;
}
