import { randomUUID } from "node:crypto";

export type CloneJobStep = "queued" | "dumping" | "creating_resource" | "restoring" | "pulling_image" | "creating_container" | "starting" | "completed" | "failed";
export type CloneJob = {
  id: string;
  kind: "duplicate" | "image";
  status: "running" | "completed" | "failed";
  step: CloneJobStep;
  message: string;
  percent: number;
  currentItem: string | null;
  errors: number;
  startedAt: string;
  finishedAt: string | null;
  sharedDataSource?: boolean;
  result?: { name: string; port: number; dataResource: string; dataCopied: boolean };
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
    currentItem: null, errors: 0, startedAt: new Date().toISOString(), finishedAt: null,
  };
  store.set(job.id, job);
  if (retryTask) retryTasks.set(job.id, retryTask);
  const update = (patch: Partial<CloneJob>) => Object.assign(job, patch);
  void task(update).then((result) => {
    update({ status: "completed", step: "completed", message: kind === "image" ? "Operación completada" : result?.dataCopied ? "Servicio y datos copiados" : "Aplicación creada conservando su origen de datos", percent: 100, finishedAt: new Date().toISOString(), result });
  }).catch((error) => {
    update({ status: "failed", step: "failed", message: error instanceof Error ? error.message : "El trabajo falló", finishedAt: new Date().toISOString() });
  });
  return job;
}

export function retryOperationJob(id: string): CloneJob | null {
  return retryTasks.get(id)?.() ?? null;
}

export function startCloneJob(task: (update: (patch: Partial<CloneJob>) => void) => Promise<CloneJob["result"]>, sharedDataSource = false): CloneJob {
  const job = startOperationJob("duplicate", task);
  job.sharedDataSource = sharedDataSource;
  return job;
}
