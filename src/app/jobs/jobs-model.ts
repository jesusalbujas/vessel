export type Task = { id: string; projectId: string; name: string; description: string; groupName: string; cronExpression: string; timezone: string; environmentNames: string[]; options: JobOption[]; timeoutSeconds: number; enabled: boolean; scheduleEnabled: boolean; lastRunAt: string | null; createdAt: string; updatedAt: string; script?: string };
export type JobOption = { name: string; label: string; description: string; inputType: "text" | "password" | "date"; required: boolean; hidden: boolean; allowedValues: string[]; storagePath?: string };
export type JobProject = { id: string; name: string; description: string; createdAt: string; updatedAt: string; taskCount: number; keyCount: number };
export type JobKey = { name: string; updatedAt: string; scope?: "global" | "project" };
export type TaskStats = { executions: number; successRate: number; averageSeconds: number | null };
export type Run = { id: string; taskId: string; taskName: string; trigger: "manual" | "schedule"; status: "running" | "succeeded" | "failed"; exitCode: number | null; error: string | null; startedAt: string; finishedAt: string | null; startedBy: string | null; output?: string };
export type Form = { id: string; projectId: string; name: string; description: string; groupName: string; cronExpression: string; timezone: string; timeoutSeconds: number; script: string; environmentText: string; removedEnvironmentNames: string[]; environmentNames: string[]; options: JobOption[]; enabled: boolean; scheduleEnabled: boolean };

export const emptyForm = (projectId = "default"): Form => ({
  id: "", projectId, name: "", description: "", groupName: "ALL", cronExpression: "0 * * * *",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", timeoutSeconds: 1800,
  script: `#!/bin/sh\necho "Task started at $(date -Is)"\n`, environmentText: "",
  removedEnvironmentNames: [], environmentNames: [], options: [], enabled: true, scheduleEnabled: true,
});

export function parseEnvironment(text: string) {
  const output: Record<string, string> = {};
  for (const [index, line] of text.split("\n").entries()) {
    const current = line.trim();
    if (!current || current.startsWith("#")) continue;
    const separator = current.indexOf("=");
    if (separator < 1) throw new Error(`Environment line ${index + 1} must use KEY=VALUE.`);
    const name = current.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) throw new Error(`Environment variable on line ${index + 1} has an invalid name.`);
    output[name] = current.slice(separator + 1);
  }
  return output;
}

export function parseEnvironmentRows(text: string) {
  return text.split("\n").map((line, lineIndex) => {
    const current = line.trim();
    if (!current || current.startsWith("#")) return null;
    const separator = current.indexOf("=");
    if (separator === 0) return { lineIndex, name: "", value: current.slice(1) };
    if (separator < 0) return { lineIndex, name: current, value: "" };
    return { lineIndex, name: current.slice(0, separator).trim(), value: current.slice(separator + 1) };
  }).filter((row): row is { lineIndex: number; name: string; value: string } => row !== null);
}

export function localError(message: string, es: boolean) {
  if (!es) return message;
  if (message.includes("UNIQUE constraint failed")) return "Ya existe una tarea con ese nombre.";
  if (message.startsWith("Environment line ")) return message.replace("Environment line ", "La línea de variable ").replace(" must use KEY=VALUE.", " debe tener el formato CLAVE=VALOR.");
  if (message.startsWith("Environment variable on line ")) return message.replace("Environment variable on line ", "La variable de la línea ").replace(" has an invalid name.", " tiene un nombre no válido.");
  if (message.startsWith("Required job parameter ")) return message.replace("Required job parameter ", "El parámetro obligatorio ").replace(" needs a value.", " necesita un valor.");
  if (message.startsWith("Job parameter ") && message.endsWith(" must match one of its allowed values.")) return message.replace("Job parameter ", "El parámetro ").replace(" must match one of its allowed values.", " debe coincidir con uno de los valores permitidos.");
  const map: Record<string, string> = {
    "Administrator access required": "Se requiere acceso de administrador.",
    "This scheduled task is already running.": "Esta tarea ya se está ejecutando.",
    "The scheduled task runner is at its concurrency limit.": "El ejecutor alcanzó el máximo de tareas simultáneas.",
    "A task can contain up to 100 environment variables.": "Una tarea admite hasta 100 variables de entorno.",
    "Use a task name of 1–80 letters, numbers, spaces, dots, dashes, or underscores.": "El nombre debe tener entre 1 y 80 letras, números, espacios, puntos, guiones o guiones bajos.",
    "The task description must not exceed 500 characters.": "La descripción no puede superar 500 caracteres.",
    "The job group must be at most 100 characters.": "El grupo no puede superar los 100 caracteres.",
    "A job can contain up to 100 parameter definitions.": "Un trabajo admite hasta 100 definiciones de parámetros.",
    "A job parameter definition is invalid.": "La definición de un parámetro no es válida.",
    "A job parameter has an invalid name or exceeds its length limit.": "Un parámetro tiene un nombre no válido o supera el límite de longitud.",
    "Job parameter names must be unique.": "Los nombres de los parámetros deben ser únicos.",
    "Enter a valid five-field cron expression (minute hour day month weekday).": "Usa una expresión cron válida de cinco campos (minuto hora día mes día-semana).",
    "Choose a valid IANA time zone.": "Selecciona una zona horaria IANA válida.",
    "The shell script is required and must be at most 64 KB.": "El script de shell es obligatorio y debe ocupar como máximo 64 KB.",
    "Task timeout must be between 10 seconds and 2 hours.": "El tiempo límite debe estar entre 10 segundos y 2 horas.",
    "Scheduled task not found": "No se encontró la tarea programada.",
    "Scheduled task run not found": "No se encontró la ejecución.",
    "Scheduled task is disabled.": "La tarea programada está desactivada.",
    "This scheduled task is disabled for execution.": "Este trabajo está deshabilitado para ejecución.",
    "Scheduling is disabled for this task.": "La programación está deshabilitada para este trabajo.",
    "A run parameter is not defined for this job.": "Uno de los parámetros enviados no está definido para este trabajo.",
    "A run parameter value is invalid.": "El valor de un parámetro de ejecución no es válido.",
    "Task execution failed.": "Falló la ejecución de la tarea.",
    "Project name must contain 1–80 letters, numbers, spaces, dots, dashes, or underscores.": "El nombre del proyecto debe tener entre 1 y 80 letras, números, espacios, puntos, guiones o guiones bajos.",
    "A project with that name already exists.": "Ya existe un proyecto con ese nombre.",
    "The project description must not exceed 500 characters.": "La descripción no puede superar 500 caracteres.",
    "Delete or move this project's jobs before deleting it.": "Elimina o mueve los trabajos del proyecto antes de borrarlo.",
    "Key name must be a valid environment variable name.": "El nombre de clave debe ser una variable de entorno válida.",
    "Key value is invalid.": "El valor de la clave no es válido.",
    "Could not save task.": "No se pudo guardar la tarea.",
    "Could not load scheduled tasks.": "No se pudieron cargar las tareas programadas.",
    "An environment variable name or value is invalid.": "El nombre o valor de una variable de entorno no es válido.",
    "Environment variables must be a key/value object.": "Las variables de entorno deben ser pares de clave y valor.",
    "Configura una clave VESSEL_SECRET_KEY privada de al menos 32 caracteres aleatorios antes de guardar valores cifrados": "Configura una clave VESSEL_SECRET_KEY privada de al menos 32 caracteres aleatorios antes de guardar variables protegidas.",
  };
  return map[message] ?? message;
}

export function dateLabel(value: string | null, es: boolean) {
  if (!value) return es ? "Aún no ejecutada" : "Never run";
  return new Intl.DateTimeFormat(es ? "es-VE" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function normalizeProjectRoute(value: string) {
  let decoded = value;
  try { decoded = decodeURIComponent(value); } catch { /* Keep the original route value if malformed. */ }
  return decoded.trim().toLocaleLowerCase();
}
