import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { appendScheduledTaskRunOutput, createScheduledTaskRun, finishScheduledTaskRun, scheduledTaskRuntimeData } from "@/lib/scheduled-task-store";

const activeTasks = new Set<string>();
const maxConcurrentTasks = 2;
const outputLimit = 256 * 1024;
const workDirectory = resolve(/* turbopackIgnore: true */ process.env.VESSEL_TASK_WORKDIR ?? "/app/data", "scripts");

function safeEnvironment(values: Record<string, string>, taskId: string, taskName: string, projectId: string, projectName: string, runId: string): NodeJS.ProcessEnv {
  const inherited = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_API_VERSION"];
  const env: NodeJS.ProcessEnv = Object.fromEntries(inherited.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]])) as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(values)) env[key] = value;
  env.VESSEL_TASK_ID = taskId;
  env.VESSEL_TASK_NAME = taskName;
  env.VESSEL_TASK_RUN_ID = runId;
  env.VESSEL_JOB_ID = taskId;
  env.VESSEL_JOB_NAME = taskName;
  env.VESSEL_PROJECT_ID = projectId;
  env.VESSEL_PROJECT_NAME = projectName;
  return env;
}

function appendOutput(runId: string, chunk: string, secrets: string[], final = false, state: { hold: string }) {
  let combined = state.hold + chunk;
  for (const secret of secrets) if (secret.length >= 4) combined = combined.split(secret).join("[REDACTED]");
  const holdLength = final ? 0 : Math.min(Math.max(0, ...secrets.filter((secret) => secret.length >= 4).map((secret) => secret.length - 1)), combined.length);
  const emitted = combined.slice(0, combined.length - holdLength);
  state.hold = combined.slice(combined.length - holdLength);
  if (emitted) {
    try { appendScheduledTaskRunOutput(runId, emitted.slice(-outputLimit)); }
    catch (error) { console.error("Could not persist scheduled-task output", error); }
  }
}

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
}

export function startScheduledTaskRun(taskId: string, trigger: "manual" | "schedule" = "manual", startedBy?: string | null, overrides: Record<string, string> = {}) {
  if (activeTasks.has(taskId)) throw new Error("This scheduled task is already running.");
  if (activeTasks.size >= maxConcurrentTasks) throw new Error("The scheduled task runner is at its concurrency limit.");
  const storedTask = scheduledTaskRuntimeData(taskId);
  if (!storedTask) throw new Error("Scheduled task not found.");
  if (!storedTask.enabled) throw new Error("This scheduled task is disabled for execution.");
  if (trigger === "schedule" && !storedTask.scheduleEnabled) throw new Error("Scheduling is disabled for this task.");
  const allowedNames = new Set(storedTask.options.map((option) => option.name));
  if (Object.keys(overrides).some((name) => !allowedNames.has(name))) throw new Error("A run parameter is not defined for this job.");
  for (const option of storedTask.options) {
    const value = overrides[option.name];
    const defaultValue = option.storagePath ? storedTask.storageValues[option.storagePath] : storedTask.environment[option.name] ?? storedTask.environment[`VESSEL_${option.name.replace(/^VESSEL_/, "")}`];
    if (option.storagePath && defaultValue === undefined) throw new Error(`Storage path ${option.storagePath} for job parameter ${option.name} was not found.`);
    if (option.required && !defaultValue?.trim() && !value?.trim()) throw new Error(`Required job parameter ${option.name} needs a value.`);
    if (option.allowedValues.length && (value ?? defaultValue) && !option.allowedValues.includes((value ?? defaultValue)!)) throw new Error(`Job parameter ${option.name} must match one of its allowed values.`);
  }
  const environment = { ...storedTask.environment, ...overrides };
  for (const option of storedTask.options) {
    if (!option.storagePath || overrides[option.name] !== undefined) continue;
    const value = storedTask.storageValues[option.storagePath];
    if (value !== undefined) environment[option.name] = value;
  }
  for (const [name, value] of Object.entries(overrides)) environment[`VESSEL_${name.replace(/^VESSEL_/, "")}`] = value;
  for (const option of storedTask.options) {
    const value = environment[option.name];
    if (value !== undefined) environment[`VESSEL_${option.name.replace(/^VESSEL_/, "")}`] = value;
  }
  const task = { ...storedTask, environment };
  const run = createScheduledTaskRun(task, trigger, startedBy);
  activeTasks.add(taskId);
  void (async () => {
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const redactState = { hold: "" };
    const secretValues = Object.values(task.environment);
    try {
      await mkdir(workDirectory, { recursive: true, mode: 0o700 });
      const useBash = /^#!.*(?:\/bash|env\s+bash)(?:\s|$)/m.test(task.script.slice(0, 160));
      const child = spawn(useBash ? "/bin/bash" : "/bin/sh", ["-eu"], {
        cwd: workDirectory,
        env: safeEnvironment(task.environment, task.id, task.name, task.projectId, task.projectName, run.id),
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
      const output = (chunk: Buffer) => appendOutput(run.id, chunk.toString("utf8"), secretValues, false, redactState);
      child.stdout.on("data", output);
      child.stderr.on("data", output);
      timer = setTimeout(() => {
        timedOut = true;
        killProcessGroup(child, "SIGTERM");
        forceKillTimer = setTimeout(() => killProcessGroup(child, "SIGKILL"), 5000);
        forceKillTimer.unref();
      }, task.timeoutSeconds * 1000);
      child.stdin.end(task.script, "utf8");
      const result = await new Promise<{ code: number | null; error: Error | null }>((resolve) => {
        child.once("error", (error) => resolve({ code: null, error }));
        child.once("close", (code) => resolve({ code, error: null }));
      });
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      appendOutput(run.id, "", secretValues, true, redactState);
      const error = timedOut ? `Task exceeded its ${task.timeoutSeconds}-second timeout.` : result.error?.message ?? null;
      finishScheduledTaskRun(run.id, timedOut ? 124 : result.code, error);
    } catch (error) {
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      appendOutput(run.id, error instanceof Error ? `${error.message}\n` : "Task execution failed.\n", secretValues, true, redactState);
      finishScheduledTaskRun(run.id, null, error instanceof Error ? error.message : "Task execution failed.");
    } finally {
      activeTasks.delete(taskId);
    }
  })();
  return run;
}


export function isScheduledTaskRunning(taskId: string) { return activeTasks.has(taskId); }
export function scheduledTaskRunnerStatus() { return { running: activeTasks.size, maxConcurrent: maxConcurrentTasks }; }
