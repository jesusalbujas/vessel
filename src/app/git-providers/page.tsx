"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, Check, CircleAlert, ExternalLink, KeyRound, Link2, LoaderCircle, LockKeyhole, Plus, RefreshCw, Save, Settings2, ShieldCheck, Trash2, Unplug, X } from "lucide-react";
import { ToastNotice, type Notice } from "@/app/components/ToastNotice";
import { GitProviderLogo } from "@/app/components/GitProviderLogo";
import { useI18n, type TranslationKey } from "@/lib/i18n";

type ProviderKind = "github" | "gitlab" | "bitbucket" | "gitea";
type Provider = {
  id: string; provider: ProviderKind; name: string; baseUrl: string; accountName: string | null;
  clientId: string; appId: string | null; appSlug: string | null;
  shareWithOrganization: boolean; connected: boolean; connectedAt: string | null;
  hasClientSecret: boolean; hasAppPrivateKey: boolean; hasInstallation: boolean;
  hasWebhookSecret: boolean;
};
type ProviderForm = {
  id: string; provider: ProviderKind; name: string; baseUrl: string; clientId: string; clientSecret: string;
  appId: string; appSlug: string; appPrivateKey: string; shareWithOrganization: boolean;
  webhookSecret: string;
};

const defaults: Record<ProviderKind, string> = {
  github: "https://github.com", gitlab: "https://gitlab.com", bitbucket: "https://bitbucket.org", gitea: "https://gitea.com",
};
const blankForm = (provider: ProviderKind = "github"): ProviderForm => ({
  id: "", provider, name: "", baseUrl: defaults[provider], clientId: "", clientSecret: "", appId: "", appSlug: "", appPrivateKey: "", shareWithOrganization: true, webhookSecret: "",
});
const gitProviderApiErrorKeys: Record<string, TranslationKey> = {
  git_provider_public_url_invalid: "git_provider_public_url_invalid",
  git_provider_public_url_protocol: "git_provider_public_url_protocol",
  git_provider_public_url_origin_only: "git_provider_public_url_origin_only",
  git_provider_secret_storage_required: "git_provider_secret_storage_required",
  git_provider_github_organization_invalid: "git_provider_github_organization_invalid",
  "Authentication required": "git_auth_required",
  "Administrator access required": "git_admin_required",
};

function localizeGitProviderApiError(value: unknown, fallback: string, translate: (key: TranslationKey) => string) {
  const code = typeof value === "string" ? value : value instanceof Error ? value.message : "";
  const key = gitProviderApiErrorKeys[code];
  return key ? translate(key) : fallback;
}

export default function GitProvidersPage() {
  const { t, language, languageReady } = useI18n();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState<ProviderForm>(blankForm());
  const [editing, setEditing] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2>(1);
  const [manualGitHub, setManualGitHub] = useState(false);
  const [registerGitHubOrganization, setRegisterGitHubOrganization] = useState(false);
  const [githubOrganization, setGitHubOrganization] = useState("");
  const [startingGitHub, setStartingGitHub] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [callbackBaseUrlError, setCallbackBaseUrlError] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [githubActionRequiredNotice, setGitHubActionRequiredNotice] = useState(false);
  const [deleteId, setDeleteId] = useState("");

  const text = {
    title: t("git_provider_title"), subtitle: t("git_provider_subtitle"), badge: language === "es" ? "Acceso de instancia" : "Instance access", add: t("git_provider_add"), refresh: t("refresh"), empty: t("git_provider_empty"), emptyHelp: t("git_provider_empty_help"),
    github: "GitHub App", gitlab: "GitLab OAuth", bitbucket: "Bitbucket OAuth", gitea: "Gitea OAuth", connection: t("git_provider_connection"), providerType: t("git_provider_type"), name: t("git_provider_name"), baseUrlLabel: t("git_provider_instance_url"), clientId: t("git_provider_client_id"), clientSecret: t("git_provider_client_secret"), secretPlaceholder: t("git_provider_secret_placeholder"), appId: t("git_provider_app_id"), appSlug: t("git_provider_app_slug"), appPrivateKey: t("git_provider_private_key"), privateKeyPlaceholder: t("git_provider_private_key_placeholder"), share: language === "es" ? "Compartir con operadores de esta instancia" : "Share with operators on this instance", cancel: t("cancel"), save: t("git_provider_save"), update: t("git_provider_update"), connect: t("git_provider_connect"), connected: t("git_provider_connected"), notConnected: t("git_provider_not_connected"), account: t("git_provider_account"), callback: t("git_provider_callback"), setup: t("git_provider_setup_url"), encrypted: t("git_provider_encrypted"), disconnect: t("git_provider_disconnect"), remove: t("git_provider_remove"), deleteTitle: t("git_provider_delete_title"), deleteBody: t("git_provider_delete_body"), confirmRemove: t("git_provider_confirm_remove"), storageWarning: t("git_provider_storage_warning"), loadError: t("git_provider_load_error"), saveError: t("git_provider_save_error"), saved: t("git_provider_saved"), connectedToast: t("git_provider_authorized"), connectedToastDetail: t("git_provider_authorized_detail"), connectError: t("git_provider_connect_error"), deleteError: t("git_provider_delete_error"), helpGitHub: t("git_provider_help_github"), helpGitLab: t("git_provider_help_gitlab"), helpBitbucket: t("git_provider_help_bitbucket"), helpGitea: t("git_provider_help_gitea"),
    chooseTypeHelp: language === "es" ? "Elige el servicio de código que quieres conectar." : "Choose the code hosting service you want to connect.", configureHelp: language === "es" ? "Completa la conexión. Vessel cifra las credenciales antes de guardarlas." : "Complete the provider connection. Vessel encrypts credentials before storing them.", githubTypeHelp: language === "es" ? "GitHub App · instalación con acceso limitado a repositorios." : "GitHub App · install with repository-scoped access.", oauthTypeHelp: language === "es" ? "OAuth · autorización segura de una cuenta." : "OAuth · securely authorize an account.", continue: language === "es" ? "Continuar" : "Continue", back: language === "es" ? "Volver" : "Back", change: language === "es" ? "Cambiar" : "Change", selectedType: language === "es" ? "Proveedor seleccionado" : "Selected provider", steps: language === "es" ? "Pasos de configuración" : "Setup steps", adminOnly: language === "es" ? "Solo administradores" : "Administrators only", shareHelp: language === "es" ? "Las cuentas con rol Operador podrán usar esta conexión en los despliegues. Los administradores siempre pueden gestionarla." : "Operator accounts can use this connection for deployments. Administrators can always manage it.",
    webhookSecret: language === "es" ? "Secreto del webhook" : "Webhook secret", webhookSecretHelp: language === "es" ? "Se cifra en Vessel. Pega el mismo secreto configurado en el proveedor; la App creada desde Vessel ya queda configurada automáticamente." : "Encrypted by Vessel. Enter the same secret configured at the provider; apps created by Vessel are configured automatically.", webhookUrl: language === "es" ? "URL de recepción de eventos" : "Event delivery URL", webhookSaved: language === "es" ? "Secreto guardado · vacío conserva el actual" : "Secret saved · leave empty to keep the current one", webhookEvents: language === "es" ? ({ github: "Suscribe Push y Release en GitHub. Las GitHub Apps creadas desde Vessel ya los habilitan.", gitlab: "Activa Push events, Tag push events y Releases en el webhook del proyecto.", gitea: "Activa Push, Create (tags) y Release en el webhook del repositorio.", bitbucket: "Activa Repository push; incluye los cambios de tags. Bitbucket no ofrece el disparador Release en Vessel." }[form.provider]) : ({ github: "Subscribe to Push and Release in GitHub. GitHub Apps created by Vessel already enable them.", gitlab: "Enable Push events, Tag push events, and Releases in the project webhook.", gitea: "Enable Push, Create (tags), and Release in the repository webhook.", bitbucket: "Enable Repository push; tag updates are included. Vessel does not offer a Bitbucket Release trigger." }[form.provider]),
    createGitHubApp: language === "es" ? "Crear GitHub App" : "Create GitHub App", createGitHubHelp: language === "es" ? "Registra la aplicación en GitHub y luego instálala en la cuenta que elijas." : "Register the app on GitHub, then install it on the account you choose.", startingGitHub: language === "es" ? "Abriendo GitHub…" : "Opening GitHub…", manualGitHub: language === "es" ? "Ya tengo una GitHub App · configurar manualmente" : "I already have a GitHub App · configure manually", manifestError: language === "es" ? "No se pudo abrir el registro de GitHub App. Revisa la URL de Vessel y vuelve a intentarlo." : "Could not open GitHub App registration. Check Vessel's URL and try again.", gitHubManifestTitle: language === "es" ? "Conectar GitHub" : "Connect GitHub", gitHubPermissions: language === "es" ? "Vessel solo solicita lectura del contenido y los metadatos del repositorio." : "Vessel only requests read access to repository contents and metadata.", githubRedirectTimeout: language === "es" ? "GitHub no se abrió. Vuelve a intentarlo; si persiste, revisa la conexión con Vessel." : "GitHub did not open. Try again; if the issue continues, check the connection to Vessel.",
    githubOwnerType: language === "es" ? "Propietario de la GitHub App" : "GitHub App owner", githubPersonal: language === "es" ? "Mi cuenta personal" : "My personal account", githubOrganizationOption: language === "es" ? "Una organización" : "An organization", githubOrganizationName: language === "es" ? "Nombre de la organización" : "Organization name", githubOrganizationHint: language === "es" ? "La App se registrará en la configuración de esa organización." : "The App will be registered in that organization’s settings.", githubOrganizationRequired: language === "es" ? "Escribe el nombre de la organización de GitHub." : "Enter the GitHub organization name.", githubActionRequired: language === "es" ? "GitHub App creada · falta instalarla" : "GitHub App created · installation required", githubActionRequiredDetail: language === "es" ? "Instálala para elegir la cuenta y los repositorios a los que Vessel tendrá acceso." : "Install it to choose the account and repositories Vessel can access.", install: language === "es" ? "Instalar" : "Install", actionRequired: language === "es" ? "Acción requerida" : "Action required", installGitHubHint: language === "es" ? "App creada. Instálala en GitHub para completar la conexión." : "App created. Install it on GitHub to complete the connection.",
  };
  const displayedNotice = useMemo(() => githubActionRequiredNotice
    ? { kind: "success" as const, title: text.githubActionRequired, detail: text.githubActionRequiredDetail }
    : notice, [githubActionRequiredNotice, notice, text.githubActionRequired, text.githubActionRequiredDetail]);

  const showNotice = useCallback((next: Notice) => {
    setGitHubActionRequiredNotice(false);
    setNotice(next);
  }, []);

  const closeNotice = useCallback(() => {
    setGitHubActionRequiredNotice(false);
    setNotice(null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/git-providers", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "");
      setProviders(data.data ?? []); setStorageReady(Boolean(data.secretStorageReady)); setBaseUrl(data.callbackBaseUrl ?? window.location.origin); setCallbackBaseUrlError(typeof data.callbackBaseUrlError === "string" ? data.callbackBaseUrlError : "");
    } catch (error) { showNotice({ kind: "error", title: localizeGitProviderApiError(error, text.loadError, t) }); }
    finally { setLoading(false); }
  }, [showNotice, t, text.loadError]);

  useEffect(() => { if (languageReady) void load(); }, [languageReady, load]);

  useEffect(() => {
    if (!languageReady) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "connected") showNotice({ kind: "success", title: text.connectedToast, detail: text.connectedToastDetail });
    if (params.has("action_required")) setGitHubActionRequiredNotice(true);
    if (params.has("error")) showNotice({ kind: "error", title: params.get("error")?.startsWith("manifest_") ? text.manifestError : text.connectError });
    if (params.has("connected") || params.has("error") || params.has("action_required")) window.history.replaceState({}, "", window.location.pathname);
  }, [languageReady, showNotice, text.connectedToast, text.connectedToastDetail, text.connectError, text.manifestError]);

  function startNew() { setForm(blankForm()); setWizardStep(1); setManualGitHub(false); setRegisterGitHubOrganization(false); setGitHubOrganization(""); setEditing(true); setDeleteId(""); }
  function editProvider(provider: Provider) {
    setForm({ id: provider.id, provider: provider.provider, name: provider.name, baseUrl: provider.baseUrl, clientId: provider.clientId, clientSecret: "", appId: provider.appId ?? "", appSlug: provider.appSlug ?? "", appPrivateKey: "", shareWithOrganization: provider.shareWithOrganization, webhookSecret: "" });
    setWizardStep(2); setManualGitHub(false); setRegisterGitHubOrganization(false); setGitHubOrganization(""); setEditing(true); setDeleteId("");
  }

  function closeEditor() {
    if (saving || startingGitHub) return;
    setEditing(false); setForm(blankForm()); setWizardStep(1); setManualGitHub(false); setRegisterGitHubOrganization(false); setGitHubOrganization("");
  }

  async function createGitHubApp() {
    if (registerGitHubOrganization && !githubOrganization.trim()) {
      showNotice({ kind: "error", title: text.githubOrganizationRequired });
      return;
    }
    setStartingGitHub(true);
    let redirectTimeout: number | undefined;
    let githubForm: HTMLFormElement | null = null;
    const clearRedirectTimeout = () => {
      if (redirectTimeout !== undefined) window.clearTimeout(redirectTimeout);
    };
    try {
      const response = await fetch("/api/git-providers/github/manifest", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(15000), body: JSON.stringify({ organization: registerGitHubOrganization ? githubOrganization.trim() : "" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "");
      let actionUrl: URL;
      try { actionUrl = new URL(data.actionUrl); } catch { throw new Error(text.manifestError); }
      const validPath = actionUrl.pathname === "/settings/apps/new" || /^\/organizations\/[A-Za-z0-9-]+\/settings\/apps\/new$/.test(actionUrl.pathname);
      if (actionUrl.origin !== "https://github.com" || !validPath || !actionUrl.searchParams.has("state") || !data.manifest) throw new Error(text.manifestError);
      githubForm = document.createElement("form");
      githubForm.method = "POST";
      githubForm.action = actionUrl.toString();
      const manifest = document.createElement("input");
      manifest.type = "hidden";
      manifest.name = "manifest";
      manifest.value = JSON.stringify(data.manifest);
      githubForm.appendChild(manifest);
      document.body.appendChild(githubForm);
      githubForm.target = "_self";
      redirectTimeout = window.setTimeout(() => {
        githubForm?.remove();
        setStartingGitHub(false);
        showNotice({ kind: "error", title: text.githubRedirectTimeout });
      }, 12000);
      githubForm.submit();
    } catch (error) {
      clearRedirectTimeout();
      githubForm?.remove();
      setStartingGitHub(false);
      showNotice({ kind: "error", title: localizeGitProviderApiError(error, text.manifestError, t) });
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true);
    try {
      const response = await fetch("/api/git-providers", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ action: "save", ...form }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "");
      showNotice({ kind: "success", title: text.saved, detail: form.name }); setEditing(false); setForm(blankForm()); setWizardStep(1); await load();
    } catch (error) { showNotice({ kind: "error", title: localizeGitProviderApiError(error, text.saveError, t) }); }
    finally { setSaving(false); }
  }

  async function disconnect(provider: Provider) {
    try {
      const response = await fetch("/api/git-providers", { method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: JSON.stringify({ action: "disconnect", id: provider.id }) });
      const data = await response.json(); if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "");
      showNotice({ kind: "success", title: t("git_provider_disconnect_success"), detail: provider.name }); await load();
    } catch (error) { showNotice({ kind: "error", title: localizeGitProviderApiError(error, text.connectError, t) }); }
  }

  async function removeProvider() {
    const id = deleteId; if (!id) return;
    try {
      const response = await fetch(`/api/git-providers?id=${encodeURIComponent(id)}`, { method: "DELETE", cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "");
      setDeleteId(""); setEditing(false); showNotice({ kind: "success", title: t("git_provider_removed") }); await load();
    } catch (error) { showNotice({ kind: "error", title: localizeGitProviderApiError(error, text.deleteError, t) }); }
  }

  const labelFor = (provider: ProviderKind) => ({ github: text.github, gitlab: text.gitlab, bitbucket: text.bitbucket, gitea: text.gitea })[provider];
  const callbackFor = (id: string) => `${baseUrl}/api/git-providers/${encodeURIComponent(id)}/callback`;
  const isGitHub = form.provider === "github";
  const showGitHubManifest = !form.id && wizardStep === 2 && isGitHub && !manualGitHub;
  const helpFor = ({ github: text.helpGitHub, gitlab: text.helpGitLab, bitbucket: text.helpBitbucket, gitea: text.helpGitea })[form.provider];

  return <main className="module-main git-providers-page">
    <ToastNotice notice={displayedNotice} onClose={closeNotice} />
    <header className="module-header"><div><span className="module-kicker">VESSEL / SOURCE CONTROL</span><h1>{text.title}</h1><p>{text.subtitle}</p></div><div className="git-providers-header-actions"><span className="module-header-badge"><ShieldCheck size={15} />{text.badge}</span><button type="button" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? "git-providers-spin" : ""} />{text.refresh}</button></div></header>
    {!storageReady ? <div className="git-providers-warning"><CircleAlert size={17} />{text.storageWarning}</div> : callbackBaseUrlError ? <div className="git-providers-warning"><CircleAlert size={17} />{localizeGitProviderApiError(callbackBaseUrlError, text.manifestError, t)}</div> : null}
    <section className="module-panel git-providers-list-panel">
      <div className="module-section-title"><div><strong>{text.connection}</strong><small>{providers.length} {t("git_provider_connections")}</small></div><button type="button" className="primary-button" onClick={startNew}><Plus size={16} />{text.add}</button></div>
      {loading && !providers.length ? <div className="git-providers-empty"><RefreshCw className="git-providers-spin" size={20} />{t("git_provider_loading")}</div> : providers.length ? <div className="git-providers-list">{providers.map((provider) => {
        const installRequired = provider.provider === "github" && !provider.hasInstallation;
        const providerStatus = provider.connected ? text.connected : installRequired ? text.actionRequired : text.notConnected;
        return <article className="git-provider-card" key={provider.id}>
        <div className="git-provider-card-main"><span className={`git-provider-mark provider-${provider.provider}`}><GitProviderLogo provider={provider.provider} size={23} /></span><div className="git-provider-summary"><strong>{provider.name}</strong><small>{labelFor(provider.provider)} <span aria-hidden="true">·</span> {provider.baseUrl.replace(/^https?:\/\//, "")}</small><span className="git-provider-account"><Link2 size={14} />{provider.connected ? `${text.account}: ${provider.accountName ?? provider.name}` : installRequired ? text.installGitHubHint : text.notConnected}</span></div><span className={`git-provider-state${provider.connected ? " connected" : installRequired ? " action-required" : ""}`}><i />{providerStatus}</span></div>
        <div className="git-provider-card-footer"><span className={`git-provider-access${provider.shareWithOrganization ? " shared" : ""}`}><ShieldCheck size={14} />{provider.shareWithOrganization ? text.share : text.adminOnly}</span><div className="git-provider-card-actions">{provider.connected ? <button type="button" className="secondary-button" onClick={() => void disconnect(provider)}><Unplug size={15} />{text.disconnect}</button> : <a href={`/api/git-providers/${encodeURIComponent(provider.id)}/connect`} className="primary-button"><Link2 size={15} />{installRequired ? text.install : text.connect}</a>}<button type="button" className="secondary-button" onClick={() => editProvider(provider)}><Settings2 size={15} />{t("git_provider_edit")}</button><button type="button" className="git-provider-delete" onClick={() => setDeleteId(provider.id)} aria-label={text.remove} title={text.remove}><Trash2 size={16} /></button></div></div>
      </article>;
      })}</div> : <div className="git-providers-empty"><span className="git-provider-empty-icon"><GitProviderLogo provider="github" size={26} /></span><strong>{text.empty}</strong><span>{text.emptyHelp}</span><button type="button" className="secondary-button" onClick={startNew}><Plus size={15} />{text.add}</button></div>}
    </section>
    {editing ? <div className="modal-backdrop git-provider-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeEditor(); }}><section className="confirm-modal git-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="git-provider-dialog-title">
        <header className="git-provider-dialog-header"><div><span className="module-kicker">{text.connection}</span><h2 id="git-provider-dialog-title">{form.id ? t("git_provider_edit") : wizardStep === 1 ? text.add : showGitHubManifest ? text.gitHubManifestTitle : text.connection}</h2><p>{wizardStep === 1 && !form.id ? text.chooseTypeHelp : showGitHubManifest ? text.createGitHubHelp : text.configureHelp}</p></div><button type="button" className="git-provider-dialog-close" onClick={closeEditor} aria-label={text.cancel} disabled={saving || startingGitHub}><X size={19} /></button></header>
        <div className="git-provider-stepper" aria-label={text.steps}><span className={wizardStep === 1 ? "active" : "complete"}><i>{wizardStep > 1 ? <Check size={13} /> : "1"}</i>{text.providerType}</span><span className={wizardStep === 2 ? "active" : ""}><i>2</i>{text.connection}</span></div>
        {!form.id && wizardStep === 1 ? <>
          <div className="git-provider-picker" role="group" aria-label={text.providerType}>{(["github", "gitlab", "bitbucket", "gitea"] as ProviderKind[]).map((kind) => <button type="button" key={kind} className={`git-provider-option${form.provider === kind ? " selected" : ""}`} onClick={() => { setManualGitHub(false); setForm((current) => ({ ...blankForm(kind), name: current.name, shareWithOrganization: current.shareWithOrganization })); }} aria-pressed={form.provider === kind}><span className={`git-provider-option-logo provider-${kind}`}><GitProviderLogo provider={kind} size={28} /></span><span><strong>{labelFor(kind)}</strong><small>{kind === "github" ? text.githubTypeHelp : text.oauthTypeHelp}</small></span>{form.provider === kind ? <Check size={17} /> : null}</button>)}</div>
          <footer className="git-provider-dialog-footer"><button type="button" className="secondary-button" onClick={closeEditor}><X size={15} />{text.cancel}</button><button type="button" className="primary-button" onClick={() => setWizardStep(2)}>{text.continue}<ArrowRight size={15} /></button></footer>
        </> : <>
        <div className="git-provider-selected-type"><span className={`git-provider-option-logo provider-${form.provider}`}><GitProviderLogo provider={form.provider} size={28} /></span><span><strong>{labelFor(form.provider)}</strong><small>{form.id ? form.baseUrl.replace(/^https?:\/\//, "") : text.selectedType}</small></span>{!form.id ? <button type="button" className="git-provider-change-type" onClick={() => { setManualGitHub(false); setWizardStep(1); }}><ArrowLeft size={14} />{text.change}</button> : null}</div>
        {showGitHubManifest ? <>
          <div className="git-provider-manifest">
            <div className="git-provider-owner-select">
              <strong>{text.githubOwnerType}</strong>
              <div role="group" aria-label={text.githubOwnerType}>
                <button type="button" className={!registerGitHubOrganization ? "selected" : ""} onClick={() => setRegisterGitHubOrganization(false)} aria-pressed={!registerGitHubOrganization}><Check size={14} />{text.githubPersonal}</button>
                <button type="button" className={registerGitHubOrganization ? "selected" : ""} onClick={() => setRegisterGitHubOrganization(true)} aria-pressed={registerGitHubOrganization}><Link2 size={14} />{text.githubOrganizationOption}</button>
              </div>
              {registerGitHubOrganization ? <label>{text.githubOrganizationName}<input value={githubOrganization} onChange={(event) => setGitHubOrganization(event.target.value)} autoComplete="organization" maxLength={39} placeholder="my-organization" /><small>{text.githubOrganizationHint}</small></label> : null}
            </div>
            <div className="git-provider-manifest-permissions"><LockKeyhole size={17} /><span>{text.gitHubPermissions}</span></div>
            <button type="button" className="git-provider-manual-link" onClick={() => setManualGitHub(true)}>{text.manualGitHub}</button>
          </div>
          <footer className="git-provider-dialog-footer"><button type="button" className="secondary-button" onClick={closeEditor} disabled={startingGitHub}><ArrowLeft size={15} />{text.cancel}</button><button type="button" className={`primary-button git-provider-github-submit${startingGitHub ? " is-loading" : ""}`} onClick={() => void createGitHubApp()} disabled={startingGitHub || !storageReady} aria-busy={startingGitHub}>{startingGitHub ? <LoaderCircle size={16} className="git-providers-spin" /> : <GitProviderLogo provider="github" size={16} />}{startingGitHub ? text.startingGitHub : text.createGitHubApp}<ExternalLink size={14} /></button></footer>
          </> : <form onSubmit={save} className="git-provider-form">
          <label>{text.name}<input required maxLength={64} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={isGitHub ? "GitHub · Engineering" : `${labelFor(form.provider)} · Production`} /></label>
          <label>{text.baseUrlLabel}<input required type="url" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value.replace(/\/$/, "") })} disabled={form.provider === "github" || form.provider === "bitbucket"} placeholder={defaults[form.provider]} /></label>
          <label>{text.clientId}<input required value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })} autoComplete="off" /></label>
          <label>{text.clientSecret}{isGitHub ? <small>{t("git_provider_optional_github_secret")}</small> : null}<input type="password" value={form.clientSecret} onChange={(event) => setForm({ ...form, clientSecret: event.target.value })} autoComplete="new-password" placeholder={form.id ? text.secretPlaceholder : "••••••••••••••••"} required={!form.id && !isGitHub} /></label>
          {isGitHub ? <>
            <label>{text.appId}<input required value={form.appId} onChange={(event) => setForm({ ...form, appId: event.target.value })} autoComplete="off" /></label>
            <label>{text.appSlug}<input required value={form.appSlug} onChange={(event) => setForm({ ...form, appSlug: event.target.value })} autoComplete="off" placeholder="vessel-deployments" /></label>
            <label className="git-provider-key-field">{text.appPrivateKey}<textarea value={form.appPrivateKey} onChange={(event) => setForm({ ...form, appPrivateKey: event.target.value })} placeholder={form.id ? text.secretPlaceholder : text.privateKeyPlaceholder} required={!form.id} rows={4} spellCheck={false} autoCapitalize="off" /></label>
          </> : null}
          <div className="git-provider-callbacks"><label>{text.webhookUrl}<code>{baseUrl}/api/webhooks/git</code><small>{text.webhookEvents}</small></label></div>
          <label>{text.webhookSecret}<small>{text.webhookSecretHelp}</small><input type="password" value={form.webhookSecret} onChange={(event) => setForm({ ...form, webhookSecret: event.target.value })} autoComplete="new-password" placeholder={form.id && providers.find((item) => item.id === form.id)?.hasWebhookSecret ? text.webhookSaved : "••••••••••••••••"} /></label>
          {form.id ? <div className="git-provider-callbacks"><label>{isGitHub ? text.setup : text.callback}<code>{callbackFor(form.id)}</code></label></div> : <p className="git-provider-callback-hint"><CircleAlert size={14} />{t("git_provider_callback_hint")}</p>}
          <div className="git-provider-help"><ShieldCheck size={16} /><span>{helpFor}</span></div>
          <label className="git-provider-share-toggle"><input type="checkbox" checked={form.shareWithOrganization} onChange={(event) => setForm({ ...form, shareWithOrganization: event.target.checked })} /><span>{text.share}<small>{text.shareHelp}</small></span></label>
          <p className="git-provider-encryption"><KeyRound size={14} />{text.encrypted}</p>
          <footer className="git-provider-dialog-footer"><button type="button" className="secondary-button" onClick={form.id ? closeEditor : () => setWizardStep(1)}><ArrowLeft size={15} />{form.id ? text.cancel : text.back}</button><button type="submit" className="primary-button" disabled={saving || !storageReady}><Save size={15} />{saving ? t("git_saving") : form.id ? text.update : text.save}</button></footer>
        </form>}
        </>}
      </section></div> : null}
    {deleteId ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteId(""); }}><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="git-provider-delete-title"><span className="modal-kicker"><Trash2 size={14} />{text.connection}</span><h2 id="git-provider-delete-title"><CircleAlert size={19} />{text.deleteTitle}</h2><p>{text.deleteBody}</p><div className="modal-actions"><button type="button" onClick={() => setDeleteId("")}><X size={14} />{text.cancel}</button><button type="button" className="danger-button" onClick={() => void removeProvider()}><Trash2 size={15} />{text.confirmRemove}</button></div></section></div> : null}
  </main>;
}
