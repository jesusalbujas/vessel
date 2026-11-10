import { NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/control-plane";
import {
  deleteScheduledJobProject,
  deleteScheduledJobGlobalKey,
  deleteScheduledJobProjectKey,
  deleteScheduledTask,
  duplicateScheduledTask,
  createScheduledJobGlobalKey,
  createScheduledJobProjectKey,
  getScheduledTaskRun,
  getScheduledTask,
  listScheduledTaskRuns,
  listScheduledTaskActivity,
  listScheduledJobProjectKeys,
  listScheduledJobGlobalKeys,
  listScheduledJobProjects,
  listScheduledTasks,
  saveScheduledTask,
  saveScheduledJobProject,
  saveScheduledJobProjectKey,
  saveScheduledJobGlobalKey,
  scheduledTaskStatistics,
  scheduledTaskEnvironmentData,
  deleteScheduledTaskRun,
  setScheduledTaskEnabled,
} from "@/lib/scheduled-task-store";
import { startScheduledTaskRun } from "@/lib/scheduled-tasks";
import { validateScheduledTask } from "@/server/api/scheduled-task-validation";

export const dynamic = "force-dynamic";

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
}

function administrator(request: Request) {
  const user = authenticatedUser(request);
  return user?.role === "administrator" ? user : null;
}


export async function getScheduledTasks(request: Request) {
  if (!administrator(request)) return response({ error: "Administrator access required" }, 403);
  const url = new URL(request.url);
  const taskId = url.searchParams.get("taskId");
  const runId = url.searchParams.get("runId");
  const projectId = url.searchParams.get("projectId");
  if (url.searchParams.get("resource") === "activity") {
    const limit = Number(url.searchParams.get("limit") ?? 2000);
    const runs = listScheduledTaskActivity(Number.isFinite(limit) ? limit : 2000).map(({ output: _output, ...run }) => run);
    return response({ data: { runs } });
  }
  if (url.searchParams.get("resource") === "globalKeys") {
    return response({ data: { keys: listScheduledJobGlobalKeys() } });
  }
  if (url.searchParams.get("resource") === "availableKeys") {
    if (!projectId) return response({ error: "Project id is required" }, 400);
    const global = listScheduledJobGlobalKeys().map((key) => ({ ...key, scope: "global" as const }));
    const project = listScheduledJobProjectKeys(projectId).map((key) => ({ ...key, scope: "project" as const }));
    return response({ data: { keys: [...global, ...project] } });
  }
  if (url.searchParams.get("resource") === "projectKeys") {
    if (!projectId) return response({ error: "Project id is required" }, 400);
    return response({ data: { keys: listScheduledJobProjectKeys(projectId) } });
  }
  if (runId) {
    const run = getScheduledTaskRun(runId);
    return run ? response({ data: run }) : response({ error: "Scheduled task run not found" }, 404);
  }
  if (taskId) {
    const task = getScheduledTask(taskId);
    if (!task) return response({ error: "Scheduled task not found" }, 404);
    const format = url.searchParams.get("export");
    if (format) {
      if (!["json", "yaml", "xml"].includes(format)) return response({ error: "Unsupported export format" }, 400);
      const definition = { version: 1, projectId: task.projectId, name: task.name, description: task.description, group: task.groupName, schedule: { cron: task.cronExpression, timezone: task.timezone, enabled: task.scheduleEnabled }, timeoutSeconds: task.timeoutSeconds, enabled: task.enabled, options: task.options, script: task.script, protectedVariableNames: task.environmentNames };
      const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;");
      const yamlScalar = (value: string) => /^[A-Za-z0-9_./:@+-]+$/.test(value) && !/^(true|false|null|yes|no|on|off)$/i.test(value) ? value : JSON.stringify(value);
      const yaml = [
        "version: 1",
        `projectId: ${yamlScalar(task.projectId)}`,
        `group: ${yamlScalar(task.groupName)}`,
        `name: ${yamlScalar(task.name)}`,
        `description: ${yamlScalar(task.description)}`,
        "schedule:",
        `  cron: ${yamlScalar(task.cronExpression)}`,
        `  timezone: ${yamlScalar(task.timezone)}`,
        `  enabled: ${task.scheduleEnabled}`,
        `timeoutSeconds: ${task.timeoutSeconds}`,
        `enabled: ${task.enabled}`,
        "script: |",
        ...task.script.split("\n").map((line) => `  ${line}`),
        ...(task.environmentNames.length ? ["protectedVariableNames:", ...task.environmentNames.map((name) => `  - ${yamlScalar(name)}`)] : ["protectedVariableNames: []"]),
        "",
      ].join("\n");
      const body = format === "xml"
        ? `<?xml version="1.0" encoding="UTF-8"?>\n<job version="1"><projectId>${escapeXml(task.projectId)}</projectId><group>${escapeXml(task.groupName)}</group><name>${escapeXml(task.name)}</name><description>${escapeXml(task.description)}</description><schedule enabled="${task.scheduleEnabled}"><cron>${escapeXml(task.cronExpression)}</cron><timezone>${escapeXml(task.timezone)}</timezone></schedule><timeoutSeconds>${task.timeoutSeconds}</timeoutSeconds><enabled>${task.enabled}</enabled><script>${escapeXml(task.script)}</script><protectedVariableNames>${task.environmentNames.map((name) => `<name>${escapeXml(name)}</name>`).join("")}</protectedVariableNames></job>`
        : format === "yaml" ? yaml : JSON.stringify(definition, null, 2);
      return new Response(body, { headers: { "Content-Type": format === "xml" ? "application/xml; charset=utf-8" : format === "yaml" ? "application/yaml; charset=utf-8" : "application/json; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${task.name}.${format}`)}`, "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
    }
    const runs = listScheduledTaskRuns(taskId, 40).map(({ output: _output, ...run }) => run);
    return response({ data: { task, runs } });
  }
  const tasks = listScheduledTasks().map(({ script: _script, ...task }) => task);
  const runs = listScheduledTaskRuns(undefined, 30).map(({ output: _output, ...run }) => run);
  return response({ data: { projects: listScheduledJobProjects(), tasks, runs, statistics: scheduledTaskStatistics() } });
}

export async function postScheduledTasks(request: Request) {
  const user = administrator(request);
  if (!user) return response({ error: "Administrator access required" }, 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return response({ error: "A valid task action is required" }, 400);
  try {
    if (body.action === "globalKey.save") {
      if (typeof body.name !== "string" || typeof body.value !== "string") return response({ error: "Key name and value are required" }, 400);
      saveScheduledJobGlobalKey(body.name.trim(), body.value);
      return response({ data: { keys: listScheduledJobGlobalKeys() } });
    }
    if (body.action === "globalKey.create") {
      if (typeof body.name !== "string" || typeof body.value !== "string") return response({ error: "Key name and value are required" }, 400);
      createScheduledJobGlobalKey(body.name.trim(), body.value);
      return response({ data: { keys: listScheduledJobGlobalKeys() } }, 201);
    }
    if (body.action === "globalKey.delete" && typeof body.name === "string") {
      return deleteScheduledJobGlobalKey(body.name) ? response({ data: { keys: listScheduledJobGlobalKeys() } }) : response({ error: "Global key not found" }, 404);
    }
    if (body.action === "project.create" || body.action === "project.update") {
      const project = saveScheduledJobProject({ id: typeof body.id === "string" ? body.id : undefined, name: String(body.name ?? ""), description: typeof body.description === "string" ? body.description : "", createdBy: user.id });
      return response({ data: project }, body.action === "project.create" ? 201 : 200);
    }
    if (body.action === "project.delete" && typeof body.id === "string") {
      const result = deleteScheduledJobProject(body.id);
      if (result === "deleted") return response({ success: true });
      if (result === "has_tasks") return response({ error: "Delete or move this project's jobs before deleting it." }, 409);
      return response({ error: "Scheduled task project not found" }, 404);
    }
    if (body.action === "key.save" && typeof body.projectId === "string") {
      if (typeof body.name !== "string" || typeof body.value !== "string") return response({ error: "Key name and value are required" }, 400);
      if (body.value.length > 16_384) return response({ error: "Key value is invalid." }, 400);
      saveScheduledJobProjectKey(body.projectId, body.name.trim(), body.value);
      return response({ data: { keys: listScheduledJobProjectKeys(body.projectId) } });
    }
    if (body.action === "key.create" && typeof body.projectId === "string") {
      if (typeof body.name !== "string" || typeof body.value !== "string") return response({ error: "Key name and value are required" }, 400);
      createScheduledJobProjectKey(body.projectId, body.name.trim(), body.value);
      return response({ data: { keys: listScheduledJobProjectKeys(body.projectId) } }, 201);
    }
    if (body.action === "key.delete" && typeof body.projectId === "string" && typeof body.name === "string") {
      return deleteScheduledJobProjectKey(body.projectId, body.name) ? response({ data: { keys: listScheduledJobProjectKeys(body.projectId) } }) : response({ error: "Project key not found" }, 404);
    }
    if (body.action === "duplicate" && typeof body.id === "string") {
      const task = duplicateScheduledTask(body.id, user.id);
      return task ? response({ data: task }, 201) : response({ error: "Scheduled task not found" }, 404);
    }
    if (body.action === "create" || body.action === "update") {
      const input = validateScheduledTask(body);
      const id = typeof body.id === "string" ? body.id : undefined;
      if (body.action === "update" && !id) return response({ error: "Task id is required" }, 400);
      let environment = input.environment;
      if (id) {
        const existing = scheduledTaskEnvironmentData(id);
        if (!existing) return response({ error: "Scheduled task not found" }, 404);
        environment = { ...existing };
        for (const [name, value] of Object.entries(input.environment)) {
          if (value !== "" || !Object.prototype.hasOwnProperty.call(existing, name)) environment[name] = value;
        }
        for (const key of input.removedEnvironmentNames) delete environment[key];
      }
      for (const option of input.options) {
        if (option.inputType === "password") {
          delete environment[option.name];
          delete environment[`VESSEL_${option.name.replace(/^VESSEL_/, "")}`];
          if (option.storagePath) continue;
          if (option.required) continue;
        }
        const value = environment[option.name] ?? environment[`VESSEL_${option.name.replace(/^VESSEL_/, "")}`];
        if (option.required && !value?.trim()) return response({ error: `Required job parameter ${option.name} needs a value.` }, 400);
        if (option.allowedValues.length && value && !option.allowedValues.includes(value)) return response({ error: `Job parameter ${option.name} must match one of its allowed values.` }, 400);
      }
      const { removedEnvironmentNames: _removedEnvironmentNames, ...taskInput } = input;
      const task = saveScheduledTask({ ...taskInput, environment, id, createdBy: user.id });
      return response({ data: task }, body.action === "create" ? 201 : 200);
    }
    if (body.action === "delete" && typeof body.id === "string") {
      return deleteScheduledTask(body.id) ? response({ success: true }) : response({ error: "Scheduled task not found" }, 404);
    }
    if (body.action === "toggle" && typeof body.id === "string" && typeof body.enabled === "boolean") {
      const task = setScheduledTaskEnabled(body.id, body.enabled);
      return task ? response({ data: task }) : response({ error: "Scheduled task not found" }, 404);
    }
    if (body.action === "run.delete" && typeof body.id === "string") {
      const result = deleteScheduledTaskRun(body.id);
      if (result === "deleted") return response({ success: true });
      if (result === "running") return response({ error: "A running execution cannot be deleted." }, 409);
      return response({ error: "Scheduled task run not found" }, 404);
    }
    if (body.action === "run" && typeof body.id === "string") {
      const rawParameters = body.parameters && typeof body.parameters === "object" && !Array.isArray(body.parameters) ? body.parameters as Record<string, unknown> : {};
      if (Object.keys(rawParameters).length > 100 || Object.values(rawParameters).some((value) => typeof value !== "string" || value.length > 16_384 || value.includes("\0"))) return response({ error: "A run parameter value is invalid." }, 400);
      const overrides = rawParameters as Record<string, string>;
      return response({ data: startScheduledTaskRun(body.id, "manual", user.id, overrides) }, 202);
    }
    return response({ error: "Unsupported scheduled task action" }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scheduled task operation failed";
    if (/UNIQUE constraint failed: vessel_job_projects\.name/i.test(message)) return response({ error: "A project with that name already exists." }, 409);
    if (/UNIQUE constraint failed: vessel_job_(global|project)_keys\./i.test(message)) return response({ error: "A protected key with that name already exists in this scope." }, 409);
    const conflict = /already exists|already running|concurrency limit|UNIQUE constraint failed/i.test(message);
    return response({ error: message }, conflict ? 409 : 400);
  }
}
