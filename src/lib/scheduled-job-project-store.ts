import { randomUUID } from "node:crypto";
import { controlPlaneDatabase, decryptControlPlaneSecret, encryptControlPlaneSecret } from "@/lib/control-plane";
import type { ScheduledJobProject, ScheduledJobProjectKey } from "@/lib/scheduled-task-types";

export function listScheduledJobProjects(): ScheduledJobProject[] {
  return controlPlaneDatabase().prepare(`SELECT p.id, p.name, p.description, p.created_at AS createdAt,
    p.updated_at AS updatedAt, COUNT(DISTINCT t.id) AS taskCount,
    (SELECT COUNT(*) FROM vessel_job_project_keys k WHERE k.project_id = p.id) AS keyCount
    FROM vessel_job_projects p LEFT JOIN vessel_scheduled_tasks t ON t.project_id = p.id
    GROUP BY p.id ORDER BY p.name COLLATE NOCASE`).all() as ScheduledJobProject[];
}

export function saveScheduledJobProject(input: { id?: string; name: string; description?: string; createdBy: string }): ScheduledJobProject {
  const name = input.name.trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u.test(name)) throw new Error("Project name must contain 1–80 letters, numbers, spaces, dots, dashes, or underscores.");
  if ((input.description ?? "").length > 500) throw new Error("The project description must not exceed 500 characters.");
  if (input.id) {
    const result = controlPlaneDatabase().prepare("UPDATE vessel_job_projects SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(name, input.description?.trim() ?? "", input.id);
    if (!Number(result.changes)) throw new Error("Scheduled task project not found");
  } else {
    controlPlaneDatabase().prepare("INSERT INTO vessel_job_projects (id, name, description, created_by) VALUES (?, ?, ?, ?)")
      .run(randomUUID(), name, input.description?.trim() ?? "", input.createdBy);
  }
  return listScheduledJobProjects().find((project) => project.id === input.id || project.name.toLocaleLowerCase() === name.toLocaleLowerCase())!;
}

export function deleteScheduledJobProject(id: string): "deleted" | "not_found" | "has_tasks" {
  if (!controlPlaneDatabase().prepare("SELECT 1 FROM vessel_job_projects WHERE id = ?").get(id)) return "not_found";
  const count = Number((controlPlaneDatabase().prepare("SELECT COUNT(*) AS count FROM vessel_scheduled_tasks WHERE project_id = ?").get(id) as { count: number }).count);
  if (count) return "has_tasks";
  controlPlaneDatabase().exec("BEGIN IMMEDIATE");
  try {
    controlPlaneDatabase().prepare("DELETE FROM vessel_job_project_keys WHERE project_id = ?").run(id);
    const changes = Number(controlPlaneDatabase().prepare("DELETE FROM vessel_job_projects WHERE id = ?").run(id).changes);
    controlPlaneDatabase().exec("COMMIT");
    return changes ? "deleted" : "not_found";
  } catch (error) {
    controlPlaneDatabase().exec("ROLLBACK");
    throw error;
  }
}

export function listScheduledJobProjectKeys(projectId: string): ScheduledJobProjectKey[] {
  return controlPlaneDatabase().prepare("SELECT key_name AS name, updated_at AS updatedAt FROM vessel_job_project_keys WHERE project_id = ? ORDER BY key_name COLLATE NOCASE")
    .all(projectId) as ScheduledJobProjectKey[];
}

export function listScheduledJobGlobalKeys(): ScheduledJobProjectKey[] {
  return controlPlaneDatabase().prepare("SELECT key_name AS name, updated_at AS updatedAt FROM vessel_job_global_keys ORDER BY key_name COLLATE NOCASE")
    .all() as ScheduledJobProjectKey[];
}

export function saveScheduledJobGlobalKey(name: string, value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw new Error("Key name must be a valid environment variable name.");
  if (!value || value.length > 16_384 || /\0/.test(value)) throw new Error("Key value is invalid.");
  controlPlaneDatabase().prepare(`INSERT INTO vessel_job_global_keys (key_name, encrypted_value)
    VALUES (?, ?) ON CONFLICT(key_name) DO UPDATE SET
    encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP`).run(name, encryptControlPlaneSecret(value));
}

export function deleteScheduledJobGlobalKey(name: string): boolean {
  return Number(controlPlaneDatabase().prepare("DELETE FROM vessel_job_global_keys WHERE key_name = ?").run(name).changes) > 0;
}

export function saveScheduledJobProjectKey(projectId: string, name: string, value: string) {
  if (!controlPlaneDatabase().prepare("SELECT 1 FROM vessel_job_projects WHERE id = ?").get(projectId)) throw new Error("Scheduled task project not found");
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw new Error("Key name must be a valid environment variable name.");
  if (!value || value.length > 16_384 || /\0/.test(value)) throw new Error("Key value is invalid.");
  controlPlaneDatabase().prepare(`INSERT INTO vessel_job_project_keys (project_id, key_name, encrypted_value)
    VALUES (?, ?, ?) ON CONFLICT(project_id, key_name) DO UPDATE SET
    encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP`).run(projectId, name, encryptControlPlaneSecret(value));
  controlPlaneDatabase().prepare("UPDATE vessel_job_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
}

export function deleteScheduledJobProjectKey(projectId: string, name: string): boolean {
  return Number(controlPlaneDatabase().prepare("DELETE FROM vessel_job_project_keys WHERE project_id = ? AND key_name = ?").run(projectId, name).changes) > 0;
}

export function scheduledJobProjectKeyValues(projectId: string): Record<string, string> {
  const rows = controlPlaneDatabase().prepare("SELECT key_name AS name, encrypted_value AS value FROM vessel_job_project_keys WHERE project_id = ?").all(projectId) as Array<{ name: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.name, decryptControlPlaneSecret(row.value)]));
}

export function scheduledJobGlobalKeyValues(): Record<string, string> {
  const rows = controlPlaneDatabase().prepare("SELECT key_name AS name, encrypted_value AS value FROM vessel_job_global_keys").all() as Array<{ name: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.name, decryptControlPlaneSecret(row.value)]));
}

