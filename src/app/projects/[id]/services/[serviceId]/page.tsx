"use client";
import VesselSelect from "@/app/components/VesselSelect";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowLeft, ArrowRight, ArrowUpRight, Ban, Boxes, Check, ChevronDown, CircleAlert, Clock3, Container, Copy, Database, Eraser, FileCode2, GitBranch, Globe, Image as ImageIcon, ListRestart, Network, RefreshCw, Scissors, ScrollText, ShieldCheck, Sparkles, Trash2, Webhook, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { localizeProjectError } from "@/lib/project-errors";
import { notifyVessel } from "@/app/components/ToastNotice";
import { DeploymentSettings, type ApplicationGitSource } from "./DeploymentSettings";
import { PageLoadingSkeleton } from "@/app/components/LoadingSkeletons";

type Runtime = { id: string; serviceId: string; name: string; image: string; status: string; statusText: string; ports: Array<{ host: number | null; container: number; protocol: string }>; networks: string[]; environmentNames: string[]; restartPolicy: string; composeService: string | null; createdAt: string | null };
type Run = { id: string; status: string; phase: string; trigger: "manual" | "automatic"; commit: string | null; commitTitle: string | null; startedAt: string; finishedAt: string | null; error: string | null };
type DeploymentLogView = { logs: string; loading: boolean; error: string };
type AIAvailableConfig = { id: string; name: string; model: string; provider: string };
type DeploymentAction = "clear_history" | "kill_build" | "cancel_queue";
type ServiceData = { id: string; name: string; appName: string; description: string; kind: string; targetType: string | null; targetRef: string | null };
type GitProvider = { id: string; provider: "github" | "gitlab" | "bitbucket" | "gitea"; name: string; accountName: string | null };
type Payload = { project: { id: string; name: string }; service: ServiceData; resources: Runtime[]; deployments: Run[]; gitSource: (ApplicationGitSource & { webhookReady: boolean }) | null; providers: GitProvider[] };
type Tab = "general" | "environment" | "deployments" | "containers" | "logs";

const tabIcons = { general: FileCode2, environment: ShieldCheck, deployments: GitBranch, containers: Container, logs: ScrollText };

function runDuration(run: Run, es: boolean) {
  if (run.status === "queued" || run.status === "running") return es ? "En curso" : "In progress";
  if (!run.finishedAt) return "—";
  const seconds = Math.max(0, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000));
  if (seconds < 60) return es ? `${seconds} s` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return es ? `${minutes} min ${remainder} s` : `${minutes}m ${remainder}s`;
}

function deploymentErrorLabel(message: string | null, language: "es" | "en") {
  if (!message) return language === "es" ? "Revisa los logs de esta ejecución para conocer el motivo." : "Review this run's logs for details.";
  const english: Record<string, string> = {
    "El proveedor Git no respondió o Vessel no tiene permiso de lectura del repositorio": "The Git provider did not respond or Vessel cannot read the repository.",
    "Falló la validación o el despliegue Compose. Revisa los logs de Docker y la configuración del proyecto.": "Compose validation or deployment failed. Review the deployment logs and project configuration.",
    "Vessel reinició durante este despliegue. Verifica el estado del proyecto en Docker antes de volver a desplegar.": "Vessel restarted during this deployment. Check the Docker project before deploying again.",
  };
  if (language === "en") return english[message] ?? message;
  if (message === english["El proveedor Git no respondió o Vessel no tiene permiso de lectura del repositorio"]) return "El proveedor Git no respondió o Vessel no tiene permiso de lectura del repositorio.";
  return localizeProjectError(message, language);
}

export default function ProjectServicePage() {
  const params = useParams<{ id: string; serviceId: string }>();
  const projectId = decodeURIComponent(params.id);
  const serviceId = decodeURIComponent(params.serviceId);
  const { language } = useI18n();
  const es = language === "es";
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<Tab>("general");
  const [selectedContainer, setSelectedContainer] = useState("");
  const [logs, setLogs] = useState("");
  const [logsBusy, setLogsBusy] = useState(false);
  const [expandedDeploymentId, setExpandedDeploymentId] = useState<string | null>(null);
  const [deploymentLogViews, setDeploymentLogViews] = useState<Record<string, DeploymentLogView>>({});
  const [aiPanelOpen, setAIPanelOpen] = useState(false);
  const [aiConfigs, setAIConfigs] = useState<AIAvailableConfig[]>([]);
  const [aiConfigId, setAIConfigId] = useState("");
  const [aiLoading, setAILoading] = useState(false);
  const [aiAnalysis, setAIAnalysis] = useState("");
  const [aiError, setAIError] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [pendingDeploymentAction, setPendingDeploymentAction] = useState<DeploymentAction | null>(null);
  const [deploymentActionBusy, setDeploymentActionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const deploymentStatuses = useRef<Map<string, string> | null>(null);
  const gitSourceStatus = useRef<string | null>(null);
  const pendingManualDeploymentNotice = useRef(false);
  const progressNotifiedRunId = useRef<string | null>(null);
  const expandedDeployment = data?.deployments.find((run) => run.id === expandedDeploymentId) ?? null;
  const expandedDeploymentStatus = expandedDeployment?.status;

  async function load(silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/projects?id=${encodeURIComponent(projectId)}&serviceId=${encodeURIComponent(serviceId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not read the project service.", language));
      const nextData = payload.data as Payload;
      const previousStatuses = deploymentStatuses.current;
      const previousSourceStatus = gitSourceStatus.current;
      const sourceIsDeploying = nextData.gitSource?.lastStatus === "deploying";
      const activeRun = nextData.deployments.find((run) => run.status === "queued" || run.status === "running");
      const previousRunStatus = activeRun ? previousStatuses?.get(activeRun.id) : undefined;
      const newActiveRun = activeRun && (previousStatuses === null || (previousRunStatus !== "queued" && previousRunStatus !== "running"));
      const sourceJustStarted = sourceIsDeploying && previousSourceStatus !== "deploying";
      if (activeRun && (newActiveRun || sourceJustStarted) && !pendingManualDeploymentNotice.current && progressNotifiedRunId.current !== activeRun.id) {
        const automatic = activeRun.trigger === "automatic";
        progressNotifiedRunId.current = activeRun.id;
        notifyVessel({
          kind: "progress",
          title: automatic
            ? es ? `Cambio detectado · ${nextData.service.name}` : `Change detected · ${nextData.service.name}`
            : es ? `Despliegue en curso · ${nextData.service.name}` : `Deployment in progress · ${nextData.service.name}`,
          detail: automatic
            ? es
              ? `Vessel detectó cambios en ${nextData.gitSource?.branch ?? "la rama"} y está desplegando el servicio.`
              : `Vessel detected changes on ${nextData.gitSource?.branch ?? "the branch"} and is deploying the service.`
            : es
              ? "Vessel está validando Compose y aplicando los cambios."
              : "Vessel is validating Compose and applying the changes.",
        });
      }
      gitSourceStatus.current = nextData.gitSource?.lastStatus ?? null;
      const completedRun = nextData.deployments
        .filter((run) => run.status === "succeeded" || run.status === "failed")
        .find((run) => {
          const previous = previousStatuses?.get(run.id);
          return previous === "queued" || previous === "running" || (previousStatuses !== null && !previousStatuses.has(run.id)) || (pendingManualDeploymentNotice.current && !previousStatuses?.has(run.id));
        });
      if (completedRun) {
        const succeeded = completedRun.status === "succeeded";
        notifyVessel({
          kind: succeeded ? "success" : "error",
          title: succeeded
            ? (es ? `Despliegue completado · ${nextData.service.name}` : `Deployment completed · ${nextData.service.name}`)
            : (es ? `Despliegue fallido · ${nextData.service.name}` : `Deployment failed · ${nextData.service.name}`),
          detail: succeeded
            ? (es ? "El servicio quedó desplegado correctamente." : "The service was deployed successfully.")
            : deploymentErrorLabel(completedRun.error, language),
        });
        pendingManualDeploymentNotice.current = false;
      }
      deploymentStatuses.current = new Map(nextData.deployments.map((run) => [run.id, run.status]));
      setData(nextData);
      setSelectedContainer((current) => nextData.resources.some((item) => item.serviceId === current) ? current : nextData.resources[0]?.serviceId ?? "");
    } catch (loadError) { setError(loadError instanceof Error ? localizeProjectError(loadError.message, language) : es ? "No se pudo cargar el servicio." : "Could not load service."); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => { void load(); }, [projectId, serviceId]);

  useEffect(() => { setWebhookUrl(`${window.location.origin}/api/webhooks/git`); }, []);

  async function copyWebhookUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      notifyVessel({ kind: "success", title: es ? "URL copiada" : "URL copied", detail: webhookUrl });
    } catch {
      notifyVessel({ kind: "error", title: es ? "No se pudo copiar la URL" : "Could not copy URL" });
    }
  }

  useEffect(() => {
    if (!data?.gitSource) return;
    const interval = data.gitSource.lastStatus === "deploying" ? 2000 : 10_000;
    const timer = window.setInterval(() => { void load(true); }, interval);
    return () => window.clearInterval(timer);
  }, [projectId, serviceId, data?.gitSource?.id, data?.gitSource?.lastStatus]);

  useEffect(() => {
    if (!expandedDeploymentId || (expandedDeploymentStatus !== "queued" && expandedDeploymentStatus !== "running")) return;
    const timer = window.setInterval(() => { void loadDeploymentLogs(expandedDeploymentId); }, 2500);
    return () => window.clearInterval(timer);
  }, [expandedDeploymentId, expandedDeploymentStatus, language]);

  async function deployApplication(sourceId: string, operation: "deploy" | "rebuild" | "fresh_volumes" | "start" | "stop" = "deploy") {
    pendingManualDeploymentNotice.current = true;
    try {
      const response = await fetch("/api/deployments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sync", id: sourceId, operation }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not start deployment.", language));
      await load(true);
    } catch (cause) {
      pendingManualDeploymentNotice.current = false;
      throw cause;
    }
  }

  async function loadDeploymentLogs(deploymentId: string) {
    setDeploymentLogViews((current) => ({ ...current, [deploymentId]: { logs: current[deploymentId]?.logs ?? "", loading: true, error: "" } }));
    try {
      const response = await fetch(`/api/deployments?deploymentId=${encodeURIComponent(deploymentId)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not read deployment logs.", language));
      setDeploymentLogViews((current) => ({ ...current, [deploymentId]: { logs: payload.data.logs ?? "", loading: false, error: "" } }));
    } catch (logError) {
      setDeploymentLogViews((current) => ({ ...current, [deploymentId]: { logs: current[deploymentId]?.logs ?? "", loading: false, error: logError instanceof Error ? logError.message : (es ? "No se pudieron cargar los logs." : "Could not load deployment logs.") } }));
    }
  }

  function toggleDeploymentLogs(deploymentId: string) {
    if (expandedDeploymentId === deploymentId) {
      setExpandedDeploymentId(null);
      return;
    }
    setExpandedDeploymentId(deploymentId);
    void loadDeploymentLogs(deploymentId);
    setAIPanelOpen(false); setAIAnalysis(""); setAIError("");
    void loadAIConfigurations();
  }

  async function loadAIConfigurations() {
    try {
      const response = await fetch("/api/ai?available=1", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      const options = (payload.configurations ?? []) as AIAvailableConfig[];
      setAIConfigs(options);
      if (options.length) setAIConfigId((current) => options.some((option) => option.id === current) ? current : options[0].id);
    } catch { setAIConfigs([]); }
  }

  async function analyzeDeploymentLogs() {
    if (!expandedDeployment || !aiConfigId) return;
    setAILoading(true); setAIError(""); setAIAnalysis("");
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "analyze", configurationId: aiConfigId, logs: activeDeploymentLogText, language }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudo analizar estos logs." : "Could not analyze these logs."));
      setAIAnalysis(payload.analysis ?? "");
    } catch (cause) { setAIError(cause instanceof Error ? cause.message : es ? "No se pudo analizar estos logs." : "Could not analyze these logs."); }
    finally { setAILoading(false); }
  }

  async function runDeploymentAction(action: DeploymentAction) {
    if (!data?.gitSource) return;
    setDeploymentActionBusy(true);
    try {
      const response = await fetch("/api/deployments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id: data.gitSource.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not complete deployment action.", language));
      const amount = payload.data?.cleared ?? payload.data?.cancelled;
      const title = action === "clear_history" ? es ? "Historial limpiado" : "Deployment history cleared" : action === "cancel_queue" ? es ? "Cola cancelada" : "Queue cancelled" : es ? "Detención solicitada" : "Stop requested";
      const detail = action === "kill_build" ? es ? "Se envió la señal de detención a la compilación Compose activa." : "A stop signal was sent to the active Compose build." : es ? `${amount ?? 0} ${action === "clear_history" ? "ejecuciones eliminadas" : "despliegues cancelados"}.` : `${amount ?? 0} ${action === "clear_history" ? "runs removed" : "deployments cancelled"}.`;
      notifyVessel({ kind: "success", title, detail });
      setPendingDeploymentAction(null);
      await load(true);
    } catch (actionError) {
      notifyVessel({ kind: "error", title: es ? "No se pudo completar la acción" : "Action failed", detail: actionError instanceof Error ? actionError.message : undefined });
    } finally { setDeploymentActionBusy(false); }
  }

  async function loadLogs() {
    if (!selectedContainer) return;
    setLogsBusy(true); setLogs("");
    try {
      const response = await fetch(`/api/logs?serviceId=${encodeURIComponent(selectedContainer)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not read logs", language));
      setLogs(payload.data ?? "");
    } catch (logError) { setLogs(logError instanceof Error ? localizeProjectError(logError.message, language) : es ? "No se pudieron leer los logs." : "Could not read logs."); }
    finally { setLogsBusy(false); }
  }

  async function unlink() {
    setBusy(true);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove_service", projectId, serviceId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not remove project link.", language));
      window.location.assign(`/projects/${encodeURIComponent(projectId)}`);
    } catch (unlinkError) { setError(unlinkError instanceof Error ? localizeProjectError(unlinkError.message, language) : es ? "No se pudo quitar la asociación." : "Could not remove project link."); setUnlinkOpen(false); }
    finally { setBusy(false); }
  }

  const selected = data?.resources.find((item) => item.serviceId === selectedContainer) ?? data?.resources[0] ?? null;
  const logicalApplication = data?.service.kind === "application";
  const sourceLink = data?.service.targetType === "compose" && data.service.targetRef ? `/compose?project=${encodeURIComponent(data.service.targetRef)}` : data?.service.targetType === "git" ? "/deployments" : "/containers";
  const deploymentStatusLabel = (status: string) => ({ failed: es ? "Fallido" : "Failed", deploying: es ? "En curso" : "In progress", deployed: es ? "Desplegado" : "Deployed", idle: es ? "Listo" : "Ready", "update-available": es ? "Actualización disponible" : "Update available" }[status] ?? status);
  const runStatusLabel = (status: string) => ({ queued: es ? "En cola" : "Queued", running: es ? "En curso" : "Running", succeeded: es ? "Completado" : "Succeeded", failed: es ? "Fallido" : "Failed", cancelled: es ? "Cancelado" : "Cancelled" }[status] ?? status);
  const runPhaseLabel = (phase: string) => ({
    queued: es ? "En cola" : "Queued",
    checking_remote: es ? "Consultando repositorio" : "Checking repository",
    syncing_repository: es ? "Sincronizando código" : "Syncing repository",
    validating_compose: es ? "Validando Compose" : "Validating Compose",
    cleaning_volumes: es ? "Eliminando volúmenes" : "Removing volumes",
    rebuilding: es ? "Reconstruyendo servicios" : "Rebuilding services",
    starting: es ? "Iniciando servicios" : "Starting services",
    stopping: es ? "Deteniendo servicios" : "Stopping services",
    building_and_deploying: es ? "Construyendo y desplegando" : "Building and deploying",
    completed: es ? "Completado" : "Completed",
    failed: es ? "Fallido" : "Failed",
    cancelled: es ? "Cancelado" : "Cancelled",
  }[phase] ?? phase);
  const queuedDeploymentCount = data?.deployments.filter((run) => run.status === "queued").length ?? 0;
  const activeBuild = data?.deployments.some((run) => run.status === "running" && run.phase === "building_and_deploying") ?? false;
  const activeDeploymentLogView = expandedDeploymentId ? deploymentLogViews[expandedDeploymentId] : undefined;
  const activeDeploymentLogText = activeDeploymentLogView?.error || (activeDeploymentLogView?.loading && !activeDeploymentLogView.logs ? (es ? "Cargando logs…" : "Loading logs…") : activeDeploymentLogView?.logs || (es ? "No hay salida guardada para esta ejecución." : "No output was recorded for this run."));
  const activeDeploymentLogLines = activeDeploymentLogText.split(/\r?\n/).filter(Boolean);
  const deploymentActionDialog = pendingDeploymentAction ? {
    clear_history: { title: es ? "¿Limpiar el historial?" : "Clear deployment history?", detail: es ? "Se eliminarán las ejecuciones terminadas de esta fuente. Las ejecuciones activas y en cola se conservarán." : "Finished runs for this source will be removed. Active and queued runs will remain." },
    kill_build: { title: es ? "¿Detener la compilación?" : "Stop the active build?", detail: es ? "Vessel enviará una señal de detención al proceso Docker Compose activo. Los recursos que ya existan no se borrarán." : "Vessel will send a stop signal to the active Docker Compose process. Existing resources will not be removed." },
    cancel_queue: { title: es ? "¿Cancelar los despliegues en cola?" : "Cancel queued deployments?", detail: es ? "Se cancelarán las ejecuciones pendientes de esta fuente. El despliegue que está ejecutándose continuará." : "Pending runs for this source will be cancelled. The currently running deployment will continue." },
  }[pendingDeploymentAction] : null;
  const kindLabel = (kind: string) => ({ application: es ? "Aplicación" : "Application", database: es ? "Base de datos" : "Database", compose: "Compose", template: es ? "Plantilla" : "Template", assistant: es ? "Asistente IA" : "AI Assistant", import: es ? "Importado" : "Imported", git: es ? "Despliegue Git" : "Git deployment" }[kind] ?? kind);
  const detailMetrics = data?.service.kind === "application" ? [
    { label: es ? "Tipo" : "Type", value: kindLabel("application") },
    { label: "App Name", value: data.service.appName || "—" },
    { label: es ? "Proyecto" : "Project", value: data.project.name },
    { label: es ? "Fuente de despliegue" : "Deployment source", value: data.gitSource?.repository ?? (es ? "Sin configurar" : "Not configured") },
  ] : [
    { label: es ? "Tipo" : "Type", value: data ? kindLabel(data.service.kind) : "—" },
    { label: es ? "Recursos activos" : "Connected resources", value: String(data?.resources.length ?? 0) },
    { label: es ? "Redes" : "Networks", value: [...new Set(data?.resources.flatMap((item) => item.networks) ?? [])].join(", ") || "—" },
    { label: es ? "Política de reinicio" : "Restart policy", value: selected?.restartPolicy ?? "—" },
  ];

  if (loading) return <main className="module-main"><PageLoadingSkeleton label={es ? "Cargando servicio…" : "Loading service…"} /></main>;
  if (!data) return <main className="module-main"><Link className="project-back-link" href={`/projects/${encodeURIComponent(projectId)}`}><ArrowLeft size={16} />{es ? "Volver al proyecto" : "Back to project"}</Link><section className="project-load-error"><span><RefreshCw size={20} /></span><h1>{es ? "No se pudo abrir el servicio" : "Could not open service"}</h1><p>{error || (es ? "No se encontró el servicio." : "Service not found.")}</p><button className="projects-secondary" type="button" onClick={() => void load()}><RefreshCw size={15} />{es ? "Reintentar" : "Retry"}</button></section></main>;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "general", label: es ? "General" : "General" },
    { id: "environment", label: es ? "Entorno" : "Environment" },
    { id: "deployments", label: es ? "Despliegues" : "Deployments" },
    { id: "containers", label: es ? "Contenedores" : "Containers" },
    { id: "logs", label: es ? "Logs" : "Logs" },
  ];

  return <main className="module-main vessel-service-detail">
    <Link className="project-back-link" href={`/projects/${encodeURIComponent(projectId)}`}><ArrowLeft size={16} />{data.project.name}</Link>
    <header className="service-detail-header"><div className="service-detail-identity"><span className="service-detail-mark">{data.service.kind === "database" ? <Database size={22} /> : data.service.kind === "git" ? <GitBranch size={22} /> : data.service.kind === "compose" ? <Boxes size={22} /> : logicalApplication ? <Globe size={22} /> : <Container size={22} />}</span><div><span className="module-kicker">{kindLabel(data.service.kind).toUpperCase()}</span><h1>{data.service.name}</h1>{data.service.appName ? <code className="service-app-name">{data.service.appName}</code> : null}<p>{data.service.description || (es ? "Configuración del servicio dentro del proyecto." : "Service settings within this project.")}</p></div></div><div className="service-detail-actions">{logicalApplication ? <button className="projects-secondary" type="button" onClick={() => { setTab("general"); window.setTimeout(() => document.getElementById("deploy-settings")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}><GitBranch size={15} />{es ? "Configurar despliegue" : "Deploy Settings"}</button> : data.service.targetType !== "git" ? <Link className="projects-secondary" href={sourceLink}>{es ? "Abrir administrador" : "Open manager"}<ArrowUpRight size={15} /></Link> : null}<button className="projects-secondary service-unlink-button" type="button" onClick={() => setUnlinkOpen(true)}><Trash2 size={15} />{es ? "Quitar del proyecto" : "Remove from project"}</button></div></header>

    <nav className="service-detail-tabs" role="tablist" aria-label={es ? "Configuración del servicio" : "Service configuration"}>{tabs.map(({ id: tabId, label }) => { const Icon = tabIcons[tabId]; return <button type="button" role="tab" aria-selected={tab === tabId} className={tab === tabId ? "active" : ""} key={tabId} onClick={() => setTab(tabId)}><Icon size={16} />{label}{tabId === "containers" && data.resources.length ? <span>{data.resources.length}</span> : null}</button>; })}</nav>
    {error ? <div className="projects-notice" role="alert">{error}</div> : null}

    <div key={tab} className="service-detail-tab-content" role="tabpanel">
    {tab === "general" ? <>{logicalApplication ? <DeploymentSettings projectId={projectId} serviceId={serviceId} appName={data.service.appName} providers={data.providers} source={data.gitSource} es={es} hasContainers={data.resources.length > 0} hasRunningContainers={data.resources.some((resource) => resource.status === "running" || resource.status === "unhealthy")} onOpenLogs={() => { setTab("logs"); if (selectedContainer) void loadLogs(); }} onSaved={(source) => setData((current) => current ? { ...current, service: { ...current.service, targetType: "git", targetRef: source.id }, gitSource: { ...source, webhookReady: current.gitSource?.webhookReady ?? false } } : current)} onDeploy={deployApplication} /> : null}{!logicalApplication ? <section className="service-detail-panel"><div className="service-detail-section-heading"><div><span className="module-kicker">{es ? "ESTADO DEL SERVICIO" : "SERVICE STATUS"}</span><h2>{es ? "General" : "General"}</h2></div><span className={`project-resource-state${data.resources.length ? " is-linked" : ""}`}><i />{data.resources.length ? es ? "Recurso conectado" : "Resource connected" : data.gitSource?.lastStatus === "failed" ? es ? "Despliegue fallido" : "Deployment failed" : data.gitSource?.lastStatus === "deploying" ? es ? "Desplegando" : "Deploying" : es ? "Sin despliegue" : "Not deployed"}</span></div>{data.gitSource ? <div className="service-detail-summary service-git-summary"><GitBranch size={19} /><div><strong>{data.gitSource.repository}</strong><span>{data.gitSource.branch} · {data.gitSource.composePath}</span></div><span className="service-state-pill">{deploymentStatusLabel(data.gitSource.lastStatus)}</span></div> : null}<div className="service-detail-metrics">{detailMetrics.map((item) => <div className="service-detail-metric" key={item.label}><small>{item.label}</small><strong title={item.value}>{item.value}</strong></div>)}</div><div className="service-detail-resource-list">{data.resources.length ? data.resources.map((resource) => <div key={resource.id}><span className={`service-state-dot ${resource.status}`} /><div><strong>{resource.name}</strong><small>{resource.image}</small></div><span className="service-detail-status">{resource.statusText || resource.status}</span></div>) : <p className="empty-state">{data.service.kind === "application" ? data.gitSource?.lastStatus === "failed" ? es ? "No se crearon recursos. Revisa el detalle del intento en Despliegues." : "No resources were created. Review the attempt details under Deployments." : es ? "Los recursos desplegados aparecerán aquí después del primer despliegue." : "Deployed resources will appear here after the first deployment." : es ? "Todavía no hay contenedores desplegados para este servicio." : "No containers have been deployed for this service yet."}</p>}</div></section> : null}</> : null}

    {tab === "environment" ? <section className="service-detail-panel"><div className="service-detail-section-heading"><div><span className="module-kicker">{es ? "CONFIGURACIÓN" : "CONFIGURATION"}</span><h2>{es ? "Variables de entorno" : "Environment variables"}</h2></div><ShieldCheck size={19} /></div>{selected?.environmentNames.length ? <><p className="service-detail-note"><ShieldCheck size={15} />{es ? "Se muestran nombres de variables. Los valores se ocultan para proteger credenciales." : "Variable names are shown. Values stay hidden to protect credentials."}</p><div className="service-env-list">{selected.environmentNames.map((name) => <code key={name}>{name}<span>{es ? "Configurada" : "Set"}</span></code>)}</div></> : <div className="service-tab-empty">{es ? "No hay variables disponibles para este recurso." : "No environment variables are available for this resource."}</div>}</section> : null}

    {tab === "deployments" ? <section className="service-detail-panel service-deployments-panel">
      <div className="service-detail-section-heading"><div><span className="module-kicker">GIT · COMPOSE</span><h2>{es ? "Despliegues" : "Deployments"}</h2><p>{es ? "Consulta las últimas 10 ejecuciones y sus logs." : "Review the latest 10 runs and their logs."}</p></div><div className="service-deployment-toolbar"><button className="projects-secondary service-deployments-refresh" type="button" onClick={() => void load(true)} data-tooltip={es ? "Actualiza el estado y el historial de despliegues." : "Refresh deployment status and history."}><RefreshCw size={15} />{es ? "Actualizar" : "Refresh"}</button>{data.gitSource ? <><button className="projects-secondary service-deployment-action" type="button" onClick={() => setPendingDeploymentAction("clear_history")} disabled={!data.deployments.some((run) => !["queued", "running"].includes(run.status))} data-tooltip={es ? "Elimina del historial las ejecuciones que ya terminaron." : "Remove completed runs from deployment history."}><Eraser size={15} />{es ? "Limpiar historial" : "Clear deployments"}</button><button className="projects-secondary service-deployment-action" type="button" onClick={() => setPendingDeploymentAction("kill_build")} disabled={!activeBuild} data-tooltip={es ? "Interrumpe la compilación que está ejecutándose." : "Interrupt the build that is currently running."}><Scissors size={15} />{es ? "Detener compilación" : "Kill Build"}</button><button className="projects-secondary service-deployment-action is-danger" type="button" onClick={() => setPendingDeploymentAction("cancel_queue")} disabled={!queuedDeploymentCount} data-tooltip={es ? "Cancela los despliegues pendientes en la cola." : "Cancel deployments waiting in the queue."}><Ban size={15} />{es ? "Cancelar cola" : "Cancel Queues"}{queuedDeploymentCount ? <span>{queuedDeploymentCount}</span> : null}</button></> : null}</div></div>
      {data.gitSource?.autoDeploy && data.gitSource.webhookReady && webhookUrl ? <div className="service-deployment-webhook"><div><Webhook size={16} /><strong>{es ? "Webhook" : "Webhook"}</strong></div><code title={webhookUrl}>{webhookUrl}</code><button className="service-webhook-copy-button" type="button" onClick={() => void copyWebhookUrl()} aria-label={es ? "Copiar URL webhook" : "Copy webhook URL"} data-tooltip={es ? "Copia la URL del webhook." : "Copy the webhook URL."}><Copy size={15} /></button></div> : null}
      {data.deployments.length ? <div className="service-deployment-list">{data.deployments.slice(0, 10).map((run, index) => {
        const expanded = expandedDeploymentId === run.id;
        const StateIcon = run.status === "succeeded" ? Check : run.status === "failed" ? CircleAlert : Clock3;
        return <article key={run.id} className={`service-deployment-card ${run.status}${expanded ? " is-expanded" : ""}`}>
          <div className={`service-deployment-result ${run.status}`}><StateIcon size={17} /></div>
          <div className="service-deployment-card-main">
            <div className="service-deployment-card-title"><span className="service-deployment-number">{es ? `Despliegue ${index + 1}` : `Deployment ${index + 1}`}</span><span className={`service-deployment-status ${run.status}`}><i />{runStatusLabel(run.status)}</span></div>
            <strong className="service-deployment-commit-title">{run.commitTitle || (run.commit ? (es ? "Título de commit no disponible" : "Commit title unavailable") : runPhaseLabel(run.phase))}</strong>
            {run.commit ? <code className="service-deployment-commit-sha" title={run.commit}>{run.commit}</code> : null}
            <div className="service-deployment-card-meta"><span><Clock3 size={13} />{new Date(run.startedAt).toLocaleString(es ? "es-VE" : "en-US")}</span><span>{run.trigger === "automatic" ? es ? "Automático" : "Automatic" : es ? "Manual" : "Manual"}</span><span>{runDuration(run, es)}</span>{run.commit && run.phase !== "completed" && run.phase !== "failed" ? <span>{runPhaseLabel(run.phase)}</span> : null}</div>
          </div>
          <div className="service-deployment-card-side"><button className="service-deployment-log-toggle" type="button" onClick={() => toggleDeploymentLogs(run.id)} aria-expanded={expanded} aria-controls={`deployment-log-${run.id}`} data-tooltip={expanded ? (es ? "Oculta los logs de esta ejecución." : "Hide logs for this run.") : (es ? "Abre los logs completos de esta ejecución." : "Open the full logs for this run.")}><ScrollText size={15} />{expanded ? (es ? "Ocultar logs" : "Hide logs") : (es ? "Ver logs" : "View logs")}<ChevronDown size={15} className={expanded ? "is-open" : ""} /></button></div>
          {run.error ? <p className="service-deployment-error"><CircleAlert size={15} />{deploymentErrorLabel(run.error, language)}</p> : null}
        </article>;
      })}</div> : logicalApplication ? <div className="service-tab-empty"><GitBranch size={22} /><strong>{data.gitSource ? es ? "Aún no hay despliegues" : "No deployments yet" : es ? "Aún no hay una fuente de despliegue" : "No deployment source yet"}</strong><span>{data.gitSource ? es ? "Cuando se ejecute el primer despliegue, aparecerá aquí con su estado y logs." : "The first deployment will appear here with its status and logs." : es ? "Configura proveedor, repositorio y Compose en los ajustes de despliegue." : "Set up a provider, repository, and Compose file in deployment settings."}</span>{!data.gitSource ? <button className="projects-secondary" type="button" onClick={() => setTab("general")}><GitBranch size={15} />{es ? "Configurar despliegue" : "Open deployment settings"}</button> : null}</div> : <div className="service-tab-empty"><GitBranch size={22} /><strong>{es ? "Sin ejecuciones registradas" : "No deployment runs recorded"}</strong><span>{es ? "No hay ejecuciones previas para este servicio." : "There are no previous runs for this service."}</span></div>}
    </section> : null}

    {tab === "containers" ? <section className="service-detail-panel"><div className="service-detail-section-heading"><div><span className="module-kicker">DOCKER ENGINE</span><h2>{es ? "Contenedores" : "Containers"}</h2><p>{es ? "Recursos Docker asociados a este servicio." : "Docker resources linked to this service."}</p></div>{data.resources.length ? <span className="service-container-count"><Container size={17} /><strong>{data.resources.length}</strong><span>{es ? data.resources.length === 1 ? "contenedor" : "contenedores" : data.resources.length === 1 ? "container" : "containers"}</span></span> : <Container size={19} />}</div>{data.resources.length ? <div className="service-container-list">{data.resources.map((resource) => { const ports = [...new Map(resource.ports.map((port) => [`${port.host ?? "internal"}:${port.container}/${port.protocol}`, port])).values()]; const status = resource.status.toLowerCase().replace(/[^a-z0-9-]/g, "-"); const statusLabel = ({ running: es ? "En ejecución" : "Running", exited: es ? "Detenido" : "Stopped", created: es ? "Creado" : "Created", restarting: es ? "Reiniciando" : "Restarting", paused: es ? "Pausado" : "Paused", dead: es ? "Fallido" : "Dead" } as Record<string, string>)[status] ?? resource.status; return <article className="service-container-card" key={resource.id}><header className="service-container-card-head"><span className="service-container-card-icon"><Container size={19} /></span><div className="service-container-card-title"><h3 title={resource.name}>{resource.name}</h3><span>{es ? "Contenedor Docker" : "Docker container"}</span></div><span className={`service-container-state ${status}`}><i />{statusLabel}</span></header><div className="service-container-card-details"><div className="service-container-image"><span><ImageIcon size={14} />{es ? "Imagen" : "Image"}</span><code title={resource.image}>{resource.image || "—"}</code></div><div className="service-container-ports"><span><Network size={14} />{es ? "Puertos" : "Ports"}</span><div>{ports.length ? ports.map((port) => <code key={`${port.host ?? "internal"}:${port.container}/${port.protocol}`}>{port.host === null ? `${port.container}/${port.protocol}` : `${port.host}:${port.container}/${port.protocol}`}</code>) : <small>{es ? "Sin puertos publicados" : "No published ports"}</small>}</div></div></div></article>; })}</div> : <div className="service-tab-empty">{es ? "Aún no hay contenedores desplegados." : "No containers deployed yet."}</div>}</section> : null}

    {tab === "logs" ? <section className="service-detail-panel"><div className="service-detail-section-heading"><div><span className="module-kicker">DOCKER ENGINE</span><h2>{es ? "Logs del contenedor" : "Container logs"}</h2><p>{es ? "Últimas 300 líneas disponibles en Docker." : "Latest 300 lines available from Docker."}</p></div><ScrollText size={19} /></div>{data.resources.length ? <><div className="service-log-controls"><label>{es ? "Contenedor" : "Container"}<VesselSelect value={selectedContainer} onChange={(event) => { setSelectedContainer(event.target.value); setLogs(""); }}>{data.resources.map((resource) => <option value={resource.serviceId} key={resource.serviceId}>{resource.name}</option>)}</VesselSelect></label><button className="projects-primary" type="button" onClick={() => void loadLogs()} disabled={logsBusy || !selectedContainer}>{logsBusy ? <span className="spinner" /> : <ScrollText size={15} />}{es ? "Cargar logs" : "Load logs"}</button></div><pre className="service-logs-output">{logsBusy ? (es ? "Cargando logs…" : "Loading logs…") : logs || (es ? "Selecciona Cargar logs para consultar la salida del contenedor." : "Select Load logs to fetch this container's output.")}</pre></> : <div className="service-tab-empty">{es ? "Los logs estarán disponibles cuando el servicio tenga un contenedor." : "Logs will be available after this service has a container."}</div>}</section> : null}
    </div>

    {expandedDeployment && <div className="modal-backdrop service-deployment-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpandedDeploymentId(null); }}><section className="service-deployment-log-modal" role="dialog" aria-modal="true" aria-labelledby="deployment-log-title">
      <header className="service-deployment-log-modal-head"><div><span className="module-kicker">{es ? "SALIDA DE EJECUCIÓN" : "DEPLOYMENT OUTPUT"}</span><h2 id="deployment-log-title">{es ? "Despliegue" : "Deployment"}</h2><p>{expandedDeployment.commitTitle || runPhaseLabel(expandedDeployment.phase)}</p></div><button type="button" className="service-deployment-modal-close" onClick={() => setExpandedDeploymentId(null)} aria-label={es ? "Cerrar logs" : "Close logs"} data-tooltip={es ? "Cierra la ventana de logs." : "Close the log window."}><X size={19} /></button></header>
      <div className="service-deployment-log-modal-meta"><span className={`service-deployment-status ${expandedDeployment.status}`}><i />{runStatusLabel(expandedDeployment.status)}</span>{expandedDeployment.commit ? <code title={expandedDeployment.commit}>{expandedDeployment.commit}</code> : null}<span>{new Date(expandedDeployment.startedAt).toLocaleString(es ? "es-VE" : "en-US")}</span><span>{runDuration(expandedDeployment, es)}</span></div>
      <div className="service-deployment-log-modal-toolbar"><span>{activeDeploymentLogLines.length} {es ? "líneas" : "lines"}{expandedDeployment.status === "running" || expandedDeployment.status === "queued" ? <i className="service-deployment-live-dot" /> : null}</span><div><button type="button" onClick={() => { void navigator.clipboard.writeText(activeDeploymentLogText).then(() => notifyVessel({ kind: "success", title: es ? "Logs copiados" : "Logs copied" })).catch(() => notifyVessel({ kind: "error", title: es ? "No se pudieron copiar los logs" : "Could not copy logs" })); }} data-tooltip={es ? "Copia el contenido visible de los logs." : "Copy the visible log output."}><Copy size={14} />{es ? "Copiar" : "Copy"}</button><button type="button" onClick={() => void loadDeploymentLogs(expandedDeployment.id)} disabled={activeDeploymentLogView?.loading} data-tooltip={es ? "Vuelve a consultar los logs de esta ejecución." : "Fetch the logs for this deployment again."}>{activeDeploymentLogView?.loading ? <span className="spinner" /> : <RefreshCw size={14} />}{es ? "Actualizar" : "Refresh"}</button><button type="button" className={aiPanelOpen ? "is-selected" : ""} onClick={() => { setAIPanelOpen((open) => !open); if (!aiPanelOpen) void loadAIConfigurations(); }} data-tooltip={es ? "Pide a un proveedor configurado que analice estos logs." : "Ask a configured provider to analyze these logs."}><Sparkles size={14} />{es ? "Analizar logs" : "Log analysis"}</button></div></div>
      <div className="service-deployment-log-lines" aria-live="polite">{activeDeploymentLogLines.map((line, index) => <div className={`service-deployment-log-line ${/error|failed|denied|fatal/i.test(line) ? "is-error" : "is-info"}`} key={`${index}-${line}`}><span>{/error|failed|denied|fatal/i.test(line) ? (es ? "error" : "error") : "info"}</span><code>{line}</code></div>)}</div>
      {aiPanelOpen ? <section className="deployment-ai-panel"><header><div><span className="ai-section-icon"><Sparkles size={17} /></span><div><h3>{es ? "Análisis de logs" : "Log analysis"}</h3><p>{es ? "El proveedor recibirá los logs de esta ejecución para proponer una causa y próximos pasos." : "The provider will receive this run's logs to suggest a cause and next steps."}</p></div></div></header>{aiConfigs.length ? <div className="deployment-ai-controls"><label>{es ? "Configuración de IA" : "AI configuration"}<VesselSelect value={aiConfigId} onChange={(event) => setAIConfigId(event.target.value)}>{aiConfigs.map((config) => <option key={config.id} value={config.id}>{config.name} · {config.model}</option>)}</VesselSelect></label><button className="primary-button ai-compact-button" type="button" onClick={() => void analyzeDeploymentLogs()} disabled={aiLoading || !aiConfigId || !activeDeploymentLogText.trim()}>{aiLoading ? <span className="spinner" /> : <Sparkles size={15} />}{aiLoading ? (es ? "Analizando…" : "Analyzing…") : (es ? "Analizar" : "Analyze")}</button></div> : <div className="deployment-ai-empty"><Sparkles size={17} /><span>{es ? "No hay proveedores de IA configurados. Añade una configuración para analizar logs." : "No AI providers configured. Set up a provider to analyze logs."}</span><Link href="/settings/ai">{es ? "Configurar proveedor de IA" : "Configure AI Provider"}<ArrowUpRight size={14} /></Link></div>}{aiError ? <div className="ai-feedback is-error"><CircleAlert size={15} />{aiError}</div> : null}{aiAnalysis ? <pre className="deployment-ai-result">{aiAnalysis}</pre> : null}</section> : null}
    </section></div>}
    {deploymentActionDialog && <div className="modal-backdrop" role="presentation"><section className="confirm-modal project-confirm-modal" role="alertdialog" aria-modal="true"><span className="module-kicker">{es ? "ACCIONES DE DESPLIEGUE" : "DEPLOYMENT ACTIONS"}</span><h2>{deploymentActionDialog.title}</h2><p>{deploymentActionDialog.detail}</p><div className="modal-actions"><button type="button" onClick={() => setPendingDeploymentAction(null)} disabled={deploymentActionBusy} data-tooltip={es ? "Cierra este aviso sin ejecutar la acción." : "Close this prompt without running the action."}>{es ? "Cancelar" : "Cancel"}</button><button className="danger-button" type="button" onClick={() => void runDeploymentAction(pendingDeploymentAction!)} disabled={deploymentActionBusy} data-tooltip={pendingDeploymentAction === "clear_history" ? (es ? "Confirma la eliminación del historial completado." : "Confirm removal of completed deployment history.") : pendingDeploymentAction === "kill_build" ? (es ? "Confirma la interrupción de la compilación activa." : "Confirm interruption of the active build.") : (es ? "Confirma la cancelación de los despliegues pendientes." : "Confirm cancellation of queued deployments.")}>{deploymentActionBusy ? <span className="spinner" /> : pendingDeploymentAction === "clear_history" ? <Eraser size={15} /> : pendingDeploymentAction === "kill_build" ? <Scissors size={15} /> : <Ban size={15} />}{pendingDeploymentAction === "clear_history" ? es ? "Limpiar historial" : "Clear history" : pendingDeploymentAction === "kill_build" ? es ? "Detener compilación" : "Kill Build" : es ? "Cancelar cola" : "Cancel queue"}</button></div></section></div>}
    {unlinkOpen ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal project-confirm-modal" role="alertdialog" aria-modal="true"><span className="module-kicker">{es ? "QUITAR ASOCIACIÓN" : "REMOVE PROJECT LINK"}</span><h2>{es ? `¿Quitar ${data.service.name} del proyecto?` : `Remove ${data.service.name} from this project?`}</h2><p>{es ? "No se detendrá ni borrará ningún recurso. Solo se eliminará esta asociación." : "No resources will be stopped or deleted. Only this project link will be removed."}</p><div className="modal-actions"><button type="button" onClick={() => setUnlinkOpen(false)} disabled={busy}>{es ? "Cancelar" : "Cancel"}</button><button className="danger-button" type="button" onClick={() => void unlink()} disabled={busy}>{busy ? <span className="spinner" /> : <Trash2 size={15} />}{es ? "Quitar del proyecto" : "Remove from project"}</button></div></section></div> : null}
  </main>;
}
