"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CalendarClock, Check, ChevronDown, Folder, FolderKanban, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Server, Tag, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { formatLocalDateTime } from "@/lib/date-format";
import { ContentLoadingSkeleton } from "@/app/components/LoadingSkeletons";
import { localizeProjectError } from "@/lib/project-errors";

type ProjectTag = { id: string; name: string };
type Project = { id: string; name: string; description: string; serviceCount: number; createdAt: string; updatedAt: string; tags: ProjectTag[] };
type TagPickerPosition = { left: number; top: number; width: number; maxHeight: number };

export default function ProjectsPage() {
  const { language } = useI18n();
  const router = useRouter();
  const es = language === "es";
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<ProjectTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState<Project | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [menuProjectId, setMenuProjectId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [tagPickerPosition, setTagPickerPosition] = useState<TagPickerPosition | null>(null);
  const tagPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const tagPickerMenuRef = useRef<HTMLDivElement>(null);
  const [tagSearch, setTagSearch] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    setLoadFailed(false);
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not load projects.", language));
      setProjects(payload.data ?? []);
      setTags(payload.tags ?? []);
    } catch (error) { setLoadFailed(true); setMessage(error instanceof Error ? localizeProjectError(error.message, language) : es ? "No se pudieron cargar los proyectos." : "Could not load projects."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!tagPickerOpen) {
      setTagPickerPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = tagPickerTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 12;
      const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
      const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding));
      const below = window.innerHeight - rect.bottom - viewportPadding;
      const above = rect.top - viewportPadding;
      const openBelow = below >= Math.min(280, window.innerHeight - 24) || below >= above;
      const maxHeight = Math.max(120, Math.min(320, (openBelow ? below : above) - 6));
      const top = openBelow
        ? Math.min(rect.bottom + 6, window.innerHeight - maxHeight - viewportPadding)
        : Math.max(viewportPadding, rect.top - maxHeight - 6);
      setTagPickerPosition({ left, top, width, maxHeight });
    };

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (tagPickerTriggerRef.current?.contains(target) || tagPickerMenuRef.current?.contains(target)) return;
      setTagPickerOpen(false);
    };

    updatePosition();
    document.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [tagPickerOpen]);

  function openCreate() {
    setEditing(null); setName(""); setDescription(""); setSelectedTagIds([]);
    setTagSearch(""); setNewTagName(""); setTagPickerOpen(false); setMessage(""); setModal(true);
  }

  function openEdit(project: Project) {
    setEditing(project); setName(project.name); setDescription(project.description);
    setSelectedTagIds(project.tags.map((tag) => tag.id)); setTagSearch(""); setNewTagName("");
    setTagPickerOpen(false); setMessage(""); setMenuProjectId(""); setModal(true);
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const action = editing ? "update" : "create";
      const response = await fetch("/api/projects", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(editing ? { id: editing.id } : {}), name, description, tagIds: selectedTagIds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not save project", language));
      const saved = payload.data as Project;
      setModal(false); setEditing(null);
      if (action === "create") {
        setProjects((current) => [saved, ...current]);
        router.push(`/projects/${encodeURIComponent(saved.id)}`);
      } else {
        setProjects((current) => current.map((item) => item.id === saved.id ? saved : item));
      }
    } catch (error) { setMessage(error instanceof Error ? localizeProjectError(error.message, language) : es ? "No se pudo guardar el proyecto." : "Could not save the project."); }
    finally { setBusy(false); }
  }

  async function createTag() {
    const tagName = newTagName.trim();
    if (!tagName) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_tag", name: tagName }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not create tag", language));
      const created = payload.data as ProjectTag;
      setTags((current) => current.some((tag) => tag.id === created.id) ? current : [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedTagIds((current) => current.includes(created.id) ? current : [...current, created.id]);
      setNewTagName(""); setTagSearch(""); setTagPickerOpen(true);
    } catch (error) { setMessage(error instanceof Error ? localizeProjectError(error.message, language) : es ? "No se pudo crear la etiqueta." : "Could not create the tag."); }
    finally { setBusy(false); }
  }

  async function deleteProject() {
    if (!deleteTarget || deleteTarget.serviceCount > 0) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", id: deleteTarget.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(localizeProjectError(payload.error ?? "Could not delete project", language));
      setProjects((current) => current.filter((project) => project.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (error) { setMessage(error instanceof Error ? localizeProjectError(error.message, language) : es ? "No se pudo eliminar el proyecto." : "Could not delete the project."); setDeleteTarget(null); }
    finally { setBusy(false); }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]);
  }

  const visibleTags = tags.filter((tag) => tag.name.toLowerCase().includes(tagSearch.toLowerCase()));

  return <main className="module-main vessel-projects-page">
    <header className="module-header projects-header"><div><span className="module-kicker">VESSEL · {es ? "ESPACIO DE TRABAJO" : "WORKSPACE"}</span><h1>{es ? "Proyectos" : "Projects"}</h1><p>{es ? "Agrupa aplicaciones, bases de datos y servicios Compose en un espacio de trabajo." : "Group applications, databases, and Compose services in a workspace."}</p></div><button className="projects-primary" type="button" onClick={openCreate}><Plus size={17} />{es ? "Añadir proyecto" : "Add a project"}</button></header>
    <section className="projects-intro"><div className="projects-intro-mark"><FolderKanban size={25} /></div><div><strong>{es ? "El hogar de algo grande" : "The home of something big"}</strong><p>{es ? "Un proyecto reúne servicios relacionados. Los recursos siguen administrándose con Docker y Compose desde Vessel." : "A project brings related services together. Resources remain managed through Docker and Compose in Vessel."}</p></div><span className="projects-total"><b>{projects.length}</b><small>{es ? "proyectos" : "projects"}</small></span></section>
    {message && !modal && !deleteTarget ? <div className="projects-notice" role="status">{message}{loadFailed ? <button className="project-list-retry" type="button" onClick={() => void load()}><RefreshCw size={14} />{es ? "Reintentar" : "Retry"}</button> : null}<button type="button" onClick={() => setMessage("")} aria-label={es ? "Cerrar" : "Dismiss"}><X size={15} /></button></div> : null}
    {loading ? <ContentLoadingSkeleton rows={4} label={es ? "Cargando proyectos…" : "Loading projects…"} /> : projects.length ? <section className="projects-grid">{projects.map((project) => <article className="workspace-project-card" key={project.id}>
      <div className="workspace-project-card-head"><span className="workspace-project-icon"><Folder size={20} /></span><span className="workspace-project-count"><b>{project.serviceCount}</b><small>{es ? project.serviceCount === 1 ? "servicio" : "servicios" : project.serviceCount === 1 ? "service" : "services"}</small></span><div className="project-card-menu-wrap"><button className="project-card-menu-trigger" type="button" aria-label={es ? `Opciones de ${project.name}` : `${project.name} options`} aria-expanded={menuProjectId === project.id} onClick={(event) => { event.stopPropagation(); setMenuProjectId((current) => current === project.id ? "" : project.id); }}><MoreHorizontal size={19} /></button>{menuProjectId === project.id ? <div className="project-card-menu" role="menu"><button type="button" role="menuitem" onClick={() => openEdit(project)}><Pencil size={15} />{es ? "Editar" : "Edit"}</button><button type="button" role="menuitem" className="is-danger" onClick={() => { setDeleteTarget(project); setMenuProjectId(""); setMessage(""); }}><Trash2 size={15} />{es ? "Eliminar" : "Delete"}</button></div> : null}</div></div>
      <Link className="workspace-project-card-link" href={`/projects/${encodeURIComponent(project.id)}`}><h2>{project.name}</h2><p>{project.description || (es ? "Sin descripción" : "No description")}</p></Link>
      <div className="workspace-project-created"><CalendarClock size={14} /><span>{es ? "Creado" : "Created"} · {formatLocalDateTime(project.createdAt, language)}</span></div>
      {project.tags.length ? <div className="workspace-project-tags">{project.tags.map((tag) => <span className="project-tag-chip" key={tag.id}><Tag size={11} />{tag.name}</span>)}</div> : null}
      <Link className="workspace-project-footer" href={`/projects/${encodeURIComponent(project.id)}`}><span><Server size={14} />{es ? "Proyecto" : "Project"}</span><span>{es ? "Abrir" : "Open"}<ArrowRight size={15} /></span></Link>
    </article>)}</section> : <section className="projects-empty"><div className="projects-empty-icon"><FolderKanban size={24} /></div><h2>{es ? "Crea tu primer proyecto" : "Create your first project"}</h2><p>{es ? "Empieza con un nombre y añade servicios después. Puedes conectar recursos existentes o crear nuevos." : "Start with a name and add services afterward. Connect existing resources or create new ones."}</p><button type="button" className="projects-primary" onClick={openCreate}><Plus size={16} />{es ? "Añadir proyecto" : "Add a project"}</button></section>}

    {modal ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) { setModal(false); setTagPickerOpen(false); } }}><form className="confirm-modal project-create-modal" role="dialog" aria-modal="true" aria-labelledby="project-create-title" onSubmit={saveProject}>
      <div className="project-modal-heading"><span className="workspace-project-icon"><FolderKanban size={20} /></span><div><span className="module-kicker">{es ? "ESPACIO DE TRABAJO" : "WORKSPACE"}</span><h2 id="project-create-title">{editing ? es ? "Editar proyecto" : "Edit project" : es ? "Añadir un proyecto" : "Add a project"}</h2><p>{es ? "El hogar de algo grande" : "The home of something big"}</p></div><button type="button" className="project-close" aria-label={es ? "Cerrar" : "Close"} onClick={() => { setModal(false); setTagPickerOpen(false); }} disabled={busy}><X size={18} /></button></div>
      <label className="modal-field"><span>{es ? "Nombre" : "Name"}</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={63} placeholder={es ? "por ejemplo, tienda-web" : "e.g. web-store"} required /></label>
      <label className="modal-field"><span>{es ? "Descripción" : "Description"}<small>{es ? "Opcional" : "Optional"}</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} placeholder={es ? "Descripción de tu proyecto..." : "Description about your project..."} /></label>
      <div className="modal-field project-tags-field"><span>{es ? "Etiquetas" : "Tags"}</span><div className="project-tag-picker"><button ref={tagPickerTriggerRef} className="project-tag-picker-trigger" type="button" aria-expanded={tagPickerOpen} aria-controls="project-tag-picker-menu" onClick={() => setTagPickerOpen((current) => !current)}><span>{selectedTagIds.length ? tags.filter((tag) => selectedTagIds.includes(tag.id)).map((tag) => tag.name).join(", ") : es ? "Seleccionar etiquetas..." : "Select tags..."}</span><ChevronDown size={15} /></button></div></div>
      {message ? <div className="projects-notice" role="alert">{message}</div> : null}<div className="modal-actions"><button type="button" onClick={() => { setModal(false); setTagPickerOpen(false); }} disabled={busy}>{es ? "Cancelar" : "Cancel"}</button><button className="primary-button" type="submit" disabled={busy || name.trim().length < 2}>{busy ? <span className="spinner" /> : editing ? <Pencil size={15} /> : <Plus size={16} />}{editing ? es ? "Guardar cambios" : "Save changes" : es ? "Crear" : "Create"}</button></div>
    </form></div> : null}

    {tagPickerOpen && tagPickerPosition ? createPortal(<div ref={tagPickerMenuRef} id="project-tag-picker-menu" className="project-tag-picker-menu" style={{ left: tagPickerPosition.left, top: tagPickerPosition.top, width: tagPickerPosition.width, maxHeight: tagPickerPosition.maxHeight }}><label className="project-tag-search"><Search size={14} /><input autoFocus value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder={es ? "Buscar etiquetas..." : "Search tags..."} /></label><div className="project-tag-options">{visibleTags.map((tag) => <button type="button" key={tag.id} onClick={() => toggleTag(tag.id)}><span className={`project-tag-check${selectedTagIds.includes(tag.id) ? " selected" : ""}`}>{selectedTagIds.includes(tag.id) ? <Check size={12} /> : null}</span>{tag.name}</button>)}{!visibleTags.length ? <small>{es ? "No se encontraron etiquetas" : "No tags found"}</small> : null}</div><div className="project-tag-create"><input value={newTagName} onChange={(event) => setNewTagName(event.target.value)} maxLength={40} placeholder={es ? "Nueva etiqueta" : "New tag"} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createTag(); } }} /><button type="button" onClick={() => void createTag()} disabled={busy || !newTagName.trim()}><Plus size={14} />{es ? "Crear etiqueta" : "Create Tag"}</button></div></div>, document.body) : null}

    {deleteTarget ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteTarget(null); }}><section className="confirm-modal project-confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="project-delete-title"><div className="project-modal-heading"><span className="project-delete-mark"><Trash2 size={19} /></span><div><span className="module-kicker">{es ? "ELIMINAR PROYECTO" : "DELETE PROJECT"}</span><h2 id="project-delete-title">{es ? "¿Seguro que quieres eliminar este proyecto?" : "Are you sure to delete this project?"}</h2><p>{deleteTarget.name}</p></div><button type="button" className="project-close" aria-label={es ? "Cerrar" : "Close"} onClick={() => setDeleteTarget(null)} disabled={busy}><X size={18} /></button></div>{deleteTarget.serviceCount > 0 ? <div className="project-delete-warning"><Server size={18} /><span>{es ? `El proyecto tiene ${deleteTarget.serviceCount} servicio(s) asociados. Quítalos primero para poder eliminarlo.` : `This project has ${deleteTarget.serviceCount} linked service(s). Remove them first to delete the project.`}</span></div> : <p>{es ? "Se eliminará el proyecto y sus etiquetas asociadas. No se eliminarán recursos Docker." : "The project and its assigned tags will be removed. Docker resources will not be deleted."}</p>}{message ? <div className="projects-notice" role="alert">{message}</div> : null}<div className="modal-actions"><button type="button" onClick={() => setDeleteTarget(null)} disabled={busy}>{es ? "Cancelar" : "Cancel"}</button><button className="danger-button" type="button" onClick={() => void deleteProject()} disabled={busy || deleteTarget.serviceCount > 0}>{busy ? <span className="spinner" /> : <Trash2 size={15} />}{es ? "Eliminar proyecto" : "Delete project"}</button></div></section></div> : null}
  </main>;
}
