"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, Check, CheckCircle2, CircleAlert, Copy, Eye, FilePlus2, LoaderCircle, Power, Rocket, Wrench, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { CodeLoadingSkeleton, ComposeProjectsLoadingSkeleton } from "@/app/components/LoadingSkeletons";
import { ComposeYamlEditor } from "./ComposeYamlEditor";
import "../globals.css";

const starter = `services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"`;
type Project = { name: string; source: string; containers: string[]; configFiles?: string[]; status?: string };
type ComposeAction = "preview" | "validate" | "up" | "up_service" | "down";
type YamlDiagnostic = { message: string; line?: number; column?: number };

function yamlDiagnostic(raw: string, language: "es" | "en"): YamlDiagnostic {
  const location = raw.match(/at L(\d+)\.C(\d+):\s*([^\r\n]+)/i);
  const line = location ? Number(location[1]) : undefined;
  const column = location ? Number(location[2]) : undefined;
  const reason = location?.[3]?.trim() ?? raw.replace(/^failed to parse\s+[^:]+:\s*/i, "").trim();
  const explanations: Record<string, { es: string; en: string }> = {
    "mapping values are not allowed in this context": {
      es: "Hay un valor o dos puntos (`:`) en una posición no válida. Revisa la indentación, los dos puntos y las comillas de esta línea.",
      en: "A value or colon (`:`) appears in an invalid position. Check this line's indentation, colons, and quotes.",
    },
    "did not find expected key": { es: "Falta una clave válida. Revisa la indentación y el formato `clave: valor`.", en: "A valid key is missing. Check indentation and the `key: value` format." },
    "found character that cannot start any token": { es: "Hay un carácter que no puede iniciar un valor YAML. Revisa las comillas y caracteres especiales.", en: "A character that cannot start a YAML value was found. Check quotes and special characters." },
    "could not find expected ':'": { es: "Faltan los dos puntos (`:`) después de una clave.", en: "A colon (`:`) is missing after a key." },
    "did not find expected ',' or ']'": { es: "La lista entre corchetes no está cerrada correctamente; revisa las comas y `]`.", en: "The bracketed list is not closed correctly; check commas and `]`." },
    "did not find expected ',' or '}'": { es: "El objeto entre llaves no está cerrado correctamente; revisa las comas y `}`.", en: "The braced object is not closed correctly; check commas and `}`." },
    "unexpected end of stream": { es: "El archivo terminó antes de cerrar una estructura YAML. Revisa comillas, corchetes e indentación.", en: "The file ended before a YAML structure was closed. Check quotes, brackets, and indentation." },
    "duplicate key": { es: "Hay una clave duplicada en el mismo bloque YAML.", en: "A key is duplicated in the same YAML block." },
  };
  const known = Object.entries(explanations).find(([pattern]) => reason.toLowerCase().includes(pattern));
  const explanation = known?.[1][language] ?? (language === "es" ? "Docker Compose encontró un error de sintaxis YAML. Revisa la estructura e indentación." : "Docker Compose found a YAML syntax error. Check the structure and indentation.");
  const message = line
    ? language === "es" ? `Error YAML en línea ${line}, columna ${column}: ${explanation}` : `YAML error on line ${line}, column ${column}: ${explanation}`
    : explanation;
  return { message, line, column };
}

function loadErrorMessage(language: "es" | "en", status: number, error?: string) {
  if (status === 401) return language === "es" ? "Tu sesión expiró. Inicia sesión de nuevo." : "Your session expired. Sign in again.";
  if (status === 403) return language === "es" ? "Solo un administrador puede leer o editar esta configuración Compose." : "Only an administrator can read or edit this Compose configuration.";
  if (status === 409) return language === "es"
    ? "Docker detectó el proyecto y la ruta del Compose, pero Vessel no puede leer ese archivo. Monta en Vessel la carpeta del archivo para poder editarlo; la detección no necesita una ruta configurada manualmente."
    : "Docker discovered the project and Compose path, but Vessel cannot read that file. Mount its directory into Vessel to edit it; discovery itself does not need a manually configured path.";
  return error ?? (language === "es" ? "No fue posible cargar el proyecto Compose." : "Could not load the Compose project.");
}

export default function ComposePage() {
  const { language } = useI18n();
  const [name, setName] = useState("my-project");
  const [yaml, setYaml] = useState(starter);
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const [selectedService, setSelectedService] = useState("");
  const [composeSource, setComposeSource] = useState("vessel");
  const [sourceLoaded, setSourceLoaded] = useState(true);
  const [projectContext, setProjectContext] = useState<{ id: string; kind: "compose" | "template" } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewYaml, setPreviewYaml] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewCopied, setPreviewCopied] = useState(false);
  const [yamlEdited, setYamlEdited] = useState(false);
  const [yamlValidation, setYamlValidation] = useState<{ state: "idle" | "checking" | "valid" | "invalid"; message?: string; line?: number; column?: number }>(({ state: "idle" }));
  const validationSequence = useRef(0);

  useEffect(() => {
    if (!yamlEdited || !sourceLoaded || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/.test(name)) return;
    const sequence = ++validationSequence.current;
    const controller = new AbortController();
    setYamlValidation({ state: "checking" });
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/compose", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ name, yaml, action: "validate", ...(projectContext ? { projectId: projectContext.id, projectServiceKind: projectContext.kind } : {}) }),
          cache: "no-store",
        });
        const data = await response.json();
        if (sequence !== validationSequence.current) return;
        setYamlValidation(response.ok && data.ok
          ? { state: "valid", message: language === "es" ? "Compose válido" : "Compose is valid" }
          : { state: "invalid", ...yamlDiagnostic(data.details || data.error || "", language) });
      } catch (error) {
        if (controller.signal.aborted || sequence !== validationSequence.current) return;
        setYamlValidation({ state: "invalid", message: error instanceof Error ? error.message : (language === "es" ? "No fue posible validar" : "Could not validate") });
      }
    }, 700);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [yaml, yamlEdited, sourceLoaded, name, language, projectContext]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedProject = params.get("project") ?? "";
    const requestedService = params.get("service") ?? "";
    const vesselProjectId = params.get("vesselProjectId") ?? "";
    const isNewProjectCompose = params.get("new") === "1";
    if (vesselProjectId && isNewProjectCompose) {
      setProjectContext({ id: vesselProjectId, kind: params.get("template") === "web" ? "template" : "compose" });
      const proposedName = params.get("projectName") ?? "my-project";
      if (/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/.test(proposedName)) setName(proposedName);
      if (params.get("template") === "web") setOutput(language === "es" ? "Plantilla web preparada. Revisa el puerto y la imagen antes de desplegar." : "Web template prepared. Review the port and image before deployment.");
    }
    if (requestedService) setSelectedService(requestedService);
    if (requestedProject) setSourceLoaded(false);

    async function discoverProjects() {
      try {
        const response = await fetch("/api/compose", { cache: "no-store" });
        const data = await response.json();
        const discovered = data.data ?? [];
        setProjects(discovered);
        if (!requestedProject) return;

        setName(requestedProject);
        const projectResponse = await fetch(`/api/compose?name=${encodeURIComponent(requestedProject)}`, { cache: "no-store" });
        const projectData = await projectResponse.json();
        if (!projectResponse.ok || !projectData.yaml) {
          setOutput(loadErrorMessage(language, projectResponse.status, projectData.error));
          return;
        }
        setYaml(projectData.yaml);
        setYamlEdited(false);
        setYamlValidation({ state: "idle" });
        setComposeSource(projectData.source ?? "vessel");
        setSourceLoaded(true);
        if (!discovered.some((project: Project) => project.name === requestedProject)) {
          setProjects((current) => [...current, { name: requestedProject, source: projectData.source ?? "vessel", containers: [] }]);
        }
        window.requestAnimationFrame(() => document.getElementById("compose-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      } catch {
        setOutput(language === "es" ? "No fue posible consultar Docker Compose." : "Could not query Docker Compose.");
      } finally {
        setDiscovering(false);
      }
    }

    void discoverProjects();
  }, []);

  async function selectProject(project: Project) {
    setProjectContext(null);
    setSelectedService("");
    setSourceLoaded(false);
    setName(project.name);
    const url = new URL(window.location.href);
    url.searchParams.set("project", project.name);
    url.searchParams.delete("service");
    url.searchParams.delete("vesselProjectId");
    url.searchParams.delete("new");
    url.searchParams.delete("template");
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);

    try {
      const response = await fetch(`/api/compose?name=${encodeURIComponent(project.name)}`, { cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.yaml) {
        setYaml(data.yaml);
        setYamlEdited(false);
        setYamlValidation({ state: "idle" });
        setComposeSource(data.source ?? "vessel");
        setSourceLoaded(true);
        setOutput(language === "es"
          ? "Compose cargado. Solo los administradores pueden consultar esta configuración, que podría contener secretos."
          : "Compose loaded. Only administrators can read this configuration, which may contain secrets.");
      } else {
        setOutput(loadErrorMessage(language, response.status, data.error));
      }
    } catch {
      setOutput(language === "es" ? "No fue posible cargar el proyecto Compose." : "Could not load the Compose project.");
    }
    window.requestAnimationFrame(() => document.getElementById("compose-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function createComposeProject() {
    setProjectContext(null);
    setSelectedService("");
    setName("");
    setYaml(starter);
    setYamlEdited(false);
    setYamlValidation({ state: "idle" });
    setSourceLoaded(true);
    setComposeSource("vessel");
    setOutput(language === "es" ? "Nuevo proyecto preparado. Asigna un nombre, edita el YAML y despliega cuando esté válido." : "New project is ready. Name it, edit the YAML, and deploy when it is valid.");
    const url = new URL(window.location.href);
    ["project", "service", "vesselProjectId", "new", "template"].forEach((key) => url.searchParams.delete(key));
    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
    window.requestAnimationFrame(() => document.getElementById("compose-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function execute(action: ComposeAction) {
    if (!sourceLoaded || (action === "up_service" && !selectedService)) return;
    setBusy(true);
    setOutput("");
    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, yaml, action, ...(action === "up_service" ? { service: selectedService } : {}), ...(projectContext ? { projectId: projectContext.id, projectServiceKind: projectContext.kind } : {}) }),
        cache: "no-store",
      });
      const data = await response.json();
      if (data.ok) {
        setComposeSource(data.source ?? "vessel");
        if (action === "validate") setYamlValidation({ state: "valid", message: language === "es" ? "Compose válido" : "Compose is valid" });
        if (action === "up" && projectContext) {
          setProjectContext(null);
          const url = new URL(window.location.href);
          url.searchParams.delete("vesselProjectId");
          url.searchParams.delete("new");
          url.searchParams.delete("template");
          url.searchParams.set("project", name);
          window.history.replaceState({}, "", `${url.pathname}${url.search}`);
        }
        if (action === "validate") {
          setOutput(language === "es" ? "Configuración válida." : "Configuration is valid.");
        } else if (action === "up_service") {
          setOutput(language === "es"
            ? `Se aplicó ${selectedService}. Vessel actualizó solo ese servicio, sin reconciliar los demás servicios del proyecto.`
            : `Applied ${selectedService}. Vessel updated only that service and did not reconcile the other project services.`);
        } else if (action === "up") {
          setOutput(projectContext
            ? language === "es" ? "Proyecto desplegado y asociado al espacio de trabajo." : "Project deployed and linked to the workspace."
            : language === "es" ? "Proyecto desplegado." : "Project deployed.");
          void fetch("/api/compose", { cache: "no-store" }).then((response) => response.json()).then((payload) => setProjects(payload.data ?? [])).catch(() => undefined);
        } else {
          setOutput(language === "es" ? "Proyecto detenido." : "Project stopped.");
        }
      } else {
        if (data.details || action === "validate") {
          const diagnostic = yamlDiagnostic(data.details || data.error || "", language);
          setYamlValidation({ state: "invalid", ...diagnostic });
          setOutput(diagnostic.message);
        }
        if (!data.details && action !== "validate") setOutput(response.status === 403
          ? (language === "es" ? "Solo un administrador puede administrar proyectos Compose." : "Only an administrator can manage Compose projects.")
          : response.status === 401
            ? (language === "es" ? "Tu sesión expiró. Inicia sesión de nuevo." : "Your session expired. Sign in again.")
            : data.error ?? (language === "es" ? "La operación Compose falló." : "Compose operation failed."));
      }
    } catch (error) {
      setOutput(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function openPreview() {
    setPreviewOpen(true);
    setPreviewBusy(true);
    setPreviewYaml("");
    setPreviewError("");
    setPreviewCopied(false);
    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, yaml, action: "preview", ...(projectContext ? { projectId: projectContext.id, projectServiceKind: projectContext.kind } : {}) }),
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const diagnostic = yamlDiagnostic(data.details || data.error || "", language);
        setPreviewError(diagnostic.message);
        if (data.details) setYamlValidation({ state: "invalid", ...diagnostic });
      } else {
        setPreviewYaml(data.yaml ?? "");
      }
    } catch {
      setPreviewError(language === "es" ? "No se pudo consultar Docker para generar la vista previa." : "Could not query Docker to generate the preview.");
    } finally {
      setPreviewBusy(false);
    }
  }

  async function copyPreview() {
    try {
      await navigator.clipboard.writeText(previewYaml);
      setPreviewCopied(true);
      window.setTimeout(() => setPreviewCopied(false), 1800);
    } catch {
      setPreviewError(language === "es" ? "No se pudo copiar el Compose." : "Could not copy the Compose file.");
    }
  }

  const composeNameValid = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/.test(name);
  const canDeployCompose = sourceLoaded && composeNameValid && yamlValidation.state !== "checking" && yamlValidation.state !== "invalid";

  return <main className="module-main">
    <header className="module-header">
      <div>
        <span className="module-kicker">Vessel · Docker</span>
        <h1>{language === "es" ? "Proyectos Compose" : "Compose projects"}</h1>
        <p>{language === "es" ? "Detecta, edita, valida y despliega proyectos Docker Compose desde un solo plano de control." : "Discover, edit, validate, and deploy Docker Compose projects from one control plane."}</p>
      </div>
      <button type="button" className="secondary-button compose-create-button" onClick={createComposeProject}><FilePlus2 size={16} />{language === "es" ? "Nuevo proyecto Compose" : "New Compose project"}</button>
    </header>

    {selectedService ? <section className="compose-edit-context" aria-live="polite">
      <span className="compose-edit-context-icon"><Wrench size={18} /></span>
      <div>
        <strong>{language === "es" ? `Editando ${selectedService} · proyecto ${name}` : `Editing ${selectedService} · project ${name}`}</strong>
        <p>{language === "es" ? "Edita la definición del servicio en Compose, valida los cambios y aplícalos a este servicio. Así Compose conserva la configuración como fuente de verdad." : "Edit the service definition in Compose, validate it, and apply it to this service. Compose remains the source of truth."}</p>
        {composeSource !== "vessel" ? <small>{language === "es" ? "Al aplicar, Vessel guardará una copia administrada del archivo. El archivo externo original no se modificará." : "When applied, Vessel saves a managed copy of the file. The original external file is not modified."}</small> : null}
      </div>
    </section> : null}

    <section className="compose-discovery module-panel">
      <div className="section-heading">
        <div>
          <strong>{language === "es" ? "Proyectos detectados" : "Detected projects"}</strong>
          <small>{language === "es" ? "Docker labels y proyectos administrados por Vessel" : "Docker labels and Vessel-managed projects"}</small>
        </div>
        <span className="count-badge">{projects.length}</span>
      </div>
      {discovering ? <ComposeProjectsLoadingSkeleton label={language === "es" ? "Cargando proyectos Compose" : "Loading Compose projects"} />
        : projects.length ? <div className="project-grid">{projects.map((project) => <button type="button" className={`project-card ${project.name === name ? "selected" : ""}`} key={project.name} onClick={() => void selectProject(project)}>
          <span className="project-icon"><Boxes size={17} /></span>
          <span><strong>{project.name}</strong><small>{project.containers.length} {language === "es" ? "contenedor(es)" : "container(s)"}{project.status ? ` · ${project.status}` : ""}</small>{project.configFiles?.[0] ? <small className="compose-project-path" title={project.configFiles[0]}>{project.configFiles[0]}</small> : null}</span>
          <span className="project-source">{project.source === "vessel" ? "Vessel" : "Docker Compose"}</span>
        </button>)}</div>
          : <p className="empty-state">{language === "es" ? "No se detectaron proyectos Compose." : "No Compose projects detected."}</p>}
    </section>

    <section className="compose-workspace" id="compose-workspace">
      <div className="compose-editor">
        <label className="compose-name-field">{language === "es" ? "Nombre del proyecto" : "Project name"}<input value={name} onChange={(event) => { setName(event.target.value); setYamlEdited(true); }} placeholder={language === "es" ? "p. ej. mi-aplicacion" : "e.g. my-application"} disabled={Boolean(selectedService)} /></label>
        <div className="compose-yaml-field">
          <div className="compose-yaml-heading">
            <label>{language === "es" ? "Definición Compose (YAML)" : "Compose definition (YAML)"}</label>
            <span><code>YAML</code>{yamlValidation.state === "checking" ? <small className="is-checking"><LoaderCircle size={13} />{language === "es" ? "Comprobando…" : "Checking…"}</small> : yamlValidation.state === "valid" ? <small className="is-valid"><CheckCircle2 size={14} />{yamlValidation.message}</small> : yamlValidation.state === "invalid" ? <small className="is-invalid"><CircleAlert size={14} />{language === "es" ? "Revisar configuración" : "Review configuration"}</small> : <small>{language === "es" ? "Validación automática" : "Live validation"}</small>}</span>
          </div>
          <ComposeYamlEditor value={yaml} onChange={(next) => { setYaml(next); setYamlEdited(true); }} disabled={!sourceLoaded} label={language === "es" ? "Definición Compose YAML" : "Compose YAML definition"} errorLine={yamlValidation.state === "invalid" ? yamlValidation.line : null} />
          {yamlValidation.state === "invalid" && yamlValidation.message ? <div className="compose-yaml-diagnostics" role="alert"><CircleAlert size={16} /><span>{yamlValidation.message}</span></div> : <p className="compose-yaml-help">{language === "es" ? "La configuración se comprueba con Docker Compose mientras escribes. Los cambios no se guardan hasta desplegar." : "Docker Compose checks the configuration as you type. Changes are not saved until deployment."}</p>}
        </div>
        {selectedService ? <div className="compose-target-note"><CircleAlert size={15} /><span>{language === "es" ? `La acción de aplicar actualizará ${selectedService} solamente; los demás servicios del proyecto no se reconciliarán.` : `Apply will update ${selectedService} only; other services in the project will not be reconciled.`}</span></div> : null}
        <div className="module-actions">
          <button type="button" className="compose-action compose-action-preview" onClick={() => void openPreview()} disabled={busy || previewBusy || !sourceLoaded}><Eye size={16} />{language === "es" ? "Vista previa Docker" : "Preview Compose"}</button>
          <button type="button" className="compose-action compose-action-validate" onClick={() => void execute("validate")} disabled={busy || !sourceLoaded}><CheckCircle2 size={16} />{language === "es" ? "Validar configuración" : "Validate configuration"}</button>
          {selectedService
          ? <button className="primary-button compose-action-deploy" type="button" onClick={() => void execute("up_service")} disabled={busy || !canDeployCompose}><Rocket size={16} />{language === "es" ? `Aplicar a ${selectedService}` : `Apply to ${selectedService}`}</button>
            : <button className="primary-button compose-action-deploy" type="button" onClick={() => void execute("up")} disabled={busy || !canDeployCompose}><Rocket size={16} />{language === "es" ? "Desplegar proyecto" : "Deploy project"}</button>}
          {!selectedService ? <button className="danger-button compose-action-stop" type="button" onClick={() => void execute("down")} disabled={busy || !sourceLoaded}><Power size={15} />{language === "es" ? "Detener proyecto" : "Stop project"}</button> : null}
        </div>
      </div>
      <pre className="module-output">{output || (language === "es" ? "La validación y el resultado de Docker Compose aparecerán aquí." : "Docker Compose validation and results will appear here.")}</pre>
    </section>

    {previewOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !previewBusy) setPreviewOpen(false); }}><section className="confirm-modal compose-preview-modal" role="dialog" aria-modal="true" aria-labelledby="compose-preview-title"><header className="compose-preview-heading"><span className="compose-preview-mark"><Boxes size={20} /></span><div><span className="module-kicker">DOCKER COMPOSE</span><h2 id="compose-preview-title">{language === "es" ? "Compose convertido" : "Converted Compose"}</h2><p>{language === "es" ? `Vista previa de ${name} generada por Docker.` : `Docker-generated preview for ${name}.`}</p></div><button className="compose-preview-close" type="button" onClick={() => setPreviewOpen(false)} disabled={previewBusy} aria-label={language === "es" ? "Cerrar vista previa" : "Close preview"}><X size={18} /></button></header>
      <p className="compose-preview-note">{language === "es" ? "Docker normaliza el archivo y las variables quedan sin resolver para proteger valores del entorno. Para convertirlo con dominios se necesita configurar al menos uno; Vessel aún no ofrece configuración de dominios para este proyecto." : "Docker normalizes the file and leaves variables unresolved to protect environment values. Domain conversion requires at least one configured domain; Vessel does not yet provide domain settings for this project."}</p>
      {previewError ? <div className="compose-preview-error" role="alert"><CircleAlert size={16} /><div><strong>{previewError}</strong>{previewYaml ? <pre>{previewYaml}</pre> : null}</div></div> : null}
      {previewBusy ? <div className="compose-preview-loading"><CodeLoadingSkeleton /></div> : previewYaml && !previewError ? <pre className="compose-preview-code">{previewYaml}</pre> : null}
      <footer className="compose-preview-actions"><button type="button" onClick={() => setPreviewOpen(false)} disabled={previewBusy}>{language === "es" ? "Cerrar" : "Close"}</button><button className="primary-button" type="button" onClick={() => void copyPreview()} disabled={previewBusy || !previewYaml || Boolean(previewError)}>{previewCopied ? <Check size={15} /> : <Copy size={15} />}{previewCopied ? language === "es" ? "Copiado" : "Copied" : language === "es" ? "Copiar YAML" : "Copy YAML"}</button></footer>
    </section></div> : null}
  </main>;
}
