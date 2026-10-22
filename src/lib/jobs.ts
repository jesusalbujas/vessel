import { randomUUID } from "node:crypto";

export type CloneJobStep = "queued" | "dumping" | "creating_database" | "restoring" | "pulling_image" | "creating_container" | "starting" | "completed" | "failed";
export type CloneJob = {
  id: string;
  kind: "duplicate" | "image";
  status: "running" | "completed" | "failed";
  step: CloneJobStep;
  message: string;
  percent: number;
  currentTable: string | null;
  errors: number;
  startedAt: string;
  finishedAt: string | null;
  sharedDatabase?: boolean;
  result?: { name: string; port: number; database: string; databaseCloned: boolean };
};

const store = new Map<string, CloneJob>();
const retryTasks = new Map<string, () => CloneJob>();

export function getCloneJobs(): CloneJob[] {
  return [...store.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getCloneJob(id: string): CloneJob | null {
  return store.get(id) ?? null;
}

export function startOperationJob(kind: CloneJob["kind"], task: (update: (patch: Partial<CloneJob>) => void) => Promise<CloneJob["result"]>, retryTask?: () => CloneJob): CloneJob {
  const job: CloneJob = {
    id: randomUUID(), kind, status: "running", step: "queued", message: "Trabajo en cola", percent: 0,
    currentTable: null, errors: 0, startedAt: new Date().toISOString(), finishedAt: null,
  };
  store.set(job.id, job);
  if (retryTask) retryTasks.set(job.id, retryTask);
  const update = (patch: Partial<CloneJob>) => Object.assign(job, patch);
  void task(update).then((result) => {
    update({ status: "completed", step: "completed", message: kind === "image" ? "Operación completada" : result?.databaseCloned ? "Servicio y base restaurados" : "Aplicación creada con la misma BD", percent: 100, finishedAt: new Date().toISOString(), result });
  }).catch((error) => {
    update({ status: "failed", step: "failed", message: error instanceof Error ? error.message : "El trabajo falló", finishedAt: new Date().toISOString() });
  });
  return job;
}

export function retryOperationJob(id: string): CloneJob | null {
  return retryTasks.get(id)?.() ?? null;
}

export function startCloneJob(task: (update: (patch: Partial<CloneJob>) => void) => Promise<CloneJob["result"]>, sharedDatabase = false): CloneJob {
  const job = startOperationJob("duplicate", task);
  job.sharedDatabase = sharedDatabase;
  return job;
}
