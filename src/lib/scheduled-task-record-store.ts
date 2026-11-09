import { randomUUID } from "node:crypto";
import { controlPlaneDatabase, decryptControlPlaneSecret, encryptControlPlaneSecret } from "@/lib/control-plane";
import { scheduledJobGlobalKeyValues, scheduledJobProjectKeyValues } from "@/lib/scheduled-job-project-store";
import type { ScheduledTaskRecord, ScheduledTaskRuntime } from "@/lib/scheduled-task-types";

type ScheduledTaskRow = Omit<ScheduledTaskRecord, "enabled" | "environmentNames"> & {
  enabled: number; environmentNames: string; encryptedEnvironment: string;
};
const scheduledTaskSelect = `SELECT id, name, description, cron_expression AS cronExpression,
  timezone, script, environment_names AS environmentNames, timeout_seconds AS timeoutSeconds,
  enabled, last_run_at AS lastRunAt, created_at AS createdAt, updated_at AS updatedAt,
  project_id AS projectId, encrypted_environment AS encryptedEnvironment FROM vessel_scheduled_tasks`;

function mapScheduledTask(row: ScheduledTaskRow): ScheduledTaskRecord {
  let environmentNames: string[] = [];
  try { const value = JSON.parse(row.environmentNames); if (Array.isArray(value)) environmentNames = value.filter((name): name is string => typeof name === "string"); } catch { /* Ignore malformed legacy metadata. */ }
  return { id: row.id, projectId: row.projectId, name: row.name, description: row.description, cronExpression: row.cronExpression, timezone: row.timezone, script: row.script, environmentNames, timeoutSeconds: row.timeoutSeconds, enabled: Boolean(row.enabled), lastRunAt: row.lastRunAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export function listScheduledTasks(): ScheduledTaskRecord[] {
  return (controlPlaneDatabase().prepare(`${scheduledTaskSelect} ORDER BY enabled DESC, name COLLATE NOCASE`).all() as ScheduledTaskRow[]).map(mapScheduledTask);
}

export function scheduledTaskRuntimeData(id: string): ScheduledTaskRuntime | null {
  const row = controlPlaneDatabase().prepare(`${scheduledTaskSelect} WHERE id = ?`).get(id) as ScheduledTaskRow | undefined;
  if (!row) return null;
  const task = mapScheduledTask(row);
  const globalValues = scheduledJobGlobalKeyValues();
  const projectValues = scheduledJobProjectKeyValues(task.projectId);
  const taskEnvironment = row.encryptedEnvironment ? JSON.parse(decryptControlPlaneSecret(row.encryptedEnvironment)) as Record<string, string> : {};
  const values = { ...globalValues, ...projectValues, ...taskEnvironment };
  const environment: Record<string, string> = { ...values };
  for (const source of [globalValues, projectValues, taskEnvironment]) {
    for (const [name, value] of Object.entries(source)) environment[`VESSEL_${name.replace(/^VESSEL_/, "")}`] = value;
  }
  const project = controlPlaneDatabase().prepare("SELECT name FROM vessel_job_projects WHERE id = ?").get(task.projectId) as { name: string } | undefined;
  return { ...task, projectName: project?.name ?? task.projectId, environment };
}

export function scheduledTaskEnvironmentData(id: string): Record<string, string> | null {
  const row = controlPlaneDatabase().prepare("SELECT encrypted_environment AS encryptedEnvironment FROM vessel_scheduled_tasks WHERE id = ?").get(id) as { encryptedEnvironment: string } | undefined;
  if (!row) return null;
  return row.encryptedEnvironment ? JSON.parse(decryptControlPlaneSecret(row.encryptedEnvironment)) as Record<string, string> : {};
}

export function saveScheduledTask(input: {
  id?: string; name: string; description: string; cronExpression: string; timezone: string;
  script: string; environment: Record<string, string>; timeoutSeconds: number; createdBy: string; projectId?: string;
}) {
  const name = input.name.trim();
  if (!controlPlaneDatabase().prepare("SELECT 1 FROM vessel_job_projects WHERE id = ?").get(input.projectId ?? "default")) throw new Error("Scheduled task project not found");
  const encryptedEnvironment = encryptControlPlaneSecret(JSON.stringify(input.environment));
  const environmentNames = JSON.stringify(Object.keys(input.environment).sort());
  const id = input.id || randomUUID();
  if (input.id) {
    const result = controlPlaneDatabase().prepare(`UPDATE vessel_scheduled_tasks SET name = ?, description = ?, cron_expression = ?, timezone = ?, script = ?,
      encrypted_environment = ?, environment_names = ?, timeout_seconds = ?, project_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, input.description.trim(), input.cronExpression.trim(), input.timezone, input.script, encryptedEnvironment, environmentNames, input.timeoutSeconds, input.projectId ?? "default", id);
    if (!Number(result.changes)) throw new Error("Scheduled task not found");
  } else {
    controlPlaneDatabase().prepare(`INSERT INTO vessel_scheduled_tasks
      (id, name, description, cron_expression, timezone, script, encrypted_environment, environment_names, timeout_seconds, created_by, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, input.description.trim(), input.cronExpression.trim(), input.timezone, input.script, encryptedEnvironment, environmentNames, input.timeoutSeconds, input.createdBy, input.projectId ?? "default");
  }
  return getScheduledTask(id)!;
}

export function getScheduledTask(id: string): ScheduledTaskRecord | null {
  const row = controlPlaneDatabase().prepare(`${scheduledTaskSelect} WHERE id = ?`).get(id) as ScheduledTaskRow | undefined;
  return row ? mapScheduledTask(row) : null;
}

export function duplicateScheduledTask(id: string, createdBy: string): ScheduledTaskRecord | null {
  const task = getScheduledTask(id);
  if (!task) return null;
  const table = controlPlaneDatabase();
  const baseName = `${task.name} copy`;
  let name = baseName;
  let suffix = 2;
  while (table.prepare("SELECT 1 FROM vessel_scheduled_tasks WHERE name = ? COLLATE NOCASE").get(name)) name = `${baseName} ${suffix++}`;
  const newId = randomUUID();
  table.prepare(`INSERT INTO vessel_scheduled_tasks
    (id, name, description, cron_expression, timezone, script, encrypted_environment, environment_names,
     timeout_seconds, enabled, created_by, project_id)
    SELECT ?, ?, description, cron_expression, timezone, script, encrypted_environment, environment_names,
     timeout_seconds, 0, ?, project_id FROM vessel_scheduled_tasks WHERE id = ?`)
    .run(newId, name, createdBy, id);
  return getScheduledTask(newId);
}

export function setScheduledTaskEnabled(id: string, enabled: boolean): ScheduledTaskRecord | null {
  const result = controlPlaneDatabase().prepare("UPDATE vessel_scheduled_tasks SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(enabled ? 1 : 0, id);
  return Number(result.changes) ? getScheduledTask(id) : null;
}

export function deleteScheduledTask(id: string): boolean {
  return Number(controlPlaneDatabase().prepare("DELETE FROM vessel_scheduled_tasks WHERE id = ?").run(id).changes) > 0;
}

