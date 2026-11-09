"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowRight, Bell, CalendarClock, Check, ChevronDown, CircleAlert, Clock3, Code2, Download, FileClock, FolderKanban, History, KeyRound, LoaderCircle, LockKeyhole, Pencil, Play, Plus, RefreshCw, Save, Search, Server, ShieldCheck, Terminal, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { notifyVessel } from "@/app/components/ToastNotice";
import "../globals.css";

import { dateLabel, emptyForm, localError, normalizeProjectRoute, parseEnvironment, parseEnvironmentRows, type Form, type JobKey, type JobProject, type Run, type Task, type TaskStats } from "./jobs-model";
import { ScheduledProjectCard } from "./ScheduledProjectCard";
import { ShellScriptEditor } from "./ShellScriptEditor";

export default function JobsWorkspace({ projectId }: { projectId?: string }) {
  const { language } = useI18n();
  const router = useRouter();
  const es = language === "es";
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<JobProject[]>([]);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectPage, setProjectPage] = useState(0);
  const [statistics, setStatistics] = useState<Record<string, TaskStats>>({});
  const [selectedProjectId, setSelectedProjectId] = useState("default");
  const activeProjectId = projectId ? normalizeProjectRoute(projectId) : selectedProjectId;
  const [projectForm, setProjectForm] = useState<{ id?: string; name: string; description: string } | null>(null);
  const [deleteProject, setDeleteProject] = useState<JobProject | null>(null);
  const [keyProject, setKeyProject] = useState<JobProject | null>(null);
  const [globalKeyVaultOpen, setGlobalKeyVaultOpen] = useState(false);
  const [projectKeys, setProjectKeys] = useState<JobKey[]>([]);
  const [availableKeys, setAvailableKeys] = useState<JobKey[]>([]);
  const [keyForm, setKeyForm] = useState({ name: "", value: "" });
  const [savingKey, setSavingKey] = useState(false);
  const [formTab, setFormTab] = useState<"details" | "workflow" | "nodes" | "schedule" | "notifications" | "other">("details");
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<Form | null>(null);
  const [scriptDisclosureOpen, setScriptDisclosureOpen] = useState(false);
  const [deleteTask, setDeleteTask] = useState<Task | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyTask, setBusyTask] = useState("");
  const [error, setError] = useState("");
  const [logRun, setLogRun] = useState<Run | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const previousRuns = useRef<Map<string, string> | null>(null);

  const refresh = useCallback(async (quiet = false) => {
    try {
      const response = await fetch("/api/scheduled-tasks", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not load scheduled tasks.", es));
      setTasks(payload.data.tasks ?? []);
      setProjects(payload.data.projects ?? []);
      setStatistics(payload.data.statistics ?? {});
      if (!(payload.data.projects ?? []).some((project: JobProject) => normalizeProjectRoute(project.id) === normalizeProjectRoute(activeProjectId))) {
        if (projectId) router.replace("/jobs");
        else setSelectedProjectId(payload.data.projects?.[0]?.id ?? "default");
      }
      const nextRuns = (payload.data.runs ?? []) as Run[];
      if (previousRuns.current) {
        for (const run of nextRuns) {
          if (!previousRuns.current.has(run.id) && run.trigger === "schedule" && Date.now() - Date.parse(run.startedAt) < 20_000) {
            notifyVessel({ kind: "progress", title: es ? `Trabajo iniciado · ${run.taskName}` : `Job started · ${run.taskName}`, detail: es ? "Ejecución automática detectada." : "Automated run detected." });
          } else if (previousRuns.current.get(run.id) === "running" && run.status !== "running") {
            notifyVessel({ kind: run.status === "succeeded" ? "success" : "error", title: run.status === "succeeded" ? (es ? `Trabajo completado · ${run.taskName}` : `Job completed · ${run.taskName}`) : (es ? `Falló el trabajo · ${run.taskName}` : `Job failed · ${run.taskName}`), detail: run.exitCode === null ? undefined : `Exit code: ${run.exitCode}` });
          }
        }
      }
      previousRuns.current = new Map(nextRuns.map((run) => [run.id, run.status]));
      setRuns(nextRuns);
    } catch (cause) {
      if (!quiet) setError(cause instanceof Error ? cause.message : es ? "No se pudieron cargar los trabajos." : "Could not load jobs.");
    } finally { setLoading(false); }
  }, [es, selectedProjectId, projectId, activeProjectId, router]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(true), 2500); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => {
    if (!logRun || logRun.status !== "running") return;
    let cancelled = false;
    const update = async () => {
      try {
        const response = await fetch(`/api/scheduled-tasks?runId=${encodeURIComponent(logRun.id)}`, { cache: "no-store" });
        const payload = await response.json();
        if (response.ok && !cancelled) setLogRun(payload.data);
      } catch { /* Keep the last visible output and allow manual refresh. */ }
    };
    const timer = window.setInterval(() => void update(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [logRun?.id, logRun?.status]);

  const runningCount = useMemo(() => runs.filter((run) => run.status === "running").length, [runs]);
  const selectedProject = projects.find((project) => normalizeProjectRoute(project.id) === normalizeProjectRoute(activeProjectId) || normalizeProjectRoute(project.name) === normalizeProjectRoute(activeProjectId)) ?? (projectId ? undefined : projects[0]);
  const filteredProjects = useMemo(() => {
    const query = projectQuery.trim().toLocaleLowerCase();
    return projects.filter((project) => !query || `${project.name} ${project.description}`.toLocaleLowerCase().includes(query));
  }, [projects, projectQuery]);
  const projectsPerPage = 12;
  const visibleProjects = filteredProjects.slice(projectPage * projectsPerPage, (projectPage + 1) * projectsPerPage);
  const projectTasks = tasks.filter((task) => task.projectId === selectedProject?.id);
  const scriptVariables = useMemo(() => {
    const result: Record<string, string> = {
      VESSEL_PROJECT_NAME: selectedProject?.name ?? "",
      VESSEL_PROJECT_ID: selectedProject?.id ?? "",
      VESSEL_JOB_NAME: form?.name ?? "",
      VESSEL_JOB_ID: form?.id ?? "",
    };
    if (form) for (const { name, value } of parseEnvironmentRows(form.environmentText)) {
      result[name] = value;
      result[`VESSEL_${name.replace(/^VESSEL_/, "")}`] = value;
    }
    return result;
  }, [form, selectedProject]);
  const protectedScriptVariables = useMemo(() => [
    ...availableKeys.map((key) => key.name),
    ...(form?.environmentNames ?? []).filter((name) => !form?.removedEnvironmentNames.includes(name)),
  ], [availableKeys, form]);
  const projectRuns = runs.filter((run) => projectTasks.some((task) => task.id === run.taskId));

  useEffect(() => {
    if (!form?.projectId) { setAvailableKeys([]); return; }
    let cancelled = false;
    void fetch(`/api/scheduled-tasks?resource=availableKeys&projectId=${encodeURIComponent(form.projectId)}`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => { if (!cancelled) setAvailableKeys(payload.data?.keys ?? []); })
      .catch(() => { if (!cancelled) setAvailableKeys([]); });
    return () => { cancelled = true; };
  }, [form?.projectId]);

  function editTask(task?: Task & { script?: string }) {
    setScriptDisclosureOpen(false);
    if (!task) { setForm(emptyForm(selectedProject?.id ?? selectedProjectId)); setFormTab("details"); setError(""); return; }
    setBusyTask(task.id);
    void fetch(`/api/scheduled-tasks?taskId=${encodeURIComponent(task.id)}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not read task.", es));
      const saved = payload.data.task as Task;
      setForm({ id: saved.id, projectId: saved.projectId, name: saved.name, description: saved.description, cronExpression: saved.cronExpression, timezone: saved.timezone, timeoutSeconds: saved.timeoutSeconds, script: saved.script ?? "", environmentText: "", removedEnvironmentNames: [], environmentNames: saved.environmentNames });
      setFormTab("details");
      setError("");
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not read task.")).finally(() => setBusyTask(""));
  }

  async function saveTask(event: React.FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    if (!form.script.trim()) {
      setFormTab("workflow");
      setScriptDisclosureOpen(true);
      setError(es ? "Escribe el script de shell antes de guardar el trabajo." : "Enter the shell script before saving the job.");
      return;
    }
    setSaving(true); setError("");
    try {
      const environment = parseEnvironment(form.environmentText);
      const response = await fetch("/api/scheduled-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: form.id ? "update" : "create", id: form.id || undefined, projectId: form.projectId, name: form.name, description: form.description, cronExpression: form.cronExpression, timezone: form.timezone, timeoutSeconds: Number(form.timeoutSeconds), script: form.script, environment, removedEnvironmentNames: form.removedEnvironmentNames }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not save task.", es));
      notifyVessel({ kind: "success", title: es ? "Trabajo guardado" : "Job saved", detail: form.name });
      setForm(null); await refresh(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo guardar el trabajo." : "Could not save job."); }
    finally { setSaving(false); }
  }

  function updateOptionLine(lineIndex: number, name: string, value: string) {
    if (!form) return;
    const lines = form.environmentText.split("\n");
    lines[lineIndex] = `${name}=${value}`;
    setForm({ ...form, environmentText: lines.join("\n") });
  }

  function addOption() {
    if (!form) return;
    setForm({ ...form, environmentText: `${form.environmentText}${form.environmentText && !form.environmentText.endsWith("\n") ? "\n" : ""}OPTION=` });
  }

  function removeOption(lineIndex: number) {
    if (!form) return;
    const lines = form.environmentText.split("\n");
    lines.splice(lineIndex, 1);
    setForm({ ...form, environmentText: lines.join("\n") });
  }

  async function taskAction(id: string, action: "run" | "toggle" | "delete" | "duplicate", enabled?: boolean) {
    setBusyTask(id); setError("");
    try {
      const response = await fetch("/api/scheduled-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id, enabled }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Task action failed.", es));
      if (action === "run") notifyVessel({ kind: "progress", title: es ? `Trabajo iniciado · ${payload.data.taskName}` : `Job started · ${payload.data.taskName}`, detail: es ? "La salida estará disponible en el historial." : "Output will appear in the run history." });
      if (action === "delete") { setDeleteTask(null); notifyVessel({ kind: "success", title: es ? "Trabajo eliminado" : "Job deleted" }); }
      if (action === "duplicate") notifyVessel({ kind: "success", title: es ? "Trabajo duplicado" : "Job duplicated", detail: payload.data?.name });
      await refresh(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "La acción falló." : "Task action failed."); }
    finally { setBusyTask(""); }
  }

  async function saveProject(event: React.FormEvent) {
    event.preventDefault();
    if (!projectForm) return;
    try {
      const response = await fetch("/api/scheduled-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: projectForm.id ? "project.update" : "project.create", ...projectForm }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not save project.", es));
      setSelectedProjectId(payload.data.id); setProjectForm(null); await refresh(true);
      if (!projectForm.id) router.push(`/jobs/${encodeURIComponent(payload.data.id)}`);
      notifyVessel({ kind: "success", title: es ? "Proyecto guardado" : "Project saved", detail: payload.data.name });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save project."); }
  }

  async function removeProject(project: JobProject) {
    try {
      const response = await fetch("/api/scheduled-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "project.delete", id: project.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not delete project.", es));
      setDeleteProject(null);
      if (activeProjectId === project.id) { setSelectedProjectId(""); router.replace("/jobs"); }
      await refresh(true);
      notifyVessel({ kind: "success", title: es ? "Proyecto eliminado" : "Project deleted", detail: project.name });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete project."); }
  }

  async function openKeyVault(project: JobProject) {
    setGlobalKeyVaultOpen(false);
    setKeyProject(project); setKeyForm({ name: "", value: "" });
    setProjectKeys([]);
    try {
      const response = await fetch(`/api/scheduled-tasks?resource=projectKeys&projectId=${encodeURIComponent(project.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not load project keys.", es));
      setProjectKeys(payload.data.keys ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load project keys."); }
  }

  async function openGlobalKeyVault() {
    setKeyProject(null); setGlobalKeyVaultOpen(true); setKeyForm({ name: "", value: "" }); setProjectKeys([]);
    try {
      const response = await fetch("/api/scheduled-tasks?resource=globalKeys", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not load global keys.", es));
      setProjectKeys(payload.data.keys ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudieron cargar las claves globales." : "Could not load global keys."); }
  }

  function closeKeyVault() { setKeyProject(null); setGlobalKeyVaultOpen(false); }

  async function saveProjectKey(event: React.FormEvent) {
    event.preventDefault(); if ((!keyProject && !globalKeyVaultOpen) || savingKey) return;
    setSavingKey(true);
    try {
      const response = await fetch("/api/scheduled-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(globalKeyVaultOpen ? { action: "globalKey.save", ...keyForm } : { action: "key.save", projectId: keyProject!.id, ...keyForm }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not save project key.", es));
      setProjectKeys(payload.data.keys ?? []); setKeyForm({ name: "", value: "" }); await refresh(true);
      notifyVessel({ kind: "success", title: globalKeyVaultOpen ? (es ? "Clave global guardada" : "Global key saved") : (es ? "Clave protegida guardada" : "Protected key saved") });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save project key."); }
    finally { setSavingKey(false); }
  }

  async function removeProjectKey(name: string) {
    if (!keyProject && !globalKeyVaultOpen) return;
    const response = await fetch("/api/scheduled-tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(globalKeyVaultOpen ? { action: "globalKey.delete", name } : { action: "key.delete", projectId: keyProject!.id, name }) });
    const payload = await response.json();
    if (response.ok) { setProjectKeys(payload.data.keys ?? []); await refresh(true); }
    else setError(localError(payload.error ?? "Could not delete project key.", es));
  }

  async function downloadDefinition(task: Pick<Task, "id" | "name">, format: "json" | "yaml" | "xml") {
    try {
      const response = await fetch(`/api/scheduled-tasks?taskId=${encodeURIComponent(task.id)}&export=${format}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not export job definition.");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `${task.name}.${format}`; anchor.click(); URL.revokeObjectURL(url);
    } catch { setError(es ? "No se pudo descargar la definición." : "Could not download the job definition."); }
  }

  async function openLogs(run: Run) {
    setLogRun({ ...run, output: "" }); setLogLoading(true);
    try {
      const response = await fetch(`/api/scheduled-tasks?runId=${encodeURIComponent(run.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localError(payload.error ?? "Could not load run output.", es));
      setLogRun(payload.data);
    } catch (cause) { setLogRun({ ...run, output: cause instanceof Error ? cause.message : "Could not load run output." }); }
    finally { setLogLoading(false); }
  }

  const copy = {
    heading: "Vessel Run",
    subtitle: projectId
      ? (es ? "Administra y ejecuta los jobs de este proyecto." : "Manage and run this project's jobs.")
      : (es ? "Organiza scripts y automatizaciones en proyectos." : "Organize scripts and automation into projects."),
    create: es ? "Crear trabajo" : "Create job", noTasks: es ? "Aún no hay trabajos" : "No jobs yet", first: es ? "Crea un trabajo para ejecutar scripts manualmente o con un horario." : "Create a job to run scripts manually or on a schedule.",
    projects: es ? "Proyectos" : "Projects", newProject: es ? "Nuevo proyecto" : "New project", keyStore: es ? "Claves del proyecto" : "Project keys", globalKeyStore: es ? "Claves globales" : "Global keys", projectName: es ? "Nombre del proyecto" : "Project name", projectDescription: es ? "Descripción" : "Description", jobs: es ? "trabajos" : "jobs", keys: es ? "claves" : "keys", selectedProject: selectedProject?.name ?? (es ? "Proyecto" : "Project"), noProjectTasks: es ? "Este proyecto todavía no tiene trabajos." : "This project has no jobs yet.", createJob: es ? "Crear trabajo" : "Create job", projectKeys: es ? "Claves reutilizables del proyecto" : "Reusable project keys", keyName: es ? "Nombre de variable" : "Variable name", keyValue: es ? "Valor secreto" : "Secret value", noKeys: es ? "No hay claves almacenadas." : "No stored keys.", projectCount: es ? `${projects.length} proyectos` : `${projects.length} projects`,
    name: es ? "Nombre del trabajo" : "Job name", description: es ? "Descripción" : "Description", cron: es ? "Expresión cron" : "Cron expression", timezone: es ? "Zona horaria" : "Time zone", timeout: es ? "Tiempo límite (segundos)" : "Timeout (seconds)", script: es ? "Script de shell" : "Shell script", variables: es ? "Parámetros del trabajo" : "Job parameters", variableHint: es ? "Cada parámetro se expone al script como VESSEL_<NOMBRE>. Los valores se cifran al guardarlos." : "Each parameter is exposed to the script as VESSEL_<NAME>. Values are encrypted when saved.", existingVariables: es ? "Parámetros protegidos guardados" : "Saved protected parameters", remove: es ? "Quitar" : "Remove", scheduleHint: es ? "Cinco campos: minuto hora día mes día-semana. Ejemplo: 0 2 * * * = cada día a las 02:00." : "Five fields: minute hour day month weekday. Example: 0 2 * * * = every day at 02:00.", warning: es ? "Los scripts se ejecutan en el contenedor Vessel y pueden acceder al Docker Engine conectado. Usa solo código de confianza." : "Scripts run in the Vessel container and can access the connected Docker Engine. Run trusted code only.", save: es ? "Guardar trabajo" : "Save job", cancel: es ? "Cancelar" : "Cancel", run: es ? "Ejecutar ahora" : "Run now", edit: es ? "Editar" : "Edit", delete: es ? "Eliminar" : "Delete", active: es ? "Habilitado" : "Enabled", paused: es ? "Deshabilitado" : "Disabled", history: es ? "Ejecuciones" : "Executions", noHistory: es ? "Aún no hay ejecuciones." : "No runs yet.", logs: es ? "Ver salida" : "View output", close: es ? "Cerrar" : "Close", deleteConfirm: es ? "¿Eliminar este trabajo? Se conservará el historial de ejecución." : "Delete this job? Its run history will be kept.", none: es ? "Sin ejecuciones" : "No runs", running: es ? "En ejecución" : "Running", success: es ? "Completada" : "Succeeded", failed: es ? "Fallida" : "Failed", manual: es ? "Manual" : "Manual", scheduled: es ? "Programada" : "Scheduled", timeoutLabel: es ? "Límite" : "Timeout", taskCount: es ? `${projectTasks.length} trabajos` : `${projectTasks.length} jobs`, concurrent: es ? `${runningCount}/2 ejecuciones simultáneas` : `${runningCount}/2 concurrent runs`, cronPresets: es ? "Frecuentes" : "Presets",
  };



  return <main className="module-main scheduled-tasks-page">
    <header className="module-header"><div><span className="module-kicker"><CalendarClock size={14} /> Vessel Run · {projectId ? (es ? "PROYECTO" : "PROJECT") : (es ? "AUTOMATIZACIÓN" : "AUTOMATION")}</span><h1>{projectId && selectedProject ? selectedProject.name : copy.heading}</h1><p>{projectId && selectedProject ? selectedProject.description || copy.subtitle : copy.subtitle}</p></div><div className="scheduled-header-actions"><span><Activity size={15} />{copy.concurrent}</span>{projectId ? <><Link className="secondary-button scheduled-back-button" href="/jobs"><ArrowRight size={15} />{es ? "Proyectos" : "Projects"}</Link><button className="secondary-button" type="button" onClick={() => void openGlobalKeyVault()}><KeyRound size={15} />{copy.globalKeyStore}</button><button className="secondary-button" type="button" onClick={() => selectedProject && void openKeyVault(selectedProject)} disabled={!selectedProject}><FolderKanban size={15} />{copy.keyStore}</button><button className="secondary-button" type="button" onClick={() => selectedProject && setProjectForm({ id: selectedProject.id, name: selectedProject.name, description: selectedProject.description })} disabled={!selectedProject}><Pencil size={14} />{es ? "Editar proyecto" : "Edit project"}</button>{selectedProject ? <button className="scheduled-icon-button is-danger" type="button" onClick={() => setDeleteProject(selectedProject)} aria-label={copy.delete} title={copy.delete}><Trash2 size={15} /></button> : null}<button className="primary-button" type="button" onClick={() => editTask()} disabled={!selectedProject}><Plus size={16} />{copy.createJob}</button></> : <><button className="secondary-button" type="button" onClick={() => void openGlobalKeyVault()}><KeyRound size={15} />{copy.globalKeyStore}</button><button className="primary-button" type="button" onClick={() => setProjectForm({ name: "", description: "" })}><FolderKanban size={15} />{copy.newProject}</button></>}</div></header>
    <nav className="scheduled-workspace-tabs" aria-label={es ? "Navegación de Vessel Run" : "Vessel Run navigation"}><Link className="active" href="/jobs"><FolderKanban size={15} />{es ? "Proyectos" : "Projects"}</Link><Link href="/jobs/activity"><Activity size={15} />{es ? "Actividad" : "Activity"}</Link></nav>
    {error ? <div className="scheduled-error" role="alert"><CircleAlert size={17} />{error}<button type="button" onClick={() => setError("")} aria-label={copy.close}><X size={15} /></button></div> : null}
    {loading ? <section className="module-panel scheduled-loading"><span className="scheduled-skeleton" /><span className="scheduled-skeleton" /><span className="scheduled-skeleton" /></section> : <>
      {!projectId ? <section className="scheduled-project-section">
        <div className="scheduled-project-section-head"><div><h2><FolderKanban size={18} />{copy.projects}</h2><p>{copy.projectCount}</p></div></div>
        {projects.length ? <>
          <div className="scheduled-project-toolbar"><label className="scheduled-project-search"><Search size={16} /><input value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); setProjectPage(0); }} placeholder={es ? "Buscar proyecto…" : "Search projects…"} aria-label={es ? "Buscar proyectos" : "Search projects"} />{projectQuery ? <button type="button" className="scheduled-project-search-clear" onClick={() => { setProjectQuery(""); setProjectPage(0); }} aria-label={es ? "Limpiar búsqueda" : "Clear search"}><X size={15} /></button> : null}</label><span>{es ? `${filteredProjects.length} de ${projects.length}` : `${filteredProjects.length} of ${projects.length}`}</span></div>
          {filteredProjects.length ? <>
            <div className="scheduled-project-grid">{visibleProjects.map((project) => <ScheduledProjectCard key={project.id} project={project} language={es ? "es" : "en"} onDelete={setDeleteProject} />)}</div>
            {filteredProjects.length > projectsPerPage ? <div className="scheduled-project-pagination"><span>{es ? `Mostrando ${projectPage * projectsPerPage + 1}–${Math.min((projectPage + 1) * projectsPerPage, filteredProjects.length)} de ${filteredProjects.length}` : `Showing ${projectPage * projectsPerPage + 1}–${Math.min((projectPage + 1) * projectsPerPage, filteredProjects.length)} of ${filteredProjects.length}`}</span><div><button type="button" className="secondary-button" onClick={() => setProjectPage((page) => Math.max(0, page - 1))} disabled={projectPage === 0}>{es ? "Anterior" : "Previous"}</button><button type="button" className="secondary-button" onClick={() => setProjectPage((page) => Math.min(Math.ceil(filteredProjects.length / projectsPerPage) - 1, page + 1))} disabled={(projectPage + 1) * projectsPerPage >= filteredProjects.length}>{es ? "Siguiente" : "Next"}</button></div></div> : null}
          </> : <div className="scheduled-project-empty is-search-empty"><span className="scheduled-empty-icon"><Search size={22} /></span><h2>{es ? "No hay coincidencias" : "No matching projects"}</h2><p>{es ? "Prueba con otro nombre o descripción." : "Try another name or description."}</p><button className="secondary-button" type="button" onClick={() => setProjectQuery("")}>{es ? "Limpiar búsqueda" : "Clear search"}</button></div>}
        </> : <div className="scheduled-project-empty"><span className="scheduled-empty-icon"><FolderKanban size={24} /></span><h2>{es ? "Crea tu primer proyecto" : "Create your first project"}</h2><p>{es ? "Agrupa en un mismo lugar los jobs, sus horarios y las claves reutilizables." : "Keep jobs, schedules, and reusable secrets together in one place."}</p><button className="primary-button" type="button" onClick={() => setProjectForm({ name: "", description: "" })}><Plus size={15} />{copy.newProject}</button></div>}
      </section> : null}
      {projectId && selectedProject ? <>
      <section className="jobs-project-summary"><div><span className="scheduled-project-icon"><FolderKanban size={21} /></span><div><strong>{selectedProject.name}</strong><small>{selectedProject.description || (es ? "Proyecto de automatización" : "Automation project")}</small></div></div><span><Terminal size={15} />{projectTasks.length} {copy.jobs}</span><span><KeyRound size={15} />{selectedProject.keyCount} {copy.keys}</span></section>
      {!projectTasks.length ? <section className="module-panel scheduled-empty"><span className="scheduled-empty-icon"><CalendarClock size={27} /></span><h2>{copy.noTasks}</h2><p>{copy.noProjectTasks}</p><button className="primary-button" type="button" onClick={() => editTask()}><Plus size={16} />{copy.createJob}</button></section> : <>
      <section className="module-panel scheduled-task-section"><div className="scheduled-section-head"><div><h2><CalendarClock size={19} />{selectedProject?.name ?? copy.heading}</h2><p>{copy.taskCount}</p></div><div className="scheduled-section-actions"><button className="secondary-button" type="button" onClick={() => void refresh()}><RefreshCw size={15} />{es ? "Actualizar" : "Refresh"}</button><button className="primary-button" type="button" onClick={() => editTask()}><Plus size={15} />{copy.createJob}</button></div></div>
        <div className="scheduled-task-grid">{projectTasks.map((task) => { const stats = statistics[task.id] ?? { executions: 0, successRate: 0, averageSeconds: null }; return <article className={`scheduled-task-card${task.enabled ? "" : " is-disabled"}`} key={task.id}>
          <div className="scheduled-task-card-head"><span className="scheduled-task-icon"><Terminal size={19} /></span><div className="scheduled-task-title"><h3>{task.name}</h3><p>{task.description || (es ? "Sin descripción" : "No description")}</p></div><span className={`scheduled-state ${task.enabled ? "is-enabled" : "is-paused"}`}><i />{task.enabled ? copy.active : copy.paused}</span></div>
          <div className="scheduled-task-meta"><div><Clock3 size={15} /><span>{task.cronExpression}</span></div><div><Activity size={15} /><span>{task.timezone}</span></div><div><LockKeyhole size={15} /><span>{task.environmentNames.length + (selectedProject?.keyCount ?? 0)} {es ? "opciones protegidas" : "protected options"}</span></div><div><FileClock size={15} /><span>{dateLabel(task.lastRunAt, es)}</span></div></div>
          <div className={`scheduled-task-stats${stats.executions === 0 ? " is-empty" : ""}`}>{stats.executions === 0 ? <span className="scheduled-no-runs"><History size={15} /><strong>{es ? "Sin ejecuciones" : "No runs yet"}</strong></span> : <><span><strong>{stats.executions}</strong><small>{es ? "Ejecuciones" : "Runs"}</small></span><span><strong>{stats.successRate}%</strong><small>{es ? "Éxito" : "Success"}</small></span><span><strong>{stats.averageSeconds === null ? "—" : `${stats.averageSeconds}s`}</strong><small>{es ? "Duración media" : "Avg. duration"}</small></span></>}</div>
          <div className="scheduled-task-card-footer"><button className="primary-button" type="button" onClick={() => void taskAction(task.id, "run")} disabled={busyTask === task.id || !task.enabled}><Play size={14} />{copy.run}</button><button className="secondary-button" type="button" onClick={() => void editTask(task)} disabled={busyTask === task.id}><Pencil size={14} />{copy.edit}</button><button className="scheduled-icon-button" type="button" onClick={() => void taskAction(task.id, "toggle", !task.enabled)} disabled={busyTask === task.id} aria-label={task.enabled ? copy.paused : copy.active} title={task.enabled ? copy.paused : copy.active}>{task.enabled ? <Clock3 size={16} /> : <Check size={16} />}</button><button className="scheduled-icon-button" type="button" onClick={() => void taskAction(task.id, "duplicate")} aria-label={es ? "Duplicar trabajo" : "Duplicate job"} title={es ? "Duplicar trabajo" : "Duplicate job"}><Code2 size={15} /></button><button className="scheduled-icon-button is-danger" type="button" onClick={() => setDeleteTask(task)} aria-label={copy.delete} title={copy.delete}><Trash2 size={16} /></button></div>
          <div className="scheduled-export-actions"><span><Download size={14} />{es ? "Exportar definición" : "Export job"}</span><div>{(["xml", "json", "yaml"] as const).map((format) => <button className="scheduled-export-button" key={format} type="button" onClick={() => void downloadDefinition(task, format)}><strong>{format.toUpperCase()}</strong><small>{es ? "Descargar" : "Download"}</small></button>)}</div></div>
        </article>; })}</div>
      </section>
      <section className="module-panel scheduled-history-section"><div className="scheduled-section-head"><div><h2><History size={19} />{copy.history}</h2><p>{es ? "Estado, código de salida y salida del script." : "Status, exit code, and script output."}</p></div></div>
        {projectRuns.length ? <div className="scheduled-run-table"><div className="scheduled-run-row scheduled-run-head"><span>{es ? "Trabajo" : "Job"}</span><span>{es ? "Estado" : "Status"}</span><span>{es ? "Inicio" : "Started"}</span><span>{es ? "Origen" : "Trigger"}</span><span /></div>{projectRuns.map((run) => <div className="scheduled-run-row" key={run.id}><strong>{run.taskName}</strong><span className={`scheduled-run-status ${run.status}`}><i />{run.status === "running" ? copy.running : run.status === "succeeded" ? copy.success : copy.failed}</span><span>{dateLabel(run.startedAt, es)}</span><span>{run.trigger === "manual" ? copy.manual : copy.scheduled}</span><button type="button" className="scheduled-log-button" onClick={() => void openLogs(run)}><FileClock size={14} />{copy.logs}</button></div>)}</div> : <div className="scheduled-history-empty"><History size={20} />{copy.noHistory}</div>}
      </section>
      </>}
      </> : projectId ? <section className="module-panel scheduled-project-picker"><div className="scheduled-section-head"><div><h2><FolderKanban size={20} />{es ? "Selecciona un proyecto" : "Choose a project"}</h2><p>{es ? "Elige un proyecto para ver y ejecutar sus trabajos." : "Choose a project to view and run its jobs."}</p></div></div>{projects.length ? <><div className="scheduled-project-toolbar"><label className="scheduled-project-search"><Search size={16} /><input value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); setProjectPage(0); }} placeholder={es ? "Buscar proyecto…" : "Search projects…"} aria-label={es ? "Buscar proyectos" : "Search projects"} />{projectQuery ? <button type="button" className="scheduled-project-search-clear" onClick={() => { setProjectQuery(""); setProjectPage(0); }} aria-label={es ? "Limpiar búsqueda" : "Clear search"}><X size={15} /></button> : null}</label><span>{es ? `${filteredProjects.length} de ${projects.length}` : `${filteredProjects.length} of ${projects.length}`}</span></div>{filteredProjects.length ? <div className="scheduled-project-grid">{visibleProjects.map((project) => <ScheduledProjectCard key={project.id} project={project} language={es ? "es" : "en"} onDelete={setDeleteProject} />)}</div> : <div className="scheduled-history-empty"><Search size={18} />{es ? "No hay proyectos que coincidan con esa búsqueda." : "No projects match that search."}</div>}{filteredProjects.length > projectsPerPage ? <div className="scheduled-project-pagination"><span>{es ? `Página ${projectPage + 1} de ${Math.ceil(filteredProjects.length / projectsPerPage)}` : `Page ${projectPage + 1} of ${Math.ceil(filteredProjects.length / projectsPerPage)}`}</span><div><button type="button" className="secondary-button" onClick={() => setProjectPage((page) => Math.max(0, page - 1))} disabled={projectPage === 0}>{es ? "Anterior" : "Previous"}</button><button type="button" className="secondary-button" onClick={() => setProjectPage((page) => Math.min(Math.ceil(filteredProjects.length / projectsPerPage) - 1, page + 1))} disabled={(projectPage + 1) * projectsPerPage >= filteredProjects.length}>{es ? "Siguiente" : "Next"}</button></div></div> : null}</> : <div className="scheduled-project-empty"><p>{es ? "Todavía no hay proyectos disponibles." : "There are no projects yet."}</p><button className="primary-button" type="button" onClick={() => setProjectForm({ name: "", description: "" })}><Plus size={15} />{copy.newProject}</button></div>}</section> : null}
    </>}

    {form ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setForm(null); }}><section className="confirm-modal scheduled-task-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-task-modal-title"><header className="scheduled-modal-header"><div><span className="module-kicker"><Terminal size={14} />{es ? "AUTOMATIZACIÓN" : "AUTOMATION"}</span><h2 id="scheduled-task-modal-title">{form.id ? copy.edit : copy.create}</h2><p>{es ? "Define cuándo y cómo se ejecuta este script." : "Choose when and how this script runs."}</p></div><button type="button" className="scheduled-modal-close" onClick={() => setForm(null)} disabled={saving} aria-label={copy.close}><X size={19} /></button></header>
      <form className="scheduled-task-form" onSubmit={(event) => void saveTask(event)}>
        <nav className="scheduled-form-tabs" aria-label={es ? "Secciones del trabajo" : "Job sections"}>
          {([ ["details", es ? "Detalles" : "Details", <FileClock size={15} />], ["workflow", es ? "Flujo de trabajo" : "Workflow", <Code2 size={15} />], ["nodes", es ? "Nodos" : "Nodes", <Server size={15} />], ["schedule", es ? "Horario" : "Schedule", <CalendarClock size={15} />], ["notifications", es ? "Notificaciones" : "Notifications", <Bell size={15} />], ["other", es ? "Otros" : "Other", <ShieldCheck size={15} />] ] as const).map(([id, label, icon]) => <button key={id} type="button" className={formTab === id ? "active" : ""} onClick={() => setFormTab(id)}>{icon}{label}</button>)}
        </nav>
        <div className="scheduled-form-tab-content">
          {formTab === "details" ? <div className="scheduled-form-grid"><label className="scheduled-form-wide">{es ? "Proyecto" : "Project"}<select value={form.projectId} onChange={(event) => setForm({ ...form, projectId: event.target.value })}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>{copy.name}<input required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={es ? "Respaldo nocturno" : "Nightly backup"} /></label><label className="scheduled-form-wide">{copy.description}<textarea rows={3} maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder={es ? "Descripción y propósito del trabajo" : "Job description and purpose"} /></label><div className="scheduled-security-note scheduled-form-wide"><ShieldCheck size={17} /><span>{es ? "La ejecución utiliza un único script shell. Puedes organizar los comandos con funciones y controlar errores mediante el código de salida del shell." : "Each job runs one shell script. Organize commands with shell functions and control failure through the shell exit code."}</span></div></div> : null}
          {formTab === "workflow" ? <>
            <section className="scheduled-env-block">
              <div className="scheduled-parameters-heading"><div><h3><LockKeyhole size={17} />{copy.variables}</h3><p>{copy.variableHint}</p></div><button type="button" className="secondary-button" onClick={addOption}><Plus size={15} />{es ? "Añadir parámetro" : "Add parameter"}</button></div>
              {parseEnvironmentRows(form.environmentText).length ? <div className="scheduled-option-list">{parseEnvironmentRows(form.environmentText).map((option) => <div className="scheduled-option-row" key={option.lineIndex}>
                <label><span>{es ? "Nombre" : "Name"}</span><input value={option.name} onChange={(event) => updateOptionLine(option.lineIndex, event.target.value, option.value)} placeholder="DB_NAME" autoCapitalize="off" spellCheck={false} /></label>
                <label><span>{es ? "Valor" : "Value"}</span><input type={/(PASSWORD|TOKEN|SECRET|ACCESS_KEY)/i.test(option.name) ? "password" : "text"} value={option.value} onChange={(event) => updateOptionLine(option.lineIndex, option.name, event.target.value)} placeholder={es ? "Valor del parámetro" : "Parameter value"} autoComplete="new-password" /></label>
                <button type="button" className="scheduled-icon-button is-danger" onClick={() => removeOption(option.lineIndex)} aria-label={copy.remove} title={copy.remove}><X size={15} /></button>
              </div>)}</div> : <div className="scheduled-parameters-empty"><LockKeyhole size={17} />{es ? "Añade parámetros para usarlos desde el script." : "Add parameters to use them in the script."}</div>}
              {availableKeys.length ? <div className="scheduled-key-available"><strong>{es ? "Claves protegidas disponibles" : "Available protected keys"}</strong><div>{availableKeys.map((key) => <code key={`${key.scope ?? "project"}:${key.name}`} title={key.scope === "global" ? (es ? "Clave global cifrada" : "Encrypted global key") : (es ? "Clave cifrada del proyecto" : "Encrypted project key")}>VESSEL_{key.name.replace(/^VESSEL_/, "")}<small>{key.scope === "global" ? (es ? "Global" : "Global") : (es ? "Proyecto" : "Project")}</small></code>)}</div><small>{es ? "El valor cifrado se inyecta al ejecutar. Úsalo directamente como $VESSEL_NOMBRE en el script; también queda disponible con su nombre original para compatibilidad." : "The encrypted value is injected at runtime. Reference it as $VESSEL_NAME in the script; its original name remains available for compatibility."}</small></div> : null}
              {form.environmentNames.length ? <div className="scheduled-env-existing"><span>{copy.existingVariables}:</span>{form.environmentNames.filter((name) => !form.removedEnvironmentNames.includes(name)).map((name) => <button type="button" key={name} onClick={() => setForm({ ...form, removedEnvironmentNames: [...form.removedEnvironmentNames, name] })} title={copy.remove}>VESSEL_{name.replace(/^VESSEL_/, "")}<X size={12} /></button>)}</div> : null}
            </section>
            <details className="scheduled-shell-disclosure" open={scriptDisclosureOpen} onToggle={(event) => setScriptDisclosureOpen(event.currentTarget.open)}>
              <summary><Terminal size={16} /><span>{copy.script}</span><ChevronDown size={16} className="scheduled-disclosure-chevron" /></summary>
              <ShellScriptEditor label={copy.script} value={form.script} onChange={(script) => setForm({ ...form, script })} variables={scriptVariables} protectedVariables={protectedScriptVariables} language={language} />
            </details>
            <div className="scheduled-security-note"><ShieldCheck size={17} /><span>{copy.warning}</span></div>
          </> : null}
          {formTab === "nodes" ? <div className="scheduled-node-panel"><span><Server size={20} /></span><div><h3>{es ? "Ejecutor local de Vessel" : "Vessel local runner"}</h3><p>{es ? "Los scripts se ejecutan dentro del contenedor Vessel en el host conectado. Se hereda el acceso a las herramientas instaladas en esa imagen y a las rutas montadas en el contenedor." : "Scripts run inside Vessel's container on the connected host. They use tools installed in that image and paths mounted into the container."}</p><dl><div><dt>{es ? "Estrategia" : "Strategy"}</dt><dd>{es ? "Un script por ejecución" : "One script per run"}</dd></div><div><dt>{es ? "Paralelismo" : "Concurrency"}</dt><dd>{es ? "Máximo 2 trabajos" : "Up to 2 jobs"}</dd></div><div><dt>{es ? "Variables" : "Variables"}</dt><dd>{es ? "Entorno del proceso" : "Process environment"}</dd></div></dl><small className="scheduled-runner-hint">{es ? "La imagen incluye SSH, curl, wget, clientes PostgreSQL 13/16 y s3cmd. Define un parámetro PG_VERSION y úsalo como $VESSEL_PG_VERSION. También están disponibles VESSEL_PROJECT_NAME, VESSEL_PROJECT_ID, VESSEL_JOB_NAME y las claves protegidas VESSEL_NOMBRE. Las rutas de archivos son internas al contenedor Vessel." : "The image includes SSH, curl, wget, PostgreSQL 13/16 clients, and s3cmd. Define a PG_VERSION parameter and reference it as $VESSEL_PG_VERSION. VESSEL_PROJECT_NAME, VESSEL_PROJECT_ID, VESSEL_JOB_NAME, and protected keys as VESSEL_NAME are also available. File paths are inside the Vessel container."}</small></div></div> : null}
          {formTab === "schedule" ? <><div className="scheduled-form-grid"><label className="scheduled-form-wide">{copy.cron}<input required value={form.cronExpression} onChange={(event) => setForm({ ...form, cronExpression: event.target.value })} placeholder="0 2 * * *" spellCheck={false} /></label><label className="scheduled-form-wide">{copy.timezone}<input required value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} placeholder="America/Caracas" spellCheck={false} /></label></div><div className="scheduled-cron-helper"><Clock3 size={15} /><span>{copy.scheduleHint}</span><div><span>{copy.cronPresets}:</span><button type="button" onClick={() => setForm({ ...form, cronExpression: "*/5 * * * *" })}>5 min</button><button type="button" onClick={() => setForm({ ...form, cronExpression: "0 * * * *" })}>{es ? "Cada hora" : "Hourly"}</button><button type="button" onClick={() => setForm({ ...form, cronExpression: "0 2 * * *" })}>{es ? "Diario 02:00" : "Daily 02:00"}</button></div></div></> : null}
          {formTab === "notifications" ? <div className="scheduled-node-panel"><span><Bell size={20} /></span><div><h3>{es ? "Avisos en Vessel" : "Vessel notifications"}</h3><p>{es ? "Vessel muestra avisos de inicio y resultado mientras la sesión tenga abierta esta sección. El historial conserva el estado y la salida; no se envía correo ni mensajes externos." : "Vessel shows start and completion notices while this section is open. Run history keeps the status and output; email and external messaging are not configured."}</p></div></div> : null}
          {formTab === "other" ? <><div className="scheduled-form-grid"><label className="scheduled-form-wide">{copy.timeout}<input type="number" min={10} max={7200} value={form.timeoutSeconds} onChange={(event) => setForm({ ...form, timeoutSeconds: Number(event.target.value) })} /></label></div><div className="scheduled-security-note"><ShieldCheck size={17} /><span>{copy.warning}</span></div>{form.id ? <div className="scheduled-definition-download"><strong>{es ? "Definición del trabajo" : "Job definition"}</strong><span>{es ? "Descarga para control de versiones o respaldo." : "Download for version control or backup."}</span>{(["xml", "json", "yaml"] as const).map((format) => <button key={format} type="button" onClick={() => void downloadDefinition({ id: form.id, name: form.name }, format)}><Download size={13} />{format.toUpperCase()}</button>)}</div> : null}</> : null}
        </div>
        {error ? <div className="scheduled-error" role="alert"><CircleAlert size={16} />{error}</div> : null}
        <footer className="scheduled-modal-footer"><button type="button" className="secondary-button" onClick={() => setForm(null)} disabled={saving}><X size={15} />{copy.cancel}</button><button className="primary-button" type="submit" disabled={saving}>{saving ? <LoaderCircle size={15} className="spinning" /> : <Save size={15} />}{saving ? (es ? "Guardando…" : "Saving…") : copy.save}</button></footer>
      </form></section></div> : null}
    {projectForm ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setProjectForm(null); }}><section className="confirm-modal scheduled-project-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-project-title"><header className="scheduled-modal-header"><div><span className="module-kicker"><FolderKanban size={14} />{es ? "VESSEL RUN · PROYECTOS" : "VESSEL RUN · PROJECTS"}</span><h2 id="scheduled-project-title">{projectForm.id ? (es ? "Editar proyecto" : "Edit project") : copy.newProject}</h2><p>{es ? "Agrupa scripts y claves protegidas bajo un mismo proyecto." : "Group scripts and protected keys under one project."}</p></div><button type="button" className="scheduled-modal-close" onClick={() => setProjectForm(null)} aria-label={copy.close}><X size={19} /></button></header><form className="scheduled-task-form" onSubmit={(event) => void saveProject(event)}><label className="scheduled-code-label">{copy.projectName}<input required maxLength={80} value={projectForm.name} onChange={(event) => setProjectForm({ ...projectForm, name: event.target.value })} /></label><label className="scheduled-code-label">{copy.projectDescription}<textarea rows={4} maxLength={500} value={projectForm.description} onChange={(event) => setProjectForm({ ...projectForm, description: event.target.value })} /></label><div className="scheduled-modal-footer"><button type="button" className="secondary-button" onClick={() => setProjectForm(null)}><X size={15} />{copy.cancel}</button><button className="primary-button" type="submit"><Save size={15} />{es ? "Guardar proyecto" : "Save project"}</button></div></form></section></div> : null}
    {keyProject || globalKeyVaultOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeKeyVault(); }}><section className="confirm-modal scheduled-key-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-key-title"><header className="scheduled-modal-header"><div><span className="module-kicker"><KeyRound size={14} />{es ? "ALMACENAMIENTO PROTEGIDO" : "PROTECTED STORAGE"}</span><h2 id="scheduled-key-title">{globalKeyVaultOpen ? copy.globalKeyStore : copy.projectKeys}</h2><p>{globalKeyVaultOpen ? (es ? "Disponibles para todos los proyectos. Los valores se cifran y nunca se vuelven a mostrar." : "Available to every project. Values are encrypted and never shown again.") : `${keyProject?.name} · ${es ? "Los valores se cifran y nunca se vuelven a mostrar." : "Values are encrypted and never shown again."}`}</p></div><button type="button" className="scheduled-modal-close" onClick={closeKeyVault} aria-label={copy.close}><X size={19} /></button></header><form className="scheduled-key-form" onSubmit={(event) => void saveProjectKey(event)}><label>{copy.keyName}<input required maxLength={128} pattern="[A-Za-z_][A-Za-z0-9_]*" value={keyForm.name} onChange={(event) => setKeyForm({ ...keyForm, name: event.target.value })} placeholder="S3_SECRET_KEY" autoCapitalize="off" /></label><label>{copy.keyValue}<input required type="password" value={keyForm.value} onChange={(event) => setKeyForm({ ...keyForm, value: event.target.value })} autoComplete="new-password" /></label><button className="primary-button" type="submit" disabled={savingKey || !keyForm.name || !keyForm.value}>{savingKey ? <LoaderCircle size={15} className="spinning" /> : <Plus size={15} />}{es ? "Guardar clave" : "Save key"}</button></form><div className="scheduled-key-list">{projectKeys.length ? projectKeys.map((key) => <div key={key.name}><span><LockKeyhole size={15} /><code>{key.name}</code></span><small>{es ? "Valor cifrado" : "Encrypted value"}</small><button type="button" className="scheduled-icon-button is-danger" onClick={() => void removeProjectKey(key.name)} aria-label={`${copy.delete} ${key.name}`} title={copy.delete}><Trash2 size={15} /></button></div>) : <div className="scheduled-history-empty"><KeyRound size={18} />{copy.noKeys}</div>}</div><div className="scheduled-security-note"><ShieldCheck size={17} /><span>{globalKeyVaultOpen ? (es ? "Estas claves estarán disponibles en todos los trabajos. Las claves del proyecto y las opciones del trabajo pueden reemplazar un nombre global." : "These keys are available to every job. Project keys and job options can override a global name.") : (es ? "Estas claves se inyectan en los trabajos de este proyecto. Las claves globales también estarán disponibles. Respalda VESSEL_SECRET_KEY junto con SQLite para conservar el acceso." : "These keys are injected into this project's jobs. Global keys are also available. Back up VESSEL_SECRET_KEY with SQLite to retain access.")}</span></div></section></div> : null}
    {deleteProject ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteProject(null); }}><section className="confirm-modal scheduled-delete-modal" role="alertdialog" aria-modal="true"><span className="module-kicker"><Trash2 size={14} />{copy.delete}</span><h2>{deleteProject.name}</h2><p>{deleteProject.taskCount > 0 ? (es ? `Este proyecto tiene ${deleteProject.taskCount} trabajos. Elimínalos o muévelos antes de borrar el proyecto.` : `This project has ${deleteProject.taskCount} jobs. Delete or move them before deleting the project.`) : (es ? "Se eliminará el proyecto y sus claves cifradas. Las claves globales no se verán afectadas." : "This project and its encrypted keys will be deleted. Global keys will not be affected.")}</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDeleteProject(null)}>{copy.cancel}</button><button type="button" className="danger-button" onClick={() => void removeProject(deleteProject)} disabled={deleteProject.taskCount > 0}><Trash2 size={15} />{deleteProject.taskCount > 0 ? (es ? "Elimina primero los trabajos" : "Delete jobs first") : copy.delete}</button></div></section></div> : null}
    {deleteTask ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTask(null); }}><section className="confirm-modal scheduled-delete-modal" role="alertdialog" aria-modal="true"><span className="module-kicker"><Trash2 size={14} />{copy.delete}</span><h2>{deleteTask.name}</h2><p>{copy.deleteConfirm}</p><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setDeleteTask(null)}>{copy.cancel}</button><button type="button" className="danger-button" onClick={() => void taskAction(deleteTask.id, "delete")}><Trash2 size={15} />{copy.delete}</button></div></section></div> : null}
    {logRun ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setLogRun(null); }}><section className="confirm-modal scheduled-log-modal" role="dialog" aria-modal="true" aria-labelledby="scheduled-log-title"><header className="scheduled-modal-header"><div><span className="module-kicker"><FileClock size={14} />{logRun.status}</span><h2 id="scheduled-log-title">{logRun.taskName}</h2><p>{dateLabel(logRun.startedAt, es)} · {logRun.trigger === "manual" ? copy.manual : copy.scheduled}{logRun.exitCode !== null ? ` · Exit ${logRun.exitCode}` : ""}</p></div><button className="scheduled-modal-close" type="button" onClick={() => setLogRun(null)} aria-label={copy.close}><X size={19} /></button></header>{logRun.error ? <div className="scheduled-log-error"><CircleAlert size={15} />{logRun.error}</div> : null}<pre>{logLoading ? (es ? "Cargando salida…" : "Loading output…") : logRun.output || (es ? "Sin salida registrada." : "No output recorded.")}</pre><footer><button className="secondary-button" type="button" onClick={() => void openLogs(logRun)} disabled={logLoading}><RefreshCw size={14} />{es ? "Actualizar" : "Refresh"}</button><button className="primary-button" type="button" onClick={() => setLogRun(null)}>{copy.close}</button></footer></section></div> : null}
  </main>;
}
