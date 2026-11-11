"use client";
import VesselSelect from "@/app/components/VesselSelect";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Boxes, CalendarClock, ChevronRight, CircleHelp, Container, Database, ExternalLink, Globe, Layers3, Plus, RefreshCw, Search, Bot, Tag, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatLocalDateTime } from "@/lib/date-format";
import { PageLoadingSkeleton } from "@/app/components/LoadingSkeletons";
import { localizeProjectError } from "@/lib/project-errors";

type ProjectService = { id: string; kind: string; name: string; appName: string; description: string; targetType: "container" | "compose" | "git" | null; targetRef: string | null; createdAt: string; updatedAt: string };
type ContainerItem = { id: string; name: string; image: string; status: string; composeProject: string | null };
type ComposeItem = { name: string; containers: string[] };
type Project = { id: string; name: string; description: string; createdAt: string; serviceCount: number; tags: Array<{ id: string; name: string }>; environmentNames: string[]; services: ProjectService[]; catalog: { containers: ContainerItem[]; compose: ComposeItem[] } };
type ProjectSchedule = { id: string; serviceId: string; action: "restart" | "start" | "down" | "down_up"; startsAt: string; timezone: string; repeatMode: "once" | "daily" | "weekly"; weekdays: number[]; months: number[]; endsAt: string | null; enabled: boolean; lastRunStatus: "scheduled" | "running" | "succeeded" | "failed"; lastError: string | null };
type SourceType = "container" | "compose";
const databasePresets = [
  { id: "postgres", name: "PostgreSQL", image: "postgres:latest", port: 5432, detailEn: "Relational database", detailEs: "Base de datos relacional" },
  { id: "mysql", name: "MySQL", image: "mysql:latest", port: 3306, detailEn: "Relational database", detailEs: "Base de datos relacional" },
  { id: "mariadb", name: "MariaDB", image: "mariadb:latest", port: 3306, detailEn: "Relational database", detailEs: "Base de datos relacional" },
  { id: "mongodb", name: "MongoDB", image: "mongo:latest", port: 27017, detailEn: "Document database", detailEs: "Base de datos documental" },
];
function projectSlug(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/-+$/g, "") || "project";
}
function localScheduleInput(date: Date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function makeApplicationSlug(value: string) {
  return projectSlug(value).replace(/[._]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 63).replace(/-+$/g, "") || "app";
}

const serviceTypes = [
  { id: "application", Icon: Globe, en: "Application", es: "Aplicación", helpEn: "Create an application workspace, then configure its deployment.", helpEs: "Crea el espacio de una aplicación y luego configura su despliegue." },
  { id: "database", Icon: Database, en: "Database", es: "Base de datos", helpEn: "Create a database service from any Docker image.", helpEs: "Crea un servicio de datos con cualquier imagen Docker." },
  { id: "compose", Icon: Boxes, en: "Compose", es: "Compose", helpEn: "Define and deploy multiple services together.", helpEs: "Define y despliega varios servicios relacionados." },
  { id: "template", Icon: Layers3, en: "Template", es: "Plantilla", helpEn: "Start from a Compose example.", helpEs: "Empieza con un ejemplo Compose." },
  { id: "assistant", Icon: Bot, en: "AI Assistant", es: "Asistente IA", helpEn: "Not configured yet.", helpEs: "Aún no está configurado." },
  { id: "import", Icon: ExternalLink, en: "Import", es: "Importar", helpEn: "Add an existing Docker or Git resource.", helpEs: "Añade un recurso Docker o Git existente." },
];

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const router = useRouter();
  const { language } = useI18n();
  const es = language === "es";
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [serviceMenu, setServiceMenu] = useState(false);
  const [databasePicker, setDatabasePicker] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [applicationName, setApplicationName] = useState("");
  const [applicationSlug, setApplicationSlug] = useState("");
  const [applicationSlugEdited, setApplicationSlugEdited] = useState(false);
  const [applicationDescription, setApplicationDescription] = useState("");
  const [sourceType, setSourceType] = useState<SourceType>("container");
  const [targetRef, setTargetRef] = useState("");
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<ProjectService | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [environmentOpen, setEnvironmentOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [projectSchedules, setProjectSchedules] = useState<ProjectSchedule[]>([]);
  const [scheduleServiceId, setScheduleServiceId] = useState("");
  const [scheduleOperation, setScheduleOperation] = useState<ProjectSchedule["action"]>("down_up");
  const [scheduleStart, setScheduleStart] = useState(() => localScheduleInput(new Date(Date.now() + 10 * 60_000)));
  const [scheduleRepeat, setScheduleRepeat] = useState<ProjectSchedule["repeatMode"]>("once");
  const [scheduleWeekdays, setScheduleWeekdays] = useState<number[]>([]);
  const [scheduleMonths, setScheduleMonths] = useState<number[]>(Array.from({ length: 12 }, (_, index) => index + 1));
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceKindFilter, setServiceKindFilter] = useState("all");
  const [serviceSort, setServiceSort] = useState<"recent" | "name">("recent");
  const [notice, setNotice] = useState("");
  const [environmentName, setEnvironmentName] = useState("");
  const [environmentValue, setEnvironmentValue] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/projects?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not load project.", language));
      setProject(payload.data);
    } catch (loadError) { setError(loadError instanceof Error ? localizeProjectError(loadError.message, language) : es ? "No se pudo cargar el proyecto." : "Could not load project."); }
    finally { setLoading(false); }
  }

  async function openProjectScheduler() {
    if (!project) return;
    setScheduleServiceId((current) => project.services.some((service) => service.id === current) ? current : project.services.find((service) => service.targetType)?.id ?? "");
    setScheduleOpen(true);
    try {
      const response = await fetch(`/api/project-schedules?projectId=${encodeURIComponent(project.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load schedules");
      setProjectSchedules(payload.data ?? []);
    } catch (cause) { setNotice(cause instanceof Error ? localizeProjectError(cause.message, language) : (es ? "No se pudieron cargar las programaciones." : "Could not load schedules.")); }
  }

  async function saveProjectSchedule(event: React.FormEvent) {
    event.preventDefault();
    if (!project || !scheduleServiceId || saving) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/project-schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", projectId: project.id, serviceId: scheduleServiceId, operation: scheduleOperation, startsAt: new Date(scheduleStart).toISOString(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, repeatMode: scheduleRepeat, weekdays: scheduleWeekdays, months: scheduleMonths, endsAt: scheduleEnd ? new Date(scheduleEnd).toISOString() : null }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not schedule this action.", language));
      setProjectSchedules((current) => [...current, payload.data]);
      setNotice(es ? "Acción programada." : "Action scheduled.");
      setScheduleStart(localScheduleInput(new Date(Date.now() + 10 * 60_000)));
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : es ? "No se pudo crear la programación." : "Could not create schedule."); }
    finally { setSaving(false); }
  }

  async function removeProjectSchedule(scheduleId: string) {
    if (!project || saving) return;
    setSaving(true);
    try {
      const response = await fetch("/api/project-schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", projectId: project.id, id: scheduleId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not cancel schedule");
      setProjectSchedules((current) => current.filter((schedule) => schedule.id !== scheduleId));
      setNotice(es ? "Programación cancelada." : "Schedule cancelled.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : es ? "No se pudo cancelar." : "Could not cancel schedule."); }
    finally { setSaving(false); }
  }

  useEffect(() => { void load(); }, [id]);

  const targets = useMemo(() => {
    if (!project) return [] as Array<{ ref: string; label: string; detail: string }>;
    if (sourceType === "container") return project.catalog.containers.map((item) => ({ ref: item.name, label: item.name, detail: `${item.image || "Docker"}${item.composeProject ? ` · Compose ${item.composeProject}` : ""}` }));
    return project.catalog.compose.map((item) => ({ ref: item.name, label: item.name, detail: `${item.containers.length} ${es ? "contenedor(es)" : "container(s)"}` }));
  }, [project, sourceType, es]);

  useEffect(() => { setTargetRef(targets[0]?.ref ?? ""); }, [targets]);

  const visibleServices = useMemo(() => {
    const query = serviceSearch.trim().toLocaleLowerCase();
    return (project?.services ?? [])
      .filter((service) => serviceKindFilter === "all" || service.kind === serviceKindFilter)
      .filter((service) => !query || `${service.name} ${service.description} ${service.kind}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => serviceSort === "name"
        ? a.name.localeCompare(b.name, language)
        : b.updatedAt.localeCompare(a.updatedAt));
  }, [project, serviceSearch, serviceKindFilter, serviceSort, language]);

  function createService(kind: string) {
    setServiceMenu(false);
    if (kind === "application") {
      setApplicationName("");
      setApplicationSlug(makeApplicationSlug(`${project?.name ?? "project"}-app`));
      setApplicationSlugEdited(false);
      setApplicationDescription("");
      setNotice("");
      setApplicationOpen(true);
      return;
    }
    if (kind === "database") { setDatabasePicker(true); return; }
    if (kind === "compose") {
      router.push(`/compose?new=1&vesselProjectId=${encodeURIComponent(id)}&projectName=${encodeURIComponent(`${projectSlug(project?.name ?? "project")}-compose`)}`);
      return;
    }
    if (kind === "template") {
      router.push(`/compose?new=1&template=web&vesselProjectId=${encodeURIComponent(id)}&projectName=${encodeURIComponent(`${projectSlug(project?.name ?? "project")}-web`)}`);
      return;
    }
    if (kind === "import") { setNotice(""); setImportOpen(true); }
    if (kind === "assistant") setNotice(es ? "El Asistente IA estará disponible cuando se configure un proveedor de modelos." : "AI Assistant will be available after a model provider is configured.");
  }

  function createDatabase(presetId: string) {
    const preset = databasePresets.find((item) => item.id === presetId);
    if (!preset || !project) return;
    setDatabasePicker(false);
    const projectName = projectSlug(project.name);
    router.push(`/containers?create=service&projectId=${encodeURIComponent(id)}&kind=database&database=${preset.id}&newName=${encodeURIComponent(`${projectName}-${preset.id}`)}`);
  }

  async function createApplication(event: React.FormEvent) {
    event.preventDefault();
    if (!project) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_application", projectId: id, name: applicationName.trim(), appName: applicationSlug.trim(), description: applicationDescription.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Application details are invalid", language));
      const created = payload.data as ProjectService;
      setProject((current) => current ? { ...current, services: [...current.services, created], serviceCount: current.serviceCount + 1 } : current);
      setApplicationOpen(false);
      router.push(`/projects/${encodeURIComponent(id)}/services/${encodeURIComponent(created.id)}`);
    } catch (createError) { setNotice(createError instanceof Error ? localizeProjectError(createError.message, language) : es ? "No se pudo crear la aplicación." : "Could not create the application."); }
    finally { setSaving(false); }
  }

  async function importResource(event: React.FormEvent) {
    event.preventDefault();
    if (!project || !targetRef) return;
    const entry = targets.find((target) => target.ref === targetRef);
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "add_service", projectId: id, kind: sourceType === "container" ? "import" : sourceType, name: entry?.label ?? targetRef, description: entry?.detail ?? "", targetType: sourceType, targetRef }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not save project", language));
      setProject((current) => current ? { ...current, services: [...current.services.filter((service) => service.name !== payload.data.name), payload.data], serviceCount: current.services.length + (current.services.some((service) => service.name === payload.data.name) ? 0 : 1) } : current);
      setImportOpen(false);
      setNotice(es ? `${payload.data.name} se añadió al proyecto.` : `${payload.data.name} was added to the project.`);
    } catch (saveError) { setNotice(saveError instanceof Error ? localizeProjectError(saveError.message, language) : es ? "No se pudo añadir el recurso." : "Could not add the resource."); }
    finally { setSaving(false); }
  }

  async function unlinkService(service: ProjectService) {
    if (!project) return;
    setSaving(true);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove_service", projectId: id, serviceId: service.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not save project", language));
      setProject({ ...project, services: project.services.filter((item) => item.id !== service.id), serviceCount: Math.max(0, project.serviceCount - 1) });
      setRemoveTarget(null);
      setNotice(es ? "Se quitó la asociación. El recurso sigue intacto." : "The project link was removed. The resource remains unchanged.");
    } catch (saveError) { setNotice(saveError instanceof Error ? localizeProjectError(saveError.message, language) : es ? "No se pudo quitar el servicio." : "Could not remove service."); }
    finally { setSaving(false); }
  }

  async function deleteProject() {
    setSaving(true);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not save project", language));
      router.push("/projects");
    } catch (saveError) { setNotice(saveError instanceof Error ? localizeProjectError(saveError.message, language) : es ? "No se pudo borrar el proyecto." : "Could not delete project."); setDeleteOpen(false); }
    finally { setSaving(false); }
  }

  async function saveEnvironmentVariable(event: React.FormEvent) {
    event.preventDefault();
    if (!project) return;
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_environment", projectId: id, name: environmentName, value: environmentValue }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not save project environment variable", language));
      setProject((current) => current ? { ...current, environmentNames: payload.environmentNames ?? [] } : current);
      setEnvironmentName(""); setEnvironmentValue("");
      setNotice(es ? "Variable de proyecto guardada de forma cifrada." : "Project variable saved encrypted.");
    } catch (saveError) { setNotice(saveError instanceof Error ? localizeProjectError(saveError.message, language) : es ? "No se pudo guardar la variable." : "Could not save the variable."); }
    finally { setSaving(false); }
  }

  async function removeEnvironmentVariable(name: string) {
    if (!project) return;
    setSaving(true);
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete_environment", projectId: id, name }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not remove project environment variable", language));
      setProject((current) => current ? { ...current, environmentNames: payload.environmentNames ?? [] } : current);
      setNotice(es ? `Se eliminó ${name} del entorno del proyecto.` : `${name} was removed from the project environment.`);
    } catch (removeError) { setNotice(removeError instanceof Error ? localizeProjectError(removeError.message, language) : es ? "No se pudo eliminar la variable." : "Could not remove the variable."); }
    finally { setSaving(false); }
  }

  function serviceHref(service: ProjectService) {
    return `/projects/${encodeURIComponent(id)}/services/${encodeURIComponent(service.id)}`;
  }

  if (loading) return <main className="module-main"><PageLoadingSkeleton label={es ? "Cargando proyecto…" : "Loading project…"} /></main>;
  if (!project) return <main className="module-main"><Link className="project-back-link" href="/projects"><ArrowLeft size={16} />{es ? "Volver a proyectos" : "Back to projects"}</Link><section className="project-load-error"><span><RefreshCw size={20} /></span><h1>{es ? "No se pudo abrir el proyecto" : "Could not open project"}</h1><p>{error || (es ? "No se encontró el proyecto." : "Project not found.")}</p><button className="projects-secondary" type="button" onClick={() => void load()}><RefreshCw size={15} />{es ? "Reintentar" : "Retry"}</button></section></main>;

  return <main className="module-main vessel-project-detail">
    <div className="project-breadcrumb"><Link href="/projects"><ArrowLeft size={15} />{es ? "Proyectos" : "Projects"}</Link><ChevronRight size={14} /><strong>{project.name}</strong><ChevronRight size={14} /><span className="project-environment-badge"><Layers3 size={14} />{es ? "Principal" : "Main"}</span></div>
    <header className="project-environment-header">
      <div className="project-environment-title"><span className="project-detail-mark"><FolderKanbanIcon /></span><div><span className="module-kicker">{es ? "ENTORNO DEL PROYECTO" : "PROJECT ENVIRONMENT"}</span><h1>{project.name}</h1><p>{project.description || (es ? "Servicios y recursos de este proyecto." : "Services and resources in this project.")}</p>{project.tags.length ? <div className="workspace-project-tags project-detail-tags">{project.tags.map((tag) => <span className="project-tag-chip" key={tag.id}><Tag size={11} />{tag.name}</span>)}</div> : null}</div></div>
      <div className="project-heading-actions"><button className="projects-secondary project-schedule-trigger" type="button" onClick={() => void openProjectScheduler()} title={es ? "Programar acciones del servicio" : "Schedule service actions"}><CalendarClock size={15} />{es ? "Agendar" : "Schedule"}</button><button className="projects-secondary project-environment-button" type="button" onClick={() => { setNotice(""); setEnvironmentOpen(true); }}><Layers3 size={16} />{es ? "Entorno del proyecto" : "Project Environment"}<span>{project.environmentNames.length}</span></button><div className="project-add-wrap"><button className="projects-primary" type="button" onClick={() => setServiceMenu((current) => !current)}><Plus size={16} />{es ? "Crear servicio" : "Create Service"}</button>{serviceMenu ? <div className="project-service-menu">{serviceTypes.map(({ id: kind, Icon, en, es: esLabel, helpEn, helpEs }) => <button type="button" key={kind} className={kind === "assistant" ? "is-disabled" : ""} onClick={() => createService(kind)}><span className="service-menu-icon"><Icon size={17} /></span><span><strong>{es ? esLabel : en}</strong><small>{es ? helpEs : helpEn}</small></span><ArrowRight size={15} /></button>)}</div> : null}</div><button className="projects-secondary project-delete-trigger" type="button" onClick={() => setDeleteOpen(true)} aria-label={es ? "Eliminar proyecto" : "Delete project"} title={es ? "Eliminar proyecto" : "Delete project"}><Trash2 size={16} /></button></div>
    </header>

    {notice && !environmentOpen && !applicationOpen ? <div className="projects-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label={es ? "Cerrar" : "Dismiss"}><X size={15} /></button></div> : null}
    <section className="project-service-section project-service-workspace" id="services">
      <div className="project-section-heading"><div><span className="module-kicker">{es ? "RECURSOS DEL PROYECTO" : "PROJECT RESOURCES"}</span><h2>{es ? "Servicios" : "Services"}</h2><p>{es ? "Cada servicio tiene su propio espacio de configuración, despliegues y logs." : "Each service has its own space for configuration, deployments, and logs."}</p></div><button type="button" className="projects-secondary" onClick={() => { setSourceType("container"); setImportOpen(true); }}><ExternalLink size={15} />{es ? "Importar existente" : "Import existing"}</button></div>
      <div className="project-services-toolbar"><label className="project-services-search"><Search size={16} /><input type="search" value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} placeholder={es ? "Filtrar servicios..." : "Filter services..."} /></label><label className="project-service-select"><span>{es ? "Tipo" : "Type"}</span><VesselSelect value={serviceKindFilter} onChange={(event) => setServiceKindFilter(event.target.value)}><option value="all">{es ? "Todos los tipos" : "All types"}</option>{serviceTypes.filter((item) => item.id !== "assistant").map((item) => <option key={item.id} value={item.id}>{es ? item.es : item.en}</option>)}</VesselSelect></label><label className="project-service-select"><span>{es ? "Ordenar" : "Sort by"}</span><VesselSelect value={serviceSort} onChange={(event) => setServiceSort(event.target.value as "recent" | "name")}><option value="recent">{es ? "Actualizados recientemente" : "Recently updated"}</option><option value="name">{es ? "Nombre A–Z" : "Name A–Z"}</option></VesselSelect></label><span className="project-service-result-count">{visibleServices.length} {es ? "de" : "of"} {project.services.length}</span></div>
      {visibleServices.length ? <div className="project-services-grid">{visibleServices.map((service) => { const item = serviceTypes.find((type) => type.id === service.kind); const Icon = item?.Icon ?? CircleHelp; return <article className="project-service-card" key={service.id} role="link" tabIndex={0} aria-label={`${es ? "Abrir servicio" : "Open service"} ${service.name}`} onClick={(event) => { if ((event.target as HTMLElement).closest("button, a")) return; router.push(serviceHref(service)); }} onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); router.push(serviceHref(service)); } }}><div className="project-service-card-top"><span className="project-service-icon"><Icon size={19} /></span><span className="project-service-kind">{item ? (es ? item.es : item.en) : service.kind}</span><button type="button" className="project-unlink" title={es ? "Quitar del proyecto" : "Remove from project"} onClick={(event) => { event.stopPropagation(); setRemoveTarget(service); }}><X size={16} /></button></div><h3>{service.name}</h3>{service.appName ? <code className="project-app-name">{service.appName}</code> : null}<p>{service.description || (service.targetType === "container" ? es ? "Recurso de Docker" : "Docker resource" : service.targetType === "compose" ? "Docker Compose" : service.targetType === "git" ? es ? "Fuente de despliegue Git" : "Git deployment source" : es ? "Servicio del proyecto" : "Project service")}</p><div className="project-service-created"><CalendarClock size={13} /><span>{es ? "Creado" : "Created"} · {formatLocalDateTime(service.createdAt, language)}</span></div><div className="project-service-card-footer"><span className={`project-resource-state${service.targetType ? " is-linked" : ""}`}><i />{service.targetType ? (es ? "Conectado" : "Connected") : (es ? "Pendiente" : "Not deployed")}</span><span className="project-service-open">{es ? "Abrir servicio" : "Open service"}<ArrowRight size={14} /></span></div></article>; })}<button className="project-add-service-card" type="button" onClick={() => setServiceMenu(true)}><span><Plus size={20} /></span><strong>{es ? "Crear otro servicio" : "Create another service"}</strong><small>{es ? "Aplicación, base de datos, Compose o recurso existente" : "Application, database, Compose, or existing resource"}</small></button></div> : project.services.length ? <div className="project-services-empty"><span><Search size={22} /></span><h3>{es ? "No hay servicios que coincidan" : "No matching services"}</h3><p>{es ? "Prueba otra búsqueda o cambia el filtro de tipo." : "Try another search or change the type filter."}</p><button type="button" className="projects-secondary" onClick={() => { setServiceSearch(""); setServiceKindFilter("all"); }}>{es ? "Limpiar filtros" : "Clear filters"}</button></div> : <div className="project-services-empty"><span><Boxes size={23} /></span><h3>{es ? "Este proyecto aún no tiene servicios" : "This project has no services yet"}</h3><p>{es ? "Crea un servicio o importa uno que ya administre Vessel." : "Create a workspace and group its services."}</p><button className="projects-primary" type="button" onClick={() => setServiceMenu(true)}><Plus size={16} />{es ? "Crear el primer servicio" : "Create the first service"}</button></div>}
    </section>

    {environmentOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEnvironmentOpen(false); }}><section className="confirm-modal project-environment-modal" role="dialog" aria-modal="true" aria-labelledby="project-environment-title"><div className="project-modal-heading"><span className="project-environment-icon"><Layers3 size={19} /></span><div><span className="module-kicker">{es ? "VARIABLES COMPARTIDAS" : "SHARED VARIABLES"}</span><h2 id="project-environment-title">{es ? "Entorno del proyecto" : "Project Environment"}</h2><p>{es ? "Variables cifradas que pueden reutilizar los servicios de este proyecto." : "Encrypted variables that services in this project can reuse."}</p></div><button type="button" className="project-close" onClick={() => setEnvironmentOpen(false)} disabled={saving} aria-label={es ? "Cerrar" : "Close"}><X size={18} /></button></div><form className="project-environment-form" onSubmit={saveEnvironmentVariable}><label><span>{es ? "Clave" : "Name"}</span><input value={environmentName} onChange={(event) => setEnvironmentName(event.target.value)} maxLength={128} placeholder="DATABASE_URL" pattern="[A-Za-z_][A-Za-z0-9_]*" required /></label><label><span>{es ? "Valor" : "Value"}</span><input type="password" value={environmentValue} onChange={(event) => setEnvironmentValue(event.target.value)} maxLength={16384} autoComplete="new-password" placeholder={es ? "Valor protegido" : "Protected value"} required /></label><button className="projects-primary" type="submit" disabled={saving}><Plus size={15} />{es ? "Guardar variable" : "Save variable"}</button></form><div className="project-environment-list">{project.environmentNames.length ? project.environmentNames.map((variable) => <div key={variable}><code>{variable}</code><span>{es ? "Valor cifrado" : "Encrypted value"}</span><button type="button" onClick={() => void removeEnvironmentVariable(variable)} disabled={saving} aria-label={es ? `Eliminar ${variable}` : `Delete ${variable}`}><X size={15} /></button></div>) : <p>{es ? "Aún no hay variables compartidas." : "No shared variables yet."}</p>}</div><div className="project-environment-hint"><span>{es ? "Referencia una variable en un servicio con esta sintaxis:" : "Reference a project variable in a service with this syntax:"}</span><code>{'DATABASE_URL=${{project.DATABASE_URL}}'}</code></div>{notice ? <div className="projects-notice" role="status">{notice}<button type="button" onClick={() => setNotice("")} aria-label={es ? "Cerrar" : "Dismiss"}><X size={15} /></button></div> : null}</section></div> : null}

    {applicationOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setApplicationOpen(false); }}><form className="confirm-modal project-application-modal" role="dialog" aria-modal="true" aria-labelledby="application-create-title" onSubmit={createApplication}><div className="project-modal-heading"><span className="workspace-project-icon"><Globe size={20} /></span><div><span className="module-kicker">{es ? "NUEVA APLICACIÓN" : "NEW APPLICATION"}</span><h2 id="application-create-title">{es ? "Crear aplicación" : "Create application"}</h2><p>{es ? "Asigna un nombre y una descripción a tu aplicación." : "Assign a name and description to your application."}</p></div><button type="button" className="project-close" onClick={() => setApplicationOpen(false)} disabled={saving} aria-label={es ? "Cerrar" : "Close"}><X size={18} /></button></div><label className="modal-field"><span>{es ? "Nombre" : "Name"}</span><input autoFocus value={applicationName} onChange={(event) => { const value = event.target.value; setApplicationName(value); if (!applicationSlugEdited && project) setApplicationSlug(makeApplicationSlug(`${project.name}-${value || "app"}`)); }} minLength={2} maxLength={63} placeholder={es ? "por ejemplo, epale" : "e.g. epale"} required /></label><label className="modal-field"><span>{es ? "Nombre de aplicación" : "App Name"}</span><input value={applicationSlug} onChange={(event) => { setApplicationSlug(event.target.value); setApplicationSlugEdited(true); }} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="project-app" required /><small className="project-app-name-hint">{es ? "Identificador único de esta aplicación dentro del proyecto." : "Unique identifier for this application within the project."}</small></label><label className="modal-field"><span>{es ? "Descripción" : "Description"}<small>{es ? "Opcional" : "Optional"}</small></span><textarea value={applicationDescription} onChange={(event) => setApplicationDescription(event.target.value)} maxLength={500} rows={3} placeholder={es ? "Descripción de tu servicio..." : "Description of your service..."} /></label>{notice ? <div className="projects-notice" role="alert">{notice}</div> : null}<div className="modal-actions"><button type="button" onClick={() => setApplicationOpen(false)} disabled={saving}>{es ? "Cancelar" : "Cancel"}</button><button className="primary-button" type="submit" disabled={saving || applicationName.trim().length < 2 || !applicationSlug.trim()}>{saving ? <span className="spinner" /> : <Plus size={15} />}{es ? "Crear" : "Create"}</button></div></form></div> : null}
    {databasePicker ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDatabasePicker(false); }}><section className="confirm-modal database-picker-modal" role="dialog" aria-modal="true" aria-labelledby="database-picker-title"><div className="project-modal-heading"><span className="workspace-project-icon"><Database size={20} /></span><button type="button" className="project-close" onClick={() => setDatabasePicker(false)} aria-label={es ? "Cerrar" : "Close"}><X size={18} /></button><div><span className="module-kicker">{es ? "SERVICIO DE DATOS" : "DATA SERVICE"}</span><h2 id="database-picker-title">{es ? "Elige una base de datos" : "Choose a database"}</h2><p>{es ? "Vessel prepara un contenedor y credenciales iniciales aleatorias. Puedes editar la imagen y las variables antes de crearlo." : "Vessel prepares a container and random initial credentials. You can edit the image and variables before creating it."}</p></div></div><div className="database-preset-grid">{databasePresets.map((preset) => <button type="button" key={preset.id} onClick={() => createDatabase(preset.id)}><span className="database-preset-icon"><Database size={19} /></span><strong>{preset.name}</strong><small>{es ? preset.detailEs : preset.detailEn}</small><code>{preset.image}</code><ArrowRight size={15} /></button>)}</div><div className="project-import-empty">{es ? "El tag latest puede cambiar con el tiempo. Revisa y fija una versión antes de un uso estable." : "The latest tag can change over time. Review and pin a version before stable use."}</div></section></div> : null}
    {importOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setImportOpen(false); }}><form className="confirm-modal project-import-modal" role="dialog" aria-modal="true" aria-labelledby="project-import-title" onSubmit={importResource}><div className="project-modal-heading"><span className="workspace-project-icon"><ExternalLink size={20} /></span><button type="button" className="project-close" onClick={() => setImportOpen(false)} aria-label={es ? "Cerrar" : "Close"}><X size={18} /></button><div><span className="module-kicker">{es ? "VINCULAR RECURSO" : "LINK RESOURCE"}</span><h2 id="project-import-title">{es ? "Importar al proyecto" : "Import into project"}</h2><p>{es ? "Selecciona un recurso existente. Solo se añade una referencia al proyecto." : "Choose an existing resource. This only adds a project reference."}</p></div></div><div className="project-source-tabs" role="tablist">{([{ id: "container", Icon: Container, en: "Containers", es: "Contenedores" }, { id: "compose", Icon: Boxes, en: "Compose", es: "Compose" }] as Array<{ id: SourceType; Icon: typeof Container; en: string; es: string }>).map(({ id: type, Icon, en, es: label }) => <button type="button" key={type} className={sourceType === type ? "active" : ""} onClick={() => setSourceType(type)}><Icon size={15} />{es ? label : en}</button>)}</div><label className="modal-field"><span>{es ? "Recurso" : "Resource"}</span><VesselSelect value={targetRef} onChange={(event) => setTargetRef(event.target.value)} disabled={!targets.length}>{targets.map((target) => <option key={target.ref} value={target.ref}>{target.label} · {target.detail}</option>)}</VesselSelect></label>{!targets.length ? <div className="project-import-empty">{es ? "No se encontraron recursos de este tipo en Docker." : "No resources of this type were found in Docker."}</div> : null}{notice ? <div className="projects-notice" role="status">{notice}</div> : null}<div className="modal-actions"><button type="button" onClick={() => setImportOpen(false)} disabled={saving}>{es ? "Cancelar" : "Cancel"}</button><button className="primary-button" type="submit" disabled={saving || !targetRef}>{saving ? <span className="spinner" /> : <Plus size={15} />}{es ? "Añadir al proyecto" : "Add to project"}</button></div></form></div> : null}
    {removeTarget ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal project-confirm-modal" role="alertdialog" aria-modal="true"><span className="module-kicker">{es ? "QUITAR ASOCIACIÓN" : "REMOVE PROJECT LINK"}</span><h2>{es ? `¿Quitar ${removeTarget.name} del proyecto?` : `Remove ${removeTarget.name} from this project?`}</h2><p>{es ? "El recurso original no se detendrá ni se borrará." : "The original resource will not be stopped or deleted."}</p><div className="modal-actions"><button type="button" onClick={() => setRemoveTarget(null)}>{es ? "Cancelar" : "Cancel"}</button><button className="danger-button" type="button" disabled={saving} onClick={() => void unlinkService(removeTarget)}><X size={15} />{es ? "Quitar asociación" : "Remove link"}</button></div></section></div> : null}
    {scheduleOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setScheduleOpen(false); }}><section className="confirm-modal project-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="project-schedule-title"><header className="project-modal-heading"><span className="workspace-project-icon"><CalendarClock size={20} /></span><button type="button" className="project-close" onClick={() => setScheduleOpen(false)} aria-label={es ? "Cerrar" : "Close"}><X size={18} /></button><div><span className="module-kicker">{es ? "PROGRAMACIÓN DEL PROYECTO" : "PROJECT SCHEDULER"}</span><h2 id="project-schedule-title">{es ? "Agendar una acción" : "Schedule an action"}</h2><p>{es ? "La tarea se ejecuta en el Engine seleccionado. Las acciones Git down + up aplican la revisión más reciente al llegar la hora." : "The task runs on the selected Engine. Git down + up applies the latest revision at the scheduled time."}</p></div></header>
      <form onSubmit={saveProjectSchedule} className="project-schedule-form"><div className="project-schedule-fields"><label className="modal-field"><span>{es ? "Servicio" : "Service"}</span><VesselSelect value={scheduleServiceId} onChange={(event) => setScheduleServiceId(event.target.value)}><option value="">{es ? "Seleccionar servicio…" : "Select a service…"}</option>{project?.services.filter((service) => service.targetType && service.targetRef).map((service) => <option key={service.id} value={service.id}>{service.name} · {service.targetType === "git" ? "Git" : service.targetType === "compose" ? "Compose" : es ? "Contenedor" : "Container"}</option>)}</VesselSelect></label><label className="modal-field"><span>{es ? "Acción" : "Action"}</span><VesselSelect value={scheduleOperation} onChange={(event) => setScheduleOperation(event.target.value as ProjectSchedule["action"])}><option value="restart">{es ? "Reiniciar" : "Restart"}</option><option value="start">{es ? "Iniciar" : "Start"}</option><option value="down">{es ? "Bajar / detener" : "Down / stop"}</option><option value="down_up">{es ? "Bajar y volver a levantar" : "Down and bring back up"}</option></VesselSelect></label><label className="modal-field"><span>{es ? "Fecha y hora" : "Date and time"}</span><input type="datetime-local" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} required /></label><label className="modal-field"><span>{es ? "Repetición" : "Repeat"}</span><VesselSelect value={scheduleRepeat} onChange={(event) => setScheduleRepeat(event.target.value as ProjectSchedule["repeatMode"])}><option value="once">{es ? "Una vez" : "Once"}</option><option value="daily">{es ? "Todos los días" : "Every day"}</option><option value="weekly">{es ? "Días seleccionados" : "Selected weekdays"}</option></VesselSelect></label></div>
      {scheduleRepeat === "weekly" ? <fieldset className="schedule-chip-field"><legend>{es ? "Días" : "Weekdays"}</legend><div>{(es ? ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map((day, index) => <label key={day} className={scheduleWeekdays.includes(index) ? "is-selected" : ""}><input type="checkbox" checked={scheduleWeekdays.includes(index)} onChange={(event) => setScheduleWeekdays((current) => event.target.checked ? [...current, index] : current.filter((item) => item !== index))} />{day}</label>)}</div></fieldset> : null}
      {scheduleRepeat !== "once" ? <><fieldset className="schedule-chip-field"><legend>{es ? "Meses activos" : "Active months"}</legend><div>{(es ? ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"] : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]).map((month, index) => <label key={month} className={scheduleMonths.includes(index + 1) ? "is-selected" : ""}><input type="checkbox" checked={scheduleMonths.includes(index + 1)} onChange={(event) => setScheduleMonths((current) => event.target.checked ? [...current, index + 1] : current.filter((item) => item !== index + 1))} />{month}</label>)}</div></fieldset><label className="modal-field project-schedule-end"><span>{es ? "Repetir hasta (opcional)" : "Repeat until (optional)"}</span><input type="date" value={scheduleEnd ? scheduleEnd.slice(0,10) : ""} onChange={(event) => setScheduleEnd(event.target.value ? `${event.target.value}T23:59:00` : "")} /></label></> : null}
      {project?.services.find((service) => service.id === scheduleServiceId)?.targetType === "git" && scheduleOperation === "down_up" ? <div className="project-schedule-note"><CalendarClock size={16} /><span>{es ? "Los commits y webhooks no desplegarán inmediatamente. Vessel los aplicará en esta programación usando la revisión más reciente de la rama." : "Commits and webhooks will not deploy immediately. Vessel will apply them at this scheduled time using the branch's latest revision."}</span></div> : null}
      {notice ? <div className="projects-notice" role="status">{notice}</div> : null}<footer className="modal-actions"><button type="button" onClick={() => setScheduleOpen(false)} disabled={saving}>{es ? "Cerrar" : "Close"}</button><button className="projects-primary" type="submit" disabled={saving || !scheduleServiceId || !scheduleStart}>{saving ? <span className="spinner" /> : <CalendarClock size={15} />}{es ? "Agendar" : "Schedule"}</button></footer></form>
      {projectSchedules.length ? <div className="project-schedule-list"><h3>{es ? "Programaciones" : "Scheduled actions"}</h3>{projectSchedules.map((item) => <article key={item.id}><div><strong>{project?.services.find((service) => service.id === item.serviceId)?.name ?? (es ? "Servicio" : "Service")} · {item.action === "down_up" ? (es ? "Bajar y levantar" : "Down and up") : item.action === "down" ? (es ? "Bajar" : "Down") : item.action === "start" ? (es ? "Iniciar" : "Start") : (es ? "Reiniciar" : "Restart")}</strong><small>{formatLocalDateTime(item.startsAt, language)} · {item.repeatMode === "once" ? (es ? "Una vez" : "Once") : item.repeatMode === "daily" ? (es ? "Diaria" : "Daily") : (es ? "Semanal" : "Weekly")}{item.lastRunStatus !== "scheduled" ? ` · ${item.lastRunStatus === "running" ? (es ? "En curso" : "Running") : item.lastRunStatus === "succeeded" ? (es ? "Completada" : "Completed") : (es ? "Fallida" : "Failed")}` : !item.enabled ? ` · ${es ? "Inactiva" : "Inactive"}` : ""}</small>{item.lastError ? <small className="project-schedule-error">{item.lastError}</small> : null}</div>{item.enabled ? <button type="button" className="projects-secondary" onClick={() => void removeProjectSchedule(item.id)} disabled={saving}><Trash2 size={14} />{es ? "Cancelar" : "Cancel"}</button> : null}</article>)}</div> : null}
    </section></div> : null}
    {deleteOpen ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal project-confirm-modal" role="alertdialog" aria-modal="true"><span className="module-kicker">{es ? "ELIMINAR PROYECTO" : "DELETE PROJECT"}</span><h2>{es ? `¿Eliminar ${project.name}?` : `Delete ${project.name}?`}</h2>{project.services.length ? <div className="project-delete-warning"><Boxes size={18} /><span>{es ? `Este proyecto tiene ${project.services.length} servicio(s). Quítalos primero para poder eliminarlo.` : `This project has ${project.services.length} service(s). Remove them first to delete the project.`}</span></div> : <p>{es ? "Se borrará el proyecto y sus asociaciones de Vessel. Los contenedores, archivos Compose y repositorios permanecerán intactos." : "The project and its Vessel links will be removed. Containers, Compose files, and repositories will remain untouched."}</p>}<div className="modal-actions"><button type="button" onClick={() => setDeleteOpen(false)} disabled={saving}>{es ? "Cancelar" : "Cancel"}</button><button className="danger-button" type="button" onClick={() => void deleteProject()} disabled={saving || project.services.length > 0}><Trash2 size={15} />{es ? "Eliminar proyecto" : "Delete project"}</button></div></section></div> : null}
  </main>;
}

function FolderKanbanIcon() { return <Layers3 size={17} />; }
