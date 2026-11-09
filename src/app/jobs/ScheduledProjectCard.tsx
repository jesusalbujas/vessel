"use client";

import Link from "next/link";
import { FolderKanban, Trash2 } from "lucide-react";
import type { JobProject } from "./jobs-model";

type Props = { project: JobProject; language: "es" | "en"; onDelete: (project: JobProject) => void };

export function ScheduledProjectCard({ project, language, onDelete }: Props) {
  const es = language === "es";
  const deleteHint = project.taskCount > 0
    ? (es ? `Elimina primero los ${project.taskCount} trabajos de este proyecto` : `Delete this project's ${project.taskCount} jobs first`)
    : (es ? `Eliminar proyecto ${project.name}` : `Delete project ${project.name}`);

  return <div className="scheduled-project-card-shell">
    <Link className="scheduled-project-card" href={`/jobs/${encodeURIComponent(project.id)}`}>
      <span className="scheduled-project-icon"><FolderKanban size={20} /></span>
      <span className="scheduled-project-copy"><strong>{project.name}</strong><small>{project.description || (es ? "Proyecto de automatización" : "Automation project")}</small><span>{project.taskCount} {es ? "trabajos" : "jobs"} · {project.keyCount} {es ? "claves" : "keys"}</span></span>
    </Link>
    <button type="button" className="scheduled-project-delete" onClick={() => onDelete(project)} aria-label={deleteHint} title={deleteHint}><Trash2 size={16} /></button>
  </div>;
}
