import { claimVesselContainerScheduleRun, claimVesselProjectScheduleRun, finishVesselContainerScheduleRun, finishVesselProjectScheduleRun, getGitDeployment, listVesselContainerSchedules, listVesselProjectSchedules, listVesselProjectServices, type VesselContainerScheduleRecord, type VesselProjectScheduleRecord } from "@/lib/control-plane";
import { runWithDockerTarget } from "@/lib/docker/request-context";
import { startGitDeployment } from "@/lib/git-deployments";
import { runScheduledComposeProject } from "@/server/api/compose";
import { dockerApiBase, dockerHeaders } from "@/lib/docker/client";
import { listDockerContainers } from "@/lib/docker/containers";

const schedulerState = globalThis as typeof globalThis & { __vesselProjectScheduler?: boolean };
function zoned(date: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[parts.weekday] };
}
function due(schedule: Pick<VesselProjectScheduleRecord, "startsAt" | "timezone" | "endsAt" | "repeatMode" | "months" | "weekdays">, now: Date) {
  const start = new Date(schedule.startsAt);
  const end = schedule.endsAt ? new Date(schedule.endsAt) : null;
  if (!Number.isFinite(start.getTime()) || now < start || (end && now > end)) return null;
  const current = zoned(now, schedule.timezone);
  const first = zoned(start, schedule.timezone);
  if (current.hour !== first.hour || current.minute !== first.minute) return null;
  if (schedule.repeatMode === "once") {
    const nowKey = `${current.year}-${String(current.month).padStart(2,"0")}-${String(current.day).padStart(2,"0")}T${String(current.hour).padStart(2,"0")}:${String(current.minute).padStart(2,"0")}`;
    const startKey = `${first.year}-${String(first.month).padStart(2,"0")}-${String(first.day).padStart(2,"0")}T${String(first.hour).padStart(2,"0")}:${String(first.minute).padStart(2,"0")}`;
    return nowKey >= startKey ? startKey : null;
  }
  if (schedule.months.length && !schedule.months.includes(current.month)) return null;
  if (schedule.repeatMode === "weekly") {
    const days = schedule.weekdays.length ? schedule.weekdays : [first.weekday];
    if (!days.includes(current.weekday)) return null;
  }
  return `${current.year}-${String(current.month).padStart(2,"0")}-${String(current.day).padStart(2,"0")}T${String(current.hour).padStart(2,"0")}:${String(current.minute).padStart(2,"0")}`;
}
async function executeContainerSchedule(schedule: VesselContainerScheduleRecord) {
  await runWithDockerTarget(schedule.engineId, () => runContainerAction(schedule.containerName, schedule.action));
}
async function runContainerAction(name: string, action: VesselProjectScheduleRecord["action"]) {
  const container = (await listDockerContainers()).find((item) => (item.Names ?? []).some((candidate) => candidate.replace(/^\//, "") === name));
  if (!container) throw new Error("El contenedor del servicio no está disponible en el Engine");
  const call = async (verb: string) => {
    const result = await fetch(`${dockerApiBase()}/containers/${container.Id}/${verb}`, { method: "POST", headers: dockerHeaders(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!result.ok && result.status !== 304) throw new Error(`Docker no pudo ejecutar ${verb} (${result.status})`);
  };
  if (action === "down" || action === "down_up") await call("stop?t=10");
  if (action === "down_up" || action === "start") await call("start");
  if (action === "restart") await call("restart?t=10");
}
async function execute(schedule: VesselProjectScheduleRecord) {
  const service = listVesselProjectServices(schedule.projectId).find((item) => item.id === schedule.serviceId);
  if (!service?.targetType || !service.targetRef) throw new Error("El servicio programado ya no está asociado al proyecto");
  await runWithDockerTarget(schedule.engineId, async () => {
    if (service.targetType === "git") {
      const operation = schedule.action === "down_up" ? "down_up" : schedule.action;
      const deployment = startGitDeployment(service.targetRef!, "manual", undefined, undefined, operation);
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        const current = getGitDeployment(deployment.id);
        if (!current || !["queued", "running"].includes(current.status)) {
          if (current?.status !== "succeeded") throw new Error(current?.error || "El despliegue Git programado falló");
          break;
        }
      }
    } else if (service.targetType === "compose") {
      await runScheduledComposeProject(service.targetRef!, schedule.projectId, schedule.action);
    } else if (service.targetType === "container") {
      await runContainerAction(service.targetRef!, schedule.action);
    }
  });
}
function tick() {
  const now = new Date();
  for (const schedule of listVesselProjectSchedules()) {
    const key = due(schedule, now);
    if (!key || !claimVesselProjectScheduleRun(schedule.id, key, schedule.repeatMode === "once")) continue;
    void execute(schedule).then(() => finishVesselProjectScheduleRun(schedule.id, "succeeded")).catch((error) => {
      const message = error instanceof Error ? error.message : "La acción programada falló";
      finishVesselProjectScheduleRun(schedule.id, "failed", message);
      console.error(`Vessel scheduled project action ${schedule.id} failed:`, error);
    });
  }
  for (const schedule of listVesselContainerSchedules()) {
    const key = due(schedule, now);
    if (!key || !claimVesselContainerScheduleRun(schedule.id, key, schedule.repeatMode === "once")) continue;
    void executeContainerSchedule(schedule).then(() => finishVesselContainerScheduleRun(schedule.id, "succeeded")).catch((error) => {
      const message = error instanceof Error ? error.message : "La acción programada falló";
      finishVesselContainerScheduleRun(schedule.id, "failed", message);
      console.error(`Vessel scheduled container action ${schedule.id} failed:`, error);
    });
  }
}
export function startProjectScheduler() {
  if (schedulerState.__vesselProjectScheduler || process.env.NODE_ENV === "test") return;
  schedulerState.__vesselProjectScheduler = true;
  const timer = setInterval(() => { try { tick(); } catch (error) { console.error("Vessel project scheduler tick failed:", error); } }, 10_000);
  timer.unref?.();
  setTimeout(() => { try { tick(); } catch (error) { console.error("Vessel project scheduler initial tick failed:", error); } }, 2_000).unref?.();
}
