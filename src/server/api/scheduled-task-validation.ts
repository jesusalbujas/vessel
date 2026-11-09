import { isValidCronExpression } from "@/lib/cron-schedule";

function parseTaskEnvironment(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Environment variables must be a key/value object.");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new Error("A task can contain up to 100 environment variables.");
  const environment: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key) || typeof raw !== "string" || raw.length > 16_384 || /\0/.test(raw)) {
      throw new Error("An environment variable name or value is invalid.");
    }
    environment[key] = raw;
  }
  return environment;
}

export function validateScheduledTask(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" ? body.description : "";
  const cronExpression = typeof body.cronExpression === "string" ? body.cronExpression.trim() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone : "UTC";
  const script = typeof body.script === "string" ? body.script : "";
  const timeoutSeconds = Number(body.timeoutSeconds ?? 1800);
  const projectId = typeof body.projectId === "string" && body.projectId ? body.projectId : "default";
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,79}$/u.test(name)) throw new Error("Use a task name of 1–80 letters, numbers, spaces, dots, dashes, or underscores.");
  if (description.length > 500) throw new Error("The task description must not exceed 500 characters.");
  if (!isValidCronExpression(cronExpression)) throw new Error("Enter a valid five-field cron expression (minute hour day month weekday).");
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }); } catch { throw new Error("Choose a valid IANA time zone."); }
  if (!script.trim() || script.length > 64_000 || /\0/.test(script)) throw new Error("The shell script is required and must be at most 64 KB.");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 10 || timeoutSeconds > 7200) throw new Error("Task timeout must be between 10 seconds and 2 hours.");
  const removedEnvironmentNames = Array.isArray(body.removedEnvironmentNames)
    ? body.removedEnvironmentNames.filter((name): name is string => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))
    : [];
  return { name, description, cronExpression, timezone, script, timeoutSeconds, projectId, environment: parseTaskEnvironment(body.environment ?? {}), removedEnvironmentNames };
}

