"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Boxes, Check, CircleHelp, Clock3, Copy, Eye, FileCode2, FolderTree, GitBranch, Hammer, LoaderCircle, Pause, Play, Plus, Rocket, Save, TerminalSquare, Trash2, UserRound, Workflow, X } from "lucide-react";
import { GitProviderLogo, type GitProviderBrand } from "@/app/components/GitProviderLogo";
import { notifyVessel } from "@/app/components/ToastNotice";
import { localizeProjectError } from "@/lib/project-errors";
import { DeploymentCombobox, type DeploymentComboOption } from "./DeploymentCombobox";
import { CodeLoadingSkeleton, DeploymentFormLoadingSkeleton } from "@/app/components/LoadingSkeletons";

type Provider = { id: string; provider: GitProviderBrand; name: string; accountName: string | null };
type Repository = { repository: string; fullName: string; private: boolean; defaultBranch: string };
type Inspection = { branches: string[]; composeFiles: string[]; defaultBranch: string; treeTruncated: boolean };
export type ApplicationGitSource = { id: string; name: string; repository: string; providerId: string | null; providerType: GitProviderBrand | null; providerName: string | null; branch: string; composePath: string; autoDeploy: boolean; triggerType: "push" | "tag" | "release" | "manual"; pollIntervalSeconds: number; watchPaths: string[]; enableSubmodules: boolean; lastStatus: string };

const providerNames: Record<GitProviderBrand, { es: string; en: string }> = {
  github: { es: "GitHub", en: "GitHub" },
  gitlab: { es: "GitLab", en: "GitLab" },
  bitbucket: { es: "Bitbucket", en: "Bitbucket" },
  gitea: { es: "Gitea", en: "Gitea" },
};

const composePreviewErrorsEnglish: Record<string, string> = {
  "La fuente Git no está disponible para esta cuenta": "The Git source is unavailable to this account.",
  "El repositorio no pertenece al proveedor Git conectado": "The repository does not belong to the connected Git provider.",
  "La rama Git no es válida": "The Git branch is invalid.",
  "La ruta del archivo Compose no es válida": "The Compose file path is invalid.",
  "El proveedor Git no devolvió un archivo Compose legible": "The Git provider did not return a readable Compose file.",
  "El archivo Compose está vacío o supera el máximo de 2 MB": "The Compose file is empty or exceeds the 2 MB limit.",
  "No se pudo contactar con el proveedor Git desde Vessel": "Vessel could not reach the Git provider.",
  "El proveedor rechazó la conexión; vuelve a autorizarla": "The Git provider rejected the connection. Reauthorize it.",
  "El proveedor denegó o limitó la solicitud; revisa los permisos de lectura": "The provider denied or rate limited the request. Check read permissions.",
  "No se encontró el archivo Compose en esa rama": "The Compose file was not found on that branch.",
  "No se encontró el repositorio o la conexión no tiene acceso": "The repository was not found or the connection cannot access it.",
};

function composePreviewErrorMessage(message: string, es: boolean) {
  if (es) return localizeProjectError(message, "es");
  const httpError = message.match(/^El proveedor Git respondió con HTTP (\d+)$/);
  if (httpError) return `The Git provider returned HTTP ${httpError[1]}.`;
  return composePreviewErrorsEnglish[message] ?? message;
}

export function DeploymentSettings({ projectId, serviceId, appName, providers, source, es, onSaved, onDeploy, hasContainers, hasRunningContainers, onOpenLogs }: {
  projectId: string; serviceId: string; appName: string; providers: Provider[]; source: ApplicationGitSource | null; es: boolean;
  onSaved: (source: ApplicationGitSource) => void; onDeploy: (sourceId: string, operation?: "deploy" | "rebuild" | "fresh_volumes" | "start" | "stop") => Promise<void>;
  hasContainers: boolean; hasRunningContainers: boolean; onOpenLogs: () => void;
}) {
  const [providerKind, setProviderKind] = useState<GitProviderBrand>(source?.providerType ?? providers[0]?.provider ?? "github");
  const [providerId, setProviderId] = useState(source?.providerId ?? providers[0]?.id ?? "");
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repository, setRepository] = useState(source?.repository ?? "");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [branch, setBranch] = useState(source?.branch ?? "");
  const [composePath, setComposePath] = useState(source?.composePath ?? "");
  const [autoDeploy, setAutoDeploy] = useState(source?.autoDeploy ?? true);
  const [triggerType, setTriggerType] = useState<ApplicationGitSource["triggerType"]>(source?.triggerType ?? "push");
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(source?.pollIntervalSeconds ?? 15);
  const [watchPaths, setWatchPaths] = useState<string[]>(source?.watchPaths ?? []);
  const [watchPathDraft, setWatchPathDraft] = useState("");
  const [enableSubmodules, setEnableSubmodules] = useState(source?.enableSubmodules ?? false);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [repositoriesInitialized, setRepositoriesInitialized] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionInitialized, setInspectionInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deploymentOperation, setDeploymentOperation] = useState<"deploy" | "rebuild" | "fresh_volumes" | "start" | "stop" | null>(null);
  const [freshVolumesConfirm, setFreshVolumesConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [composePreviewOpen, setComposePreviewOpen] = useState(false);
  const [composePreviewBusy, setComposePreviewBusy] = useState(false);
  const [composePreviewYaml, setComposePreviewYaml] = useState("");
  const [composePreviewError, setComposePreviewError] = useState("");
  const [composePreviewCopied, setComposePreviewCopied] = useState(false);

  useEffect(() => {
    const initialProvider = source?.providerId ? providers.find((provider) => provider.id === source.providerId) : null;
    const fallbackProvider = providers[0];
    const selectedProvider = initialProvider ?? fallbackProvider;
    setProviderKind(source?.providerType ?? selectedProvider?.provider ?? "github");
    setProviderId(source?.providerId ?? selectedProvider?.id ?? "");
    setRepository(source?.repository ?? "");
    setBranch(source?.branch ?? "");
    setComposePath(source?.composePath ?? "");
    setAutoDeploy(source?.autoDeploy ?? true);
    setTriggerType(source?.triggerType ?? (source?.autoDeploy === false ? "manual" : "push"));
    setPollIntervalSeconds(source?.pollIntervalSeconds ?? 15);
    setWatchPaths(source?.watchPaths ?? []);
    setEnableSubmodules(source?.enableSubmodules ?? false);
  }, [source, providers]);

  useEffect(() => {
    if (!providerId) { setRepositories([]); setRepositoriesInitialized(true); return; }
    let cancelled = false;
    setLoadingRepositories(true);
    setError("");
    fetch("/api/deployments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list_repositories", providerId }), cache: "no-store" })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not load repositories.", es ? "es" : "en")); return payload.data as Repository[]; })
      .then((items) => { if (!cancelled) setRepositories(items); })
      .catch((cause) => { if (!cancelled) { setRepositories([]); setError(cause instanceof Error ? cause.message : es ? "No se pudieron cargar los repositorios." : "Could not load repositories."); } })
      .finally(() => { if (!cancelled) { setLoadingRepositories(false); setRepositoriesInitialized(true); } });
    return () => { cancelled = true; };
  }, [providerId, es]);

  useEffect(() => {
    if (!providerId || !repository) { setInspection(null); setInspectionInitialized(true); return; }
    let cancelled = false;
    setInspecting(true);
    fetch("/api/deployments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "inspect_repository", providerId, repository, branch: branch || undefined }), cache: "no-store" })
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not inspect repository.", es ? "es" : "en")); return payload.data as Inspection; })
      .then((details) => {
        if (cancelled) return;
        setInspection(details);
        setBranch((current) => current && details.branches.includes(current) ? current : details.defaultBranch);
        setComposePath((current) => current || details.composeFiles[0] || "");
      })
      .catch((cause) => { if (!cancelled) { setInspection(null); setError(cause instanceof Error ? cause.message : es ? "No se pudo inspeccionar el repositorio." : "Could not inspect repository."); } })
      .finally(() => { if (!cancelled) { setInspecting(false); setInspectionInitialized(true); } });
    return () => { cancelled = true; };
  }, [providerId, repository, branch, es]);

  const providersByKind = [...new Set(providers.map((item) => item.provider))];
  const providerOptions: DeploymentComboOption[] = providersByKind.map((kind) => ({ value: kind, label: providerNames[kind][es ? "es" : "en"], icon: <GitProviderLogo provider={kind} size={17} /> }));
  const accounts = providers.filter((item) => item.provider === providerKind);
  const accountOptions: DeploymentComboOption[] = accounts.map((account) => ({ value: account.id, label: account.name, detail: account.accountName ?? undefined, icon: <GitProviderLogo provider={account.provider} size={16} /> }));
  const repositoryOptions: DeploymentComboOption[] = repositories.map((item) => ({ value: item.repository, label: item.fullName, detail: item.private ? (es ? "Repositorio privado" : "Private repository") : (es ? "Repositorio público" : "Public repository") }));
  const branchOptions: DeploymentComboOption[] = (inspection?.branches ?? []).map((item) => ({ value: item, label: item, icon: <GitBranch size={15} /> }));
  const composeOptions: DeploymentComboOption[] = (inspection?.composeFiles ?? []).map((item) => ({ value: item, label: item, detail: es ? "Archivo YAML de esta rama" : "YAML file in this branch", icon: <Boxes size={15} /> }));
  const triggerOptions: DeploymentComboOption[] = [
    { value: "push", label: es ? "Al hacer push" : "On push", detail: es ? "Push a la rama configurada" : "Push to the configured branch", icon: <GitBranch size={15} /> },
    { value: "tag", label: es ? "Al crear o actualizar un tag" : "On tag", detail: es ? "Tag nuevo del repositorio" : "New repository tag", icon: <Boxes size={15} /> },
    ...(providerKind === "bitbucket" ? [] : [{ value: "release", label: es ? "Al publicar una release" : "On release", detail: es ? "Release publicada en el proveedor" : "Release published by the provider", icon: <Rocket size={15} /> }]),
    { value: "manual", label: es ? "Solo manual" : "Manual only", detail: es ? "Despliega bajo demanda" : "Deploy on demand", icon: <Rocket size={15} /> },
  ];
  const intervalOptions: DeploymentComboOption[] = [0, 15, 30, 60, 120, 300].map((seconds) => ({
    value: String(seconds),
    label: seconds === 0
      ? (es ? "Solo webhook · sin consulta" : "Webhook only · no polling")
      : seconds < 60
      ? `${seconds} ${es ? "segundos" : "seconds"}`
      : `${seconds / 60} ${es ? seconds === 60 ? "minuto" : "minutos" : seconds === 60 ? "minute" : "minutes"}`,
    icon: <Clock3 size={15} />,
  }));
  const currentSettings = {
    providerId,
    repository,
    branch,
    composePath,
    autoDeploy,
    triggerType,
    pollIntervalSeconds,
    watchPaths,
    enableSubmodules,
  };
  const savedSettings = source ? {
    providerId: source.providerId ?? "",
    repository: source.repository,
    branch: source.branch,
    composePath: source.composePath,
    autoDeploy: source.autoDeploy,
    triggerType: source.triggerType ?? (source.autoDeploy ? "push" : "manual"),
    pollIntervalSeconds: source.pollIntervalSeconds,
    watchPaths: source.watchPaths,
    enableSubmodules: source.enableSubmodules,
  } : null;
  const hasUnsavedChanges = savedSettings
    ? JSON.stringify(currentSettings) !== JSON.stringify(savedSettings)
    : Boolean(providerId && repository && branch && composePath);

  function selectProviderKind(kind: GitProviderBrand) {
    setProviderKind(kind);
    const nextProvider = providers.find((item) => item.provider === kind);
    setProviderId(nextProvider?.id ?? "");
    setRepository(""); setInspection(null); setBranch(""); setComposePath(""); setError("");
  }

  function addWatchPath() {
    const value = watchPathDraft.trim();
    if (!value || watchPaths.includes(value) || watchPaths.length >= 20 || value.startsWith("/") || value.split(/[\\/]/).includes("..")) return;
    setWatchPaths((current) => [...current, value]);
    setWatchPathDraft("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !hasUnsavedChanges || !providerId || !repository || !branch || !composePath) return;
    setSaving(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/deployments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        action: "configure_application", projectId, serviceId, name: appName, providerId, repository, branch, composePath,
        autoDeploy, triggerType, pollIntervalSeconds, watchPaths, enableSubmodules,
      }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not save deployment settings.", es ? "es" : "en"));
      notifyVessel({ kind: "success", title: es ? "Configuración de despliegue guardada." : "Deployment settings saved." });
      onSaved(payload.data.source as ApplicationGitSource);
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo guardar la configuración." : "Could not save deployment settings."); }
    finally { setSaving(false); }
  }

  async function deployNow(operation: "deploy" | "rebuild" | "fresh_volumes" | "start" | "stop" = "deploy") {
    if (!source || deploying || source.lastStatus === "deploying") return;
    setDeploying(true); setDeploymentOperation(operation); setError(""); setNotice("");
    const title = operation === "rebuild" ? es ? "Reconstrucción iniciada" : "Rebuild started"
      : operation === "fresh_volumes" ? es ? "Recreación limpia iniciada" : "Fresh deployment started"
      : operation === "start" ? es ? "Inicio solicitado" : "Start requested"
      : operation === "stop" ? es ? "Detención solicitada" : "Stop requested"
      : es ? `Despliegue iniciado · ${appName}` : `Deployment started · ${appName}`;
    notifyVessel({
      kind: "progress",
      title,
      detail: operation === "fresh_volumes" ? es ? "Se eliminarán los volúmenes del proyecto y se desplegará de nuevo." : "Project volumes will be removed before deploying again."
        : operation === "rebuild" ? es ? "Vessel reconstruirá y recreará los servicios Compose." : "Vessel will rebuild and recreate the Compose services."
        : es ? "Vessel está validando Compose y aplicando la acción." : "Vessel is validating Compose and applying the action.",
    });
    try { await onDeploy(source.id, operation); }
    catch (cause) {
      notifyVessel({
        kind: "error",
        title: es ? `No se pudo iniciar · ${appName}` : `Could not start · ${appName}`,
        detail: cause instanceof Error ? cause.message : es ? "No se pudo iniciar el despliegue." : "Could not start the deployment.",
      });
    }
    finally { setDeploying(false); setDeploymentOperation(null); }
  }

  async function openComposePreview() {
    if (composePreviewBusy || !providerId || !repository || !branch || !composePath) return;
    setComposePreviewOpen(true);
    setComposePreviewBusy(true);
    setComposePreviewYaml("");
    setComposePreviewError("");
    setComposePreviewCopied(false);
    try {
      const response = await fetch("/api/deployments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(source
          ? { action: "preview_compose", id: source.id }
          : { action: "preview_compose", providerId, repository, branch, composePath }),
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(composePreviewErrorMessage(payload.error ?? "Could not load the Compose file.", es));
      setComposePreviewYaml(String(payload.data?.yaml ?? ""));
    } catch (cause) {
      setComposePreviewError(cause instanceof Error ? cause.message : es ? "No se pudo cargar el archivo Compose." : "Could not load the Compose file.");
    } finally { setComposePreviewBusy(false); }
  }

  async function copyComposePreview() {
    try {
      await navigator.clipboard.writeText(composePreviewYaml);
      setComposePreviewCopied(true);
      window.setTimeout(() => setComposePreviewCopied(false), 1800);
    } catch {
      notifyVessel({ kind: "error", title: es ? "No se pudo copiar el archivo Compose." : "Could not copy the Compose file." });
    }
  }

  return <section className="service-detail-panel application-deploy-panel" id="deploy-settings">
    <div className="service-detail-section-heading application-deploy-heading">
      <div><span className="module-kicker">{es ? "CONFIGURACIÓN DE DESPLIEGUE" : "DEPLOY SETTINGS"}</span><h2><Rocket size={18} />Compose</h2><p>{es ? "Define el archivo Compose y publica sus servicios en este proyecto." : "Create or select a Compose file to deploy its services."}</p></div>
      <button className="projects-secondary application-compose-preview-trigger" type="button" onClick={() => void openComposePreview()} disabled={composePreviewBusy || !providerId || !repository || !branch || !composePath} data-tooltip={composePath || (es ? "Selecciona una rama y un archivo YAML" : "Select a branch and YAML file")}>{composePreviewBusy ? <LoaderCircle size={15} className="spinning" /> : <Eye size={15} />}{es ? "Vista previa Compose" : "Preview Compose"}</button>
    </div>
    <div className="application-deploy-toolbar">
      <button className="projects-primary" type="button" onClick={() => void deployNow()} disabled={!source || deploying || source.lastStatus === "deploying"} data-tooltip={es ? "Ejecuta ahora el despliegue con la configuración guardada." : "Run a deployment now using the saved configuration."}>{deploymentOperation === "deploy" ? <LoaderCircle size={16} className="spinning" /> : <Rocket size={15} />}{deploymentOperation === "deploy" || (deploying && !deploymentOperation) ? (es ? "Desplegando…" : "Deploying…") : (es ? "Desplegar" : "Deploy")}</button>
      <button className="projects-secondary deploy-fresh-volumes" type="button" onClick={() => setFreshVolumesConfirm(true)} disabled={!source || deploying || source.lastStatus === "deploying"} data-tooltip={es ? "Elimina los volúmenes y datos persistentes antes de desplegar." : "Removes volumes and persistent data before deploying."} aria-describedby="fresh-volumes-tooltip"><Trash2 size={15} />{es ? "Volúmenes nuevos" : "Fresh volumes"}<span id="fresh-volumes-tooltip" className="sr-only">{es ? "Elimina los volúmenes y datos persistentes antes de desplegar." : "Removes volumes and persistent data before deploying."}</span></button>
      <button className="projects-secondary" type="button" onClick={() => void deployNow("rebuild")} disabled={!source || deploying || source.lastStatus === "deploying"} data-tooltip={es ? "Reconstruye las imágenes y recrea los servicios del archivo Compose." : "Rebuild images and recreate the services defined in the Compose file."}><Hammer size={15} />{deploymentOperation === "rebuild" ? (es ? "Reconstruyendo…" : "Rebuilding…") : (es ? "Reconstruir" : "Rebuild")}</button>
      {hasRunningContainers ? <button className="projects-secondary deploy-stop-action" type="button" onClick={() => void deployNow("stop")} disabled={!source || deploying || source.lastStatus === "deploying"} data-tooltip={es ? "Detiene los servicios de este despliegue de forma normal." : "Gracefully stop the services in this deployment."}><Pause size={15} />{deploymentOperation === "stop" ? (es ? "Deteniendo…" : "Stopping…") : (es ? "Detener" : "Stop")}</button> : <button className="projects-secondary" type="button" onClick={() => void deployNow("start")} disabled={!source || !hasContainers || deploying || source.lastStatus === "deploying"} data-tooltip={es ? "Inicia los servicios Compose que están detenidos." : "Start the stopped Compose services."}><Play size={15} />{deploymentOperation === "start" ? (es ? "Iniciando…" : "Starting…") : (es ? "Iniciar" : "Start")}</button>}
      <button className="projects-secondary" type="button" onClick={onOpenLogs} data-tooltip={es ? "Abre los logs de los contenedores de este servicio." : "Open logs for this service's containers."}><TerminalSquare size={15} />{es ? "Logs" : "Logs"}</button>
      <button className={`deploy-autodeploy-toggle${autoDeploy ? " is-active" : ""}`} type="button" role="switch" aria-checked={autoDeploy} onClick={() => { const enabled = !autoDeploy; setAutoDeploy(enabled); if (!enabled) setTriggerType("manual"); else if (triggerType === "manual") setTriggerType("push"); }} data-tooltip={autoDeploy ? (es ? "Desactiva los despliegues automáticos para esta fuente." : "Turn off automatic deployments for this source.") : (es ? "Activa los despliegues automáticos según el disparador configurado." : "Enable automatic deployments using the selected trigger.")}><span>{es ? "Autodespliegue" : "Autodeploy"}</span><i /></button>
    </div>
    {!providers.length ? <div className="deployment-provider-empty"><GitBranch size={20} /><div><strong>{es ? "Conecta un proveedor Git" : "Connect a Git provider"}</strong><p>{es ? "Autoriza GitHub, GitLab, Bitbucket o Gitea para cargar tus cuentas y repositorios." : "Authorize GitHub, GitLab, Bitbucket, or Gitea to load your accounts and repositories."}</p></div><Link className="projects-secondary" href="/git-providers">{es ? "Conectar proveedor" : "Connect provider"}<ArrowUpRight size={14} /></Link></div> : !repositoriesInitialized || !inspectionInitialized ? <DeploymentFormLoadingSkeleton label={es ? "Cargando la configuración de despliegue" : "Loading deployment settings"} /> : <form className="application-deploy-form" onSubmit={save}>
      <section className="deploy-form-section">
        <div className="deploy-form-section-heading"><span className="deploy-step-icon"><GitBranch size={16} /></span><div><strong>{es ? "Origen del código" : "Code source"}</strong><small>{es ? "Selecciona una conexión Git autorizada." : "Choose an authorized Git connection."}</small></div></div>
        <div className="application-deploy-fields">
          <div className="modal-field deploy-combobox-field"><span className="deploy-field-label"><GitBranch size={15} />{es ? "Proveedor" : "Provider"}</span><DeploymentCombobox label={es ? "Proveedor Git" : "Git provider"} value={providerKind} options={providerOptions} placeholder={es ? "Seleccionar proveedor" : "Select provider"} searchPlaceholder={es ? "Buscar proveedor…" : "Search provider…"} disabled={!providerOptions.length} es={es} onChange={(next) => selectProviderKind(next as GitProviderBrand)} /></div>
          <div className="modal-field deploy-combobox-field"><span className="deploy-field-label"><UserRound size={15} />{es ? "Cuenta" : "Account"}</span><DeploymentCombobox label={es ? "Cuenta Git" : "Git account"} value={providerId} options={accountOptions} placeholder={es ? "Seleccionar cuenta" : "Select account"} searchPlaceholder={es ? "Buscar cuenta…" : "Search account…"} disabled={!accounts.length} es={es} onChange={(next) => { setProviderId(next); setRepository(""); setInspection(null); setBranch(""); setComposePath(""); }} /></div>
        </div>
        <div className="application-deploy-fields deploy-repository-row"><div className="modal-field deploy-combobox-field"><span className="deploy-field-label"><BookOpen size={15} />{es ? "Repositorio" : "Repository"}{repository ? <a href={repository} target="_blank" rel="noreferrer">{es ? "Abrir" : "Open"}<ArrowUpRight size={12} /></a> : null}</span><DeploymentCombobox label={es ? "Repositorio" : "Repository"} value={repository} options={repositoryOptions} placeholder={loadingRepositories ? (es ? "Cargando repositorios…" : "Loading repositories…") : es ? "Seleccionar repositorio" : "Select repository"} searchPlaceholder={es ? "Buscar repositorio…" : "Search repository…"} loading={loadingRepositories} disabled={!providerId || !repositories.length} es={es} onChange={(next) => { setRepository(next); setInspection(null); setBranch(""); setComposePath(""); }} /></div></div>
      </section>
      <section className="deploy-form-section">
        <div className="deploy-form-section-heading"><span className="deploy-step-icon"><Boxes size={16} /></span><div><strong>{es ? "Configuración Compose" : "Compose configuration"}</strong><small>{es ? "Elige una rama y el archivo que Vessel desplegará." : "Choose a branch and the file Vessel will deploy."}</small></div></div>
        <div className="application-deploy-fields application-deploy-fields--split">
          <div className="modal-field deploy-combobox-field"><span className="deploy-field-label"><GitBranch size={15} />{es ? "Rama" : "Branch"}</span><DeploymentCombobox label={es ? "Rama" : "Branch"} value={branch} options={branchOptions} placeholder={inspecting ? (es ? "Cargando ramas…" : "Loading branches…") : es ? "Seleccionar rama" : "Select branch"} searchPlaceholder={es ? "Buscar rama…" : "Search branch…"} loading={inspecting} disabled={!inspection} es={es} onChange={setBranch} /></div>
          <div className="modal-field deploy-combobox-field"><span className="deploy-field-label"><FileCode2 size={15} />{es ? "Archivo Compose" : "Compose file"}<button className="deploy-help-tip" type="button" aria-label={es ? "Ayuda sobre el archivo Compose" : "Help about the Compose file"} title={es ? "Busca archivos .yml o .yaml detectados en la rama, o escribe una ruta propia, por ejemplo epale.yml." : "Search detected .yml or .yaml files in the branch, or enter your own path, for example epale.yml."}><CircleHelp size={16} /></button></span><DeploymentCombobox label={es ? "Ruta del archivo YAML" : "YAML file path"} value={composePath} options={composeOptions} placeholder={es ? "Buscar o escribir la ruta del archivo" : "Search or enter a file path"} searchPlaceholder={es ? "Buscar archivos YAML…" : "Search YAML files…"} disabled={!repository || inspecting} allowCustom es={es} onChange={setComposePath} /></div>
        </div>
        {inspection?.treeTruncated ? <p className="deployment-inspection-note">{es ? "La lista de archivos es parcial; puedes escribir la ruta completa del Compose." : "The file list is partial; you can enter the full Compose path."}</p> : null}
        {inspection && !inspection.composeFiles.length ? <p className="deployment-inspection-note is-warning">{es ? "No hay archivos YAML en la lista. Aun así, puedes escribir la ruta del Compose que quieras usar." : "No YAML files were listed. You can still enter the path to the Compose file you want to use."}</p> : null}
      </section>
      <section className="deploy-form-section" id="deploy-automation">
        <div className="deploy-form-section-heading"><span className="deploy-step-icon"><Workflow size={16} /></span><div><strong>{es ? "Automatización" : "Automation"}</strong><small>{es ? "Define cuándo revisar cambios del repositorio." : "Choose when Vessel checks for repository changes."}</small></div></div>
        <div className="application-deploy-fields application-deploy-fields--split">
          <div className="modal-field deploy-combobox-field"><span className="deploy-field-label"><Workflow size={15} />{es ? "Disparador" : "Trigger"}</span><DeploymentCombobox label={es ? "Tipo de disparador" : "Trigger type"} value={triggerType} options={triggerOptions} placeholder={es ? "Seleccionar disparador" : "Select trigger"} searchPlaceholder={es ? "Buscar opción…" : "Search option…"} es={es} onChange={(next) => { const value = next as ApplicationGitSource["triggerType"]; setTriggerType(value); setAutoDeploy(value !== "manual"); }} /></div>
          {autoDeploy ? <div className="modal-field deploy-combobox-field"><span className="deploy-field-label"><Clock3 size={15} />{es ? "Frecuencia de revisión" : "Check frequency"}</span><DeploymentCombobox label={es ? "Frecuencia de revisión" : "Check frequency"} value={String(pollIntervalSeconds)} options={intervalOptions} placeholder={es ? "Seleccionar frecuencia" : "Select frequency"} searchPlaceholder={es ? "Buscar frecuencia…" : "Search frequency…"} es={es} onChange={(next) => setPollIntervalSeconds(Number(next))} /></div> : null}
        </div>
        {autoDeploy ? <p className="deployment-inspection-note">{pollIntervalSeconds === 0 ? (es ? "Solo webhook: Vessel valida la firma antes de iniciar el despliegue. Configura la URL y el secreto en el proveedor Git." : "Webhook only: Vessel validates the signature before deploying. Configure the URL and secret at your Git provider.") : (es ? "Vessel procesa webhooks al instante cuando el servidor es alcanzable y consulta el proveedor con la frecuencia elegida como respaldo para servidores privados." : "Vessel processes webhooks immediately when reachable and polls at the selected interval as a fallback for private servers.")}{triggerType === "release" ? (es ? " En release despliega el tag publicado más reciente." : " On release, Vessel deploys the latest published tag.") : triggerType === "tag" ? (es ? " En tag despliega el commit etiquetado." : " On tag, Vessel deploys the tagged commit.") : ""}</p> : null}
        <div className="deploy-watch-paths"><div className="deploy-field-heading"><strong><FolderTree size={15} />{es ? "Rutas vigiladas" : "Watch paths"}<span>{es ? "Opcional" : "Optional"}</span></strong><small>{es ? "Despliega automáticamente solo si cambia una de estas rutas." : "Deploy automatically only when one of these paths changes."}</small></div><div className="deploy-watch-input"><input value={watchPathDraft} onChange={(event) => setWatchPathDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addWatchPath(); } }} placeholder="src/**, dist/*.js" maxLength={256} /><button className="projects-secondary" type="button" onClick={addWatchPath} disabled={!watchPathDraft.trim() || watchPaths.length >= 20}><Plus size={14} />{es ? "Añadir ruta" : "Add path"}</button></div>{watchPaths.length ? <div className="deploy-watch-list">{watchPaths.map((path) => <span key={path}><code>{path}</code><button type="button" onClick={() => setWatchPaths((current) => current.filter((item) => item !== path))} aria-label={`${es ? "Quitar" : "Remove"} ${path}`}><X size={13} /></button></span>)}</div> : null}</div>
        <label className="deploy-submodules-toggle"><input type="checkbox" checked={enableSubmodules} onChange={(event) => setEnableSubmodules(event.target.checked)} /><span className="deploy-submodules-icon"><Boxes size={16} /></span><span><strong>{es ? "Incluir submódulos Git" : "Include Git submodules"}</strong><small>{es ? "Se inicializan al clonar el repositorio." : "Initialized when Vessel clones the repository."}</small></span></label>
      </section>
      {error ? <div className="projects-notice is-error" role="alert">{error}</div> : null}{notice ? <div className="projects-notice is-success" role="status"><Check size={15} />{notice}</div> : null}
      <div className="application-deploy-form-footer"><span>{inspection ? <><GitBranch size={13} />{es ? `${inspection.branches.length} ramas · ${inspection.composeFiles.length} archivos YAML` : `${inspection.branches.length} branches · ${inspection.composeFiles.length} YAML files`}</> : inspecting ? <><LoaderCircle size={13} className="spinning" />{es ? "Revisando repositorio…" : "Inspecting repository…"}</> : <><Check size={13} />{es ? "Credenciales protegidas por Vessel" : "Credentials protected by Vessel"}</>}</span><button className="projects-primary" type="submit" disabled={saving || inspecting || !hasUnsavedChanges || !providerId || !repository || !branch || !composePath}>{saving ? <LoaderCircle size={15} className="spinning" /> : source ? <Save size={15} /> : <Check size={15} />}{saving ? (es ? "Guardando…" : "Saving…") : es ? "Guardar cambios" : "Save settings"}</button></div>
    </form>}
    {freshVolumesConfirm && typeof document !== "undefined" ? createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deploying) setFreshVolumesConfirm(false); }}><section className="confirm-modal project-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="fresh-volumes-title"><span className="module-kicker">{es ? "ACCIÓN DESTRUCTIVA" : "DESTRUCTIVE ACTION"}</span><h2 id="fresh-volumes-title"><Trash2 size={18} />{es ? "¿Desplegar con volúmenes nuevos?" : "Deploy with fresh volumes?"}</h2><p>{es ? "Docker Compose eliminará los volúmenes del proyecto y sus datos persistentes antes de desplegarlo de nuevo. Esta acción no se puede deshacer." : "Docker Compose will remove this project's volumes and persistent data before deploying again. This cannot be undone."}</p><div className="modal-actions"><button type="button" onClick={() => setFreshVolumesConfirm(false)} disabled={deploying}><X size={15} />{es ? "Cancelar" : "Cancel"}</button><button className="danger-button" type="button" onClick={() => { setFreshVolumesConfirm(false); void deployNow("fresh_volumes"); }} disabled={deploying}><Trash2 size={15} />{es ? "Eliminar y desplegar" : "Remove and deploy"}</button></div></section></div>, document.body) : null}
    {composePreviewOpen && typeof document !== "undefined" ? createPortal(<div className="modal-backdrop compose-preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !composePreviewBusy) setComposePreviewOpen(false); }}><section className="confirm-modal compose-preview-modal" role="dialog" aria-modal="true" aria-labelledby="application-compose-preview-title"><header className="compose-preview-heading"><span className="compose-preview-mark"><Boxes size={20} /></span><div><span className="module-kicker">{es ? "ARCHIVO DEL REPOSITORIO" : "REPOSITORY FILE"}</span><h2 id="application-compose-preview-title">{es ? "Vista previa Compose" : "Compose preview"}</h2><p>{repository && branch && composePath ? `${repository} · ${branch} · ${composePath}` : ""}</p></div><button className="compose-preview-close" type="button" onClick={() => setComposePreviewOpen(false)} disabled={composePreviewBusy} aria-label={es ? "Cerrar vista previa" : "Close preview"}><X size={18} /></button></header>
      <p className="compose-preview-note">{es ? "Contenido del archivo YAML seleccionado en la rama elegida. Los valores se muestran tal como están en el repositorio." : "Contents of the selected YAML file in the chosen branch. Values are shown as stored in the repository."}</p>
      {composePreviewError ? <div className="compose-preview-error" role="alert"><X size={16} /><div><strong>{composePreviewError}</strong></div></div> : null}
      {composePreviewBusy ? <div className="compose-preview-loading"><CodeLoadingSkeleton /></div> : composePreviewYaml && !composePreviewError ? <pre className="compose-preview-code">{composePreviewYaml}</pre> : null}
      <footer className="compose-preview-actions"><button type="button" onClick={() => setComposePreviewOpen(false)} disabled={composePreviewBusy}>{es ? "Cerrar" : "Close"}</button><button className="primary-button" type="button" onClick={() => void copyComposePreview()} disabled={composePreviewBusy || !composePreviewYaml || Boolean(composePreviewError)}>{composePreviewCopied ? <Check size={15} /> : <Copy size={15} />}{composePreviewCopied ? (es ? "Copiado" : "Copied") : (es ? "Copiar YAML" : "Copy YAML")}</button></footer>
    </section></div>, document.body) : null}
  </section>;
}
