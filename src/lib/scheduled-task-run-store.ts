import { randomUUID } from "node:crypto";
import { controlPlaneDatabase } from "@/lib/control-plane";
import type { ScheduledTaskRecord, ScheduledTaskRun, ScheduledTaskActivity } from "@/lib/scheduled-task-types";

export function claimScheduledTaskMinute(id: string, minuteKey: string): boolean {
  const result = controlPlaneDatabase().prepare(`UPDATE vessel_scheduled_tasks SET last_scheduled_key = ?, last_run_at = CURRENT_TIMESTAMP
    WHERE id = ? AND enabled = 1 AND (last_scheduled_key IS NULL OR last_scheduled_key <> ?)`)
    .run(minuteKey, id, minuteKey);
  return Number(result.changes) === 1;
}

export function createScheduledTaskRun(task: Pick<ScheduledTaskRecord, "id" | "name">, trigger: "manual" | "schedule", startedBy?: string | null): ScheduledTaskRun {
  const id = randomUUID();
  const startedAt = new Date().toISOString();
  controlPlaneDatabase().prepare(`INSERT INTO vessel_scheduled_task_runs (id, task_id, task_name, trigger_kind, status, started_at, started_by)
    VALUES (?, ?, ?, ?, 'running', ?, ?)`).run(id, task.id, task.name, trigger, startedAt, startedBy ?? null);
  controlPlaneDatabase().prepare(`DELETE FROM vessel_scheduled_task_runs WHERE id IN (
    SELECT id FROM vessel_scheduled_task_runs WHERE task_id = ? ORDER BY started_at DESC LIMIT -1 OFFSET 200
  )`).run(task.id);
  return { id, taskId: task.id, taskName: task.name, trigger, status: "running", exitCode: null, output: "", error: null, startedAt, finishedAt: null, startedBy: null };
}

export function appendScheduledTaskRunOutput(id: string, output: string) {
  controlPlaneDatabase().prepare("UPDATE vessel_scheduled_task_runs SET output = substr(output || ?, -262144) WHERE id = ? AND status = 'running'").run(output, id);
}

export function finishScheduledTaskRun(id: string, exitCode: number | null, error: string | null) {
  controlPlaneDatabase().prepare(`UPDATE vessel_scheduled_task_runs SET status = ?, exit_code = ?, error = ?, finished_at = ? WHERE id = ? AND status = 'running'`)
    .run(exitCode === 0 && !error ? "succeeded" : "failed", exitCode, error?.slice(0, 2000) ?? null, new Date().toISOString(), id);
}

export function listScheduledTaskRuns(taskId?: string, limit = 50): ScheduledTaskRun[] {
  const max = Math.max(1, Math.min(200, Math.trunc(limit)));
  const select = `SELECT r.id, r.task_id AS taskId, r.task_name AS taskName, r.trigger_kind AS trigger,
    r.status, r.exit_code AS exitCode, r.output, r.error, r.started_at AS startedAt, r.finished_at AS finishedAt,
    u.username AS startedBy FROM vessel_scheduled_task_runs r LEFT JOIN vessel_users u ON u.id = r.started_by`;
  return (taskId
    ? controlPlaneDatabase().prepare(`${select} WHERE r.task_id = ? ORDER BY r.started_at DESC LIMIT ?`).all(taskId, max)
    : controlPlaneDatabase().prepare(`${select} ORDER BY r.started_at DESC LIMIT ?`).all(max)) as ScheduledTaskRun[];
}

export function listScheduledTaskActivity(limit = 2000): ScheduledTaskActivity[] {
  const max = Math.max(1, Math.min(5000, Math.trunc(limit)));
  return controlPlaneDatabase().prepare(`SELECT r.id, r.task_id AS taskId, r.task_name AS taskName,
    r.trigger_kind AS trigger, r.status, r.exit_code AS exitCode, r.output, r.error,
    r.started_at AS startedAt, r.finished_at AS finishedAt, t.project_id AS projectId,
    p.name AS projectName, u.username AS startedBy,
    MAX(0, CAST(ROUND((julianday(COALESCE(r.finished_at, CURRENT_TIMESTAMP)) - julianday(r.started_at)) * 86400) AS INTEGER)) AS durationSeconds
    FROM vessel_scheduled_task_runs r
    LEFT JOIN vessel_scheduled_tasks t ON t.id = r.task_id
    LEFT JOIN vessel_job_projects p ON p.id = t.project_id
    LEFT JOIN vessel_users u ON u.id = r.started_by
    ORDER BY r.started_at DESC LIMIT ?`).all(max) as ScheduledTaskActivity[];
}

export function getScheduledTaskRun(id: string): ScheduledTaskRun | null {
  const select = `SELECT r.id, r.task_id AS taskId, r.task_name AS taskName, r.trigger_kind AS trigger,
    r.status, r.exit_code AS exitCode, r.output, r.error, r.started_at AS startedAt, r.finished_at AS finishedAt,
    u.username AS startedBy FROM vessel_scheduled_task_runs r LEFT JOIN vessel_users u ON u.id = r.started_by WHERE r.id = ?`;
  return controlPlaneDatabase().prepare(select).get(id) as ScheduledTaskRun | null;
}

export function deleteScheduledTaskRun(id: string): "deleted" | "running" | "not_found" {
  const database = controlPlaneDatabase();
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = database.prepare("SELECT status FROM vessel_scheduled_task_runs WHERE id = ?").get(id) as { status: string } | undefined;
    if (!run) {
      database.exec("COMMIT");
      return "not_found";
    }
    if (run.status === "running") {
      database.exec("COMMIT");
      return "running";
    }
    const deleted = Number(database.prepare("DELETE FROM vessel_scheduled_task_runs WHERE id = ? AND status <> 'running'").run(id).changes) > 0;
    database.exec("COMMIT");
    return deleted ? "deleted" : "running";
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function recoverInterruptedScheduledTaskRuns() {
  const result = controlPlaneDatabase().prepare(`UPDATE vessel_scheduled_task_runs SET status = 'failed',
    error = 'Vessel restarted before this task finished.', finished_at = ? WHERE status = 'running'`)
    .run(new Date().toISOString());
  return Number(result.changes);
}

export function scheduledTaskStatistics() {
  const rows = controlPlaneDatabase().prepare(`SELECT task_id AS taskId, COUNT(*) AS executions,
    SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
    AVG(CASE WHEN finished_at IS NOT NULL THEN MAX(0, (julianday(finished_at) - julianday(started_at)) * 86400) END) AS averageSeconds
    FROM vessel_scheduled_task_runs GROUP BY task_id`).all() as Array<{ taskId: string; executions: number; succeeded: number; averageSeconds: number | null }>;
  return Object.fromEntries(rows.map((row) => [row.taskId, { executions: Number(row.executions), successRate: row.executions ? Math.round(Number(row.succeeded) * 100 / Number(row.executions)) : 0, averageSeconds: row.averageSeconds === null ? null : Math.round(Number(row.averageSeconds)) }]));
}

