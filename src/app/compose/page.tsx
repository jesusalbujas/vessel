"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, Check, CheckCircle2, CircleAlert, Copy, Eye, FilePlus2, FileText, LoaderCircle, Power, Rocket, Save, Wrench, X, Play, RotateCw, ScrollText, Square, Layers3 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { CodeLoadingSkeleton, ComposeProjectsLoadingSkeleton } from "@/app/components/LoadingSkeletons";
import { ComposeYamlEditor } from "./ComposeYamlEditor";
import "../globals.css";

const starter = `services:\n  web:\n    image: nginx:alpine\n    ports:\n      - "8080:80"`;
type Project = { name: string; source: string; containers: string[]; configFiles?: string[]; status?: string };
type ComposeAction = "preview" | "validate" | "save" | "save_env" | "services" | "up" | "up_service" | "start" | "stop" | "restart" | "logs" | "down";
type YamlDiagnostic = { message: string; line?: number; column?: number; detail?: string };

function duplicateYamlKey(source: string): { key: string; line: number; firstLine: number; column: number } | null {
  const scopes: Array<{ indent: number; keys: Map<string, number> }> = [{ indent: -1, keys: new Map() }];
  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    if (!rawLine.trim() || rawLine.trimStart().startsWith("#") || rawLine.trimStart().startsWith("- ")) continue;
    const match = rawLine.match(/^( *)(?:'((?:[^']|'')*)'|"((?:[^"\\]|\\.)*)"|([^:#][^:]*?))\s*:\s*(.*?)\s*(?:#.*)?$/);
    if (!match) continue;
    const indent = match[1].length;
    while (scopes.length > 1 && indent <= scopes[scopes.length - 1].indent) scopes.pop();
    const key = (match[2] ?? match[3] ?? match[4] ?? "").replace(/''/g, "'").trim();
    const parent = scopes[scopes.length - 1];
    const firstLine = parent.keys.get(key);
    if (firstLine !== undefined) return { key, line: index + 1, firstLine, column: indent + 1 };
    parent.keys.set(key, index + 1);
    if (!match[5]) scopes.push({ indent, keys: new Map() });
  }
  return null;
}

function duplicateKeyDiagnostic(source: string, language: "es" | "en"): YamlDiagnostic | null {
  const duplicate = duplicateYamlKey(source);
  if (!duplicate) return null;
  const message = language === "es"
    ? `Clave YAML duplicada “${duplicate.key}” en la línea ${duplicate.line}; ya aparece en la línea ${duplicate.firstLine}.`
    : `Duplicate YAML key “${duplicate.key}” on line ${duplicate.line}; it was first declared on line ${duplicate.firstLine}.`;
  return { message, line: duplicate.line, column: duplicate.column };
}

function yamlDiagnostic(raw: string, language: "es" | "en"): YamlDiagnostic {
  const scannerLocation = raw.match(/at L(\d+)\.C(\d+):\s*([^\r\n]+)/i);
  const yamlLineLocation = raw.match(/(?:yaml:\s*)?line\s+(\d+)(?::\s*([^\r\n]+))?/i);
  const line = scannerLocation ? Number(scannerLocation[1]) : yamlLineLocation ? Number(yamlLineLocation[1]) : undefined;
  const column = scannerLocation ? Number(scannerLocation[2]) : undefined;
  const reason = scannerLocation?.[3]?.trim() ?? yamlLineLocation?.[2]?.trim() ?? raw.replace(/^failed to parse\s+.*?:\s*/i, "").trim();
  const detail = raw
    .replace(/^failed to parse\s+.*?:\s*/i, "")
    .replace(/(?:\/[^\s:'"]+)*\.vessel-validate-[^/\s:'"]+\/compose\.ya?ml/g, "Compose YAML")
    .trim()
    .slice(-1200);
  const missingVariables = [...raw.matchAll(/The ["']([^"']+)["'] variable is not set/gi)].map((match) => match[1]);
  if (missingVariables.length || /invalid spec:\s*:/i.test(raw)) {
    const names = [...new Set(missingVariables)];
    const message = language === "es"
      ? `Faltan variables de Compose${names.length ? `: ${names.join(", ")}` : ""}. Añádelas al archivo .env del proyecto o define valores predeterminados, por ejemplo \`\${POSTGRES_PORT:-5432}\`.`
      : `Compose variables are missing${names.length ? `: ${names.join(", ")}` : ""}. Add them to the project's .env file or define defaults, for example \`\${POSTGRES_PORT:-5432}\`.`;
    return { message, detail };
  }
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
    "mapping key ": { es: "Hay una clave repetida en el mismo nivel. Cada clave debe aparecer una sola vez dentro de su bloque.", en: "A key is repeated at the same level. Each key must appear only once in its block." },
    "already defined": { es: "Esta clave ya fue definida en otra línea. Revisa si repetiste una sección como `services:` o `networks:`.", en: "This key was already defined on another line. Check whether a section such as `services:` or `networks:` is repeated." },
    "did not find expected '-' indicator": { es: "La lista YAML está mal formada. Revisa los guiones y la indentación de sus elementos.", en: "The YAML list is malformed. Check the dashes and indentation of its items." },
  };
  const known = Object.entries(explanations).find(([pattern]) => reason.toLowerCase().includes(pattern));
  const explanation = known?.[1][language] ?? (language === "es" ? "Docker Compose encontró un error de sintaxis YAML. Revisa la estructura e indentación." : "Docker Compose found a YAML syntax error. Check the structure and indentation.");
  const message = line
    ? language === "es" ? `Error YAML en línea ${line}, columna ${column}: ${explanation}` : `YAML error on line ${line}, column ${column}: ${explanation}`
    : explanation;
  return { message, line, column, ...(detail ? { detail } : {}) };
}

function loadErrorMessage(language: "es" | "en", status: number, error?: string) {
  if (status === 401) return language === "es" ? "Tu sesión expiró. Inicia sesión de nuevo." : "Your session expired. Sign in again.";
  if (status === 403) return language === "es" ? "Solo un administrador puede leer o editar esta configuración Compose." : "Only an administrator can read or edit this Compose configuration.";
  if (status === 409) return language === "es"
    ? "Docker detectó el archivo, pero el Engine no permitió leerlo. Revisa que la ruta exista y que el usuario de Vessel pueda acceder al host."
    : "Docker discovered the file, but the Engine could not read it. Check that the path exists and Vessel can access the host.";
  return error ?? (language === "es" ? "No fue posible cargar el proyecto Compose." : "Could not load the Compose project.");
}

export default function ComposePage() {
  const { language } = useI18n();
  const [name, setName] = useState("my-project");
  const [yaml, setYaml] = useState(starter);
  const [envFileText, setEnvFileText] = useState("");
  const [envEdited, setEnvEdited] = useState(false);
  const [editorFile, setEditorFile] = useState<"compose" | "env">("compose");
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
  const [yamlValidation, setYamlValidation] = useState<{ state: "idle" | "checking" | "valid" | "invalid"; message?: string; line?: number; column?: number; detail?: string }>(({ state: "idle" }));
  const [composeActionDialog, setComposeActionDialog] = useState<ComposeAction | null>(null);
  const [composeServices, setComposeServices] = useState<string[]>([]);
  const [selectedComposeServices, setSelectedComposeServices] = useState<string[]>([]);
  const [composeDetach, setComposeDetach] = useState(true);
  const [loadingComposeServices, setLoadingComposeServices] = useState(false);
  const validationSequence = useRef(0);

  useEffect(() => {
    if ((!yamlEdited && !envEdited) || !sourceLoaded || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/.test(name)) return;
    const duplicate = duplicateKeyDiagnostic(yaml, language);
    if (duplicate) {
      setYamlValidation({ state: "invalid", ...duplicate });
      return;
    }
    const sequence = ++validationSequence.current;
    const controller = new AbortController();
    setYamlValidation({ state: "checking" });
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/compose", {
          method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ name, yaml, env: envFileText, action: "validate", ...(projectContext ? { projectId: projectContext.id, projectServiceKind: projectContext.kind } : {}) }),
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
  }, [yaml, envFileText, yamlEdited, envEdited, sourceLoaded, name, language, projectContext]);

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
        setEnvFileText(projectData.env ?? "");
        setEnvEdited(false);
        setEditorFile("compose");
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
        setEnvFileText(data.env ?? "");
        setEnvEdited(false);
        setEditorFile("compose");
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
    setEnvFileText("");
    setEnvEdited(false);
    setEditorFile("compose");
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

  async function execute(action: ComposeAction, options: { services?: string[]; detach?: boolean } = {}) {
    if (!sourceLoaded || (action === "up_service" && !selectedService)) return;
    const duplicate = duplicateKeyDiagnostic(yaml, language);
    if (duplicate && action !== "down" && action !== "save_env") {
      setYamlValidation({ state: "invalid", ...duplicate });
      setOutput(duplicate.message);
      return;
    }
    setBusy(true);
    setOutput("");
    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, yaml, env: envFileText, envEdited, action, ...(action === "up_service" ? { service: selectedService } : {}), ...(options.services ? { services: options.services } : {}), ...(options.detach !== undefined ? { detach: options.detach } : {}), ...(projectContext ? { projectId: projectContext.id, projectServiceKind: projectContext.kind } : {}) }),
        cache: "no-store",
      });
      const data = await response.json();
      if (data.ok) {
        setComposeSource(data.source ?? "vessel");
        if (envEdited && (action === "up" || action === "up_service")) setEnvEdited(false);
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
        } else if (action === "save") {
          setYamlEdited(false);
          setOutput(language === "es" ? "Cambios guardados en el archivo Compose original del host." : "Changes saved to the original host Compose file.");
        } else if (action === "save_env") {
          setEnvEdited(false);
          setOutput(language === "es" ? "Archivo .env guardado en el proyecto Compose." : "Saved the .env file for this Compose project.");
        } else if (action === "up_service") {
          setOutput(language === "es"
            ? `Se aplicó ${selectedService}. Vessel actualizó solo ese servicio, sin reconciliar los demás servicios del proyecto.`
            : `Applied ${selectedService}. Vessel updated only that service and did not reconcile the other project services.`);
        } else if (action === "up") {
          setOutput(projectContext
            ? language === "es" ? "Proyecto desplegado y asociado al espacio de trabajo." : "Project deployed and linked to the workspace."
            : language === "es" ? "Proyecto desplegado." : "Project deployed.");
          void fetch("/api/compose", { cache: "no-store" }).then((response) => response.json()).then((payload) => setProjects(payload.data ?? [])).catch(() => undefined);
        } else if (["start", "stop", "restart", "logs"].includes(action)) {
          setOutput(data.output || (language === "es" ? "Acción Compose completada." : "Compose action completed."));
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

  async function openComposeAction(action: ComposeAction) {
    if (selectedService && action === "up") { setSelectedComposeServices([selectedService]); }
    else setSelectedComposeServices([]);
    setComposeDetach(true);
    setComposeActionDialog(action);
    setLoadingComposeServices(true);
    try {
      const response = await fetch("/api/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, yaml, env: envFileText, action: "services", ...(projectContext ? { projectId: projectContext.id } : {}) }), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not list Compose services");
      setComposeServices(payload.services ?? []);
      setSelectedComposeServices(selectedService && (payload.services ?? []).includes(selectedService) ? [selectedService] : (payload.services ?? []));
    } catch (error) { setOutput(error instanceof Error ? error.message : (language === "es" ? "No se pudieron cargar los servicios Compose." : "Could not load Compose services.")); setComposeActionDialog(null); }
    finally { setLoadingComposeServices(false); }
  }

  function confirmComposeAction() {
    if (!composeActionDialog) return;
    const action = composeActionDialog;
    setComposeActionDialog(null);
    void execute(action, { services: selectedComposeServices, detach: composeDetach });
  }

  async function openPreview() {
    setPreviewOpen(true);
    const duplicate = duplicateKeyDiagnostic(yaml, language);
    if (duplicate) {
      setYamlValidation({ state: "invalid", ...duplicate });
      setPreviewError(duplicate.message);
      setPreviewBusy(false);
      return;
    }
    setPreviewBusy(true);
    setPreviewYaml("");
    setPreviewError("");
    setPreviewCopied(false);
    try {
      const response = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, yaml, env: envFileText, action: "preview", ...(projectContext ? { projectId: projectContext.id, projectServiceKind: projectContext.kind } : {}) }),
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
        {composeSource !== "vessel" ? <small>{language === "es" ? "Guardar cambios escribe en el archivo original del host. No hace falta montar su carpeta permanentemente en Vessel." : "Saving writes to the original host file. Its directory does not need to be mounted permanently in Vessel."}</small> : null}
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
        <div className="module-actions compose-editor-toolbar" role="toolbar" aria-label={language === "es" ? "Acciones de Compose" : "Compose actions"}>
          <div className="compose-editor-toolbar-group">
            <button type="button" className="compose-action compose-action-preview" onClick={() => void openPreview()} disabled={busy || previewBusy || !sourceLoaded}><Eye size={16} />{language === "es" ? "Vista previa Docker" : "Preview Compose"}</button>
            <button type="button" className="compose-action compose-action-validate" onClick={() => void execute("validate")} disabled={busy || !sourceLoaded}><CheckCircle2 size={16} />{language === "es" ? "Validar configuración" : "Validate configuration"}</button>
            {composeSource !== "vessel" && yamlEdited ? <button type="button" className="compose-action compose-action-save" onClick={() => void execute("save")} disabled={busy || !sourceLoaded || yamlValidation.state === "checking" || yamlValidation.state === "invalid"}><Save size={16} />{language === "es" ? "Guardar cambios" : "Save changes"}</button> : null}
            {envEdited ? <button type="button" className="compose-action compose-action-save" onClick={() => void execute("save_env")} disabled={busy || !sourceLoaded}><Save size={16} />{language === "es" ? "Guardar .env" : "Save .env"}</button> : null}
          </div>
          <div className="compose-editor-toolbar-group compose-editor-toolbar-primary">
            <button className="primary-button compose-action compose-action-deploy" type="button" onClick={() => void openComposeAction("up")} disabled={busy || !canDeployCompose}><Rocket size={16} />{selectedService ? (language === "es" ? `Aplicar a ${selectedService}` : `Apply to ${selectedService}`) : (language === "es" ? "Desplegar proyecto" : "Deploy project")}</button>
            <button className="compose-action" type="button" onClick={() => void openComposeAction("start")} disabled={busy || !sourceLoaded}><Play size={15} />{language === "es" ? "Iniciar" : "Start"}</button>
            <button className="compose-action" type="button" onClick={() => void openComposeAction("restart")} disabled={busy || !sourceLoaded}><RotateCw size={15} />{language === "es" ? "Reiniciar" : "Restart"}</button>
            <button className="compose-action" type="button" onClick={() => void openComposeAction("stop")} disabled={busy || !sourceLoaded}><Square size={14} />{language === "es" ? "Detener" : "Stop"}</button>
            <button className="compose-action" type="button" onClick={() => void openComposeAction("logs")} disabled={busy || !sourceLoaded}><ScrollText size={15} />Logs</button>
            <button className="compose-action compose-action-stop" type="button" onClick={() => { if (window.confirm(language === "es" ? "¿Bajar el proyecto Compose completo? Los contenedores se detendrán y eliminarán; los volúmenes nombrados se conservarán." : "Bring the entire Compose project down? Containers will be stopped and removed; named volumes are preserved.")) void execute("down"); }} disabled={busy || !sourceLoaded}><Power size={15} />{language === "es" ? "Bajar proyecto" : "Down"}</button>
          </div>
        </div>
        <div className="compose-yaml-field">
          <div className="compose-yaml-heading">
            <div className="compose-file-tabs" role="tablist" aria-label={language === "es" ? "Archivos del proyecto" : "Project files"}>
              <button type="button" role="tab" aria-selected={editorFile === "compose"} className={editorFile === "compose" ? "active" : ""} onClick={() => setEditorFile("compose")}><Boxes size={15} />compose.yaml</button>
              <button type="button" role="tab" aria-selected={editorFile === "env"} className={editorFile === "env" ? "active" : ""} onClick={() => setEditorFile("env")}><FileText size={15} />.env{envEdited ? <i aria-label={language === "es" ? "Cambios sin guardar" : "Unsaved changes"} /> : null}</button>
            </div>
            {editorFile === "compose" ? <span><code>YAML</code>{yamlValidation.state === "checking" ? <small className="is-checking"><LoaderCircle size={13} />{language === "es" ? "Comprobando…" : "Checking…"}</small> : yamlValidation.state === "valid" ? <small className="is-valid"><CheckCircle2 size={14} />{yamlValidation.message}</small> : yamlValidation.state === "invalid" ? <small className="is-invalid"><CircleAlert size={14} />{language === "es" ? "Revisar configuración" : "Review configuration"}</small> : <small>{language === "es" ? "Validación automática" : "Live validation"}</small>}</span> : <span><code>ENV</code><small>{envEdited ? (language === "es" ? "Cambios sin guardar" : "Unsaved changes") : (language === "es" ? "Variables del proyecto" : "Project variables")}</small></span>}
          </div>
          {editorFile === "compose" ? <>
            <ComposeYamlEditor value={yaml} onChange={(next) => { setYaml(next); setYamlEdited(true); }} disabled={!sourceLoaded} label={language === "es" ? "Definición Compose YAML" : "Compose YAML definition"} errorLine={yamlValidation.state === "invalid" ? yamlValidation.line : null} />
            {yamlValidation.state === "invalid" && yamlValidation.message ? <div className="compose-yaml-diagnostics" role="alert"><CircleAlert size={16} /><div><span>{yamlValidation.message}</span>{yamlValidation.detail ? <details><summary>{language === "es" ? "Detalle devuelto por Docker Compose" : "Docker Compose detail"}</summary><code>{yamlValidation.detail}</code></details> : null}</div></div> : <p className="compose-yaml-help">{language === "es" ? "Docker Compose valida YAML y variables del proyecto. Cambia a .env para revisar o editar los valores de interpolación." : "Docker Compose validates YAML and project variables. Switch to .env to review or edit interpolation values."}</p>}
          </> : <>
            <ComposeYamlEditor mode="dotenv" value={envFileText} onChange={(next) => { setEnvFileText(next); setEnvEdited(true); }} disabled={!sourceLoaded} label={language === "es" ? "Variables de entorno del proyecto" : "Project environment variables"} />
            <p className="compose-yaml-help">{language === "es" ? "Una variable por línea, con formato CLAVE=valor. Este archivo puede contener secretos y solo es visible para administradores. Compose lo usa para resolver ${VARIABLE}; para pasarlas al contenedor, decláralas en environment: o env_file:." : "One variable per line in KEY=value format. This file may contain secrets and is only visible to administrators. Compose uses it to resolve ${VARIABLE}; to pass them into a container, declare them under environment: or env_file:."}</p>
          </>}
        </div>
        {selectedService ? <div className="compose-target-note"><CircleAlert size={15} /><span>{language === "es" ? `La acción de aplicar actualizará ${selectedService} solamente; los demás servicios del proyecto no se reconciliarán.` : `Apply will update ${selectedService} only; other services in the project will not be reconciled.`}</span></div> : null}
      </div>
      <pre className="module-output">{output || (language === "es" ? "La validación y el resultado de Docker Compose aparecerán aquí." : "Docker Compose validation and results will appear here.")}</pre>
    </section>

    {composeActionDialog ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setComposeActionDialog(null); }}><section className="confirm-modal compose-services-modal" role="dialog" aria-modal="true" aria-labelledby="compose-services-title"><header><div><span className="module-kicker">DOCKER COMPOSE</span><h2 id="compose-services-title">{composeActionDialog === "up" ? (language === "es" ? "Desplegar servicios" : "Deploy services") : composeActionDialog === "logs" ? "Logs" : composeActionDialog === "restart" ? (language === "es" ? "Reiniciar servicios" : "Restart services") : composeActionDialog === "start" ? (language === "es" ? "Iniciar servicios" : "Start services") : (language === "es" ? "Detener servicios" : "Stop services")}</h2><p>{language === "es" ? "Selecciona los servicios que quieres operar." : "Select the services you want to operate."}</p></div><button type="button" onClick={() => setComposeActionDialog(null)} aria-label={language === "es" ? "Cerrar" : "Close"}><X size={18} /></button></header>
      {loadingComposeServices ? <div className="compose-services-loading"><LoaderCircle size={18} className="spinning" />{language === "es" ? "Leyendo servicios Compose…" : "Loading Compose services…"}</div> : <><div className="compose-services-list">{composeServices.map((service) => <label key={service}><input type="checkbox" checked={selectedComposeServices.includes(service)} onChange={(event) => setSelectedComposeServices((current) => event.target.checked ? [...current, service] : current.filter((item) => item !== service))} /><Layers3 size={16} /><span>{service}</span></label>)}</div>{composeActionDialog === "up" ? <label className="compose-detach-choice"><input type="checkbox" checked={composeDetach} onChange={(event) => setComposeDetach(event.target.checked)} /><span><strong>{language === "es" ? "Ejecutar en segundo plano (up -d)" : "Run in background (up -d)"}</strong><small>{language === "es" ? "Desmárcalo para mantener el proceso en primer plano (up) y ver su salida mientras permanece activo." : "Uncheck to keep the process attached (up) and view its output while it runs."}</small></span></label> : null}</>}
      <footer className="modal-actions"><button type="button" onClick={() => setComposeActionDialog(null)}>{language === "es" ? "Cancelar" : "Cancel"}</button><button type="button" className="primary-button" onClick={confirmComposeAction} disabled={loadingComposeServices || (composeActionDialog !== "up" && selectedComposeServices.length === 0)}>{language === "es" ? "Continuar" : "Continue"}</button></footer>
    </section></div> : null}
    {previewOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !previewBusy) setPreviewOpen(false); }}><section className="confirm-modal compose-preview-modal" role="dialog" aria-modal="true" aria-labelledby="compose-preview-title"><header className="compose-preview-heading"><span className="compose-preview-mark"><Boxes size={20} /></span><div><span className="module-kicker">DOCKER COMPOSE</span><h2 id="compose-preview-title">{language === "es" ? "Compose convertido" : "Converted Compose"}</h2><p>{language === "es" ? `Vista previa de ${name} generada por Docker.` : `Docker-generated preview for ${name}.`}</p></div><button className="compose-preview-close" type="button" onClick={() => setPreviewOpen(false)} disabled={previewBusy} aria-label={language === "es" ? "Cerrar vista previa" : "Close preview"}><X size={18} /></button></header>
      <p className="compose-preview-note">{language === "es" ? "Docker normaliza el archivo y las variables quedan sin resolver para proteger valores del entorno. Para convertirlo con dominios se necesita configurar al menos uno; Vessel aún no ofrece configuración de dominios para este proyecto." : "Docker normalizes the file and leaves variables unresolved to protect environment values. Domain conversion requires at least one configured domain; Vessel does not yet provide domain settings for this project."}</p>
      {previewError ? <div className="compose-preview-error" role="alert"><CircleAlert size={16} /><div><strong>{previewError}</strong>{previewYaml ? <pre>{previewYaml}</pre> : null}</div></div> : null}
      {previewBusy ? <div className="compose-preview-loading"><CodeLoadingSkeleton /></div> : previewYaml && !previewError ? <pre className="compose-preview-code">{previewYaml}</pre> : null}
      <footer className="compose-preview-actions"><button type="button" onClick={() => setPreviewOpen(false)} disabled={previewBusy}>{language === "es" ? "Cerrar" : "Close"}</button><button className="primary-button" type="button" onClick={() => void copyPreview()} disabled={previewBusy || !previewYaml || Boolean(previewError)}>{previewCopied ? <Check size={15} /> : <Copy size={15} />}{previewCopied ? language === "es" ? "Copiado" : "Copied" : language === "es" ? "Copiar YAML" : "Copy YAML"}</button></footer>
    </section></div> : null}
  </main>;
}
