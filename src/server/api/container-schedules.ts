import { NextResponse } from "next/server";
import { authenticatedUser, createVesselContainerSchedule, deleteVesselContainerSchedule, listVesselContainerSchedules, userHasPermission, type VesselProjectScheduleAction } from "@/lib/control-plane";
import { listDockerContainers } from "@/lib/docker/containers";
import { runWithDockerTarget } from "@/lib/docker/request-context";
import { remoteServerWithKey } from "@/lib/remote-servers";

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
}
function engineFromRequest(request: Request) {
  const raw = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("vessel-engine-id="))?.slice("vessel-engine-id=".length);
  if (!raw || raw === "local") return null;
  let id = "";
  try { id = decodeURIComponent(raw); } catch { throw new Error("El Engine seleccionado no es válido."); }
  if (!/^[a-f0-9-]{36}$/i.test(id) || !remoteServerWithKey(id)) throw new Error("El Engine seleccionado ya no está registrado.");
  return id;
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && value.length < 40 && Number.isFinite(Date.parse(value));
}
async function findContainer(name: string, engineId: string | null) {
  return runWithDockerTarget(engineId, async () => (await listDockerContainers()).find((container) => (container.Names ?? []).some((candidate) => candidate.replace(/^\//, "") === name)) ?? null);
}
export async function getContainerSchedules(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return response({ error: "Authentication required" }, 401);
  if (!userHasPermission(user, "containers.view")) return response({ error: "Permission denied" }, 403);
  const containerName = new URL(request.url).searchParams.get("containerName") ?? "";
  if (!containerName || containerName.length > 255) return response({ error: "Container is required" }, 400);
  let engineId: string | null;
  try { engineId = engineFromRequest(request); } catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid Engine" }, 400); }
  return response({ data: listVesselContainerSchedules(containerName, engineId, true), canManage: userHasPermission(user, "containers.manage") });
}
export async function postContainerSchedules(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return response({ error: "Authentication required" }, 401);
  if (!userHasPermission(user, "containers.manage")) return response({ error: "Permission denied" }, 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.containerName !== "string" || body.containerName.length > 255) return response({ error: "Container is required" }, 400);
  let engineId: string | null;
  try { engineId = engineFromRequest(request); } catch (error) { return response({ error: error instanceof Error ? error.message : "Invalid Engine" }, 400); }
  if (body.action === "delete") {
    if (typeof body.id !== "string" || !deleteVesselContainerSchedule(body.id, body.containerName, engineId)) return response({ error: "Schedule not found" }, 404);
    return response({ ok: true });
  }
  if (body.action !== "create") return response({ error: "Invalid action" }, 400);
  const container = await findContainer(body.containerName, engineId).catch(() => null);
  if (!container) return response({ error: "The selected container is not available on this Engine" }, 404);
  const operation = body.operation as VesselProjectScheduleAction;
  if (!["restart", "start", "down", "down_up"].includes(operation)) return response({ error: "Invalid scheduled operation" }, 400);
  if (!validDate(body.startsAt) || Date.parse(body.startsAt) < Date.now() - 10_000) return response({ error: "Choose a future date and time" }, 400);
  const timezone = typeof body.timezone === "string" ? body.timezone : "";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); } catch { return response({ error: "Choose a valid time zone" }, 400); }
  const repeatMode = body.repeatMode;
  if (!( ["once", "daily", "weekly"] as unknown[]).includes(repeatMode)) return response({ error: "Invalid repeat rule" }, 400);
  const weekdays = Array.isArray(body.weekdays) ? body.weekdays : [];
  const months = Array.isArray(body.months) ? body.months : Array.from({ length: 12 }, (_, index) => index + 1);
  if (weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || months.some((month) => !Number.isInteger(month) || month < 1 || month > 12) || !months.length) return response({ error: "Invalid days or months" }, 400);
  if (repeatMode === "weekly" && weekdays.length === 0) return response({ error: "Choose at least one weekday" }, 400);
  const endsAt = body.endsAt === null || body.endsAt === "" ? null : typeof body.endsAt === "string" ? body.endsAt : "invalid";
  if (endsAt !== null && (!validDate(endsAt) || Date.parse(endsAt) <= Date.parse(body.startsAt))) return response({ error: "The end date must be after the start date" }, 400);
  const created = createVesselContainerSchedule({
    containerId: body.containerName, containerName: body.containerName, engineId, action: operation,
    startsAt: body.startsAt, timezone, repeatMode: repeatMode as "once" | "daily" | "weekly",
    weekdays: weekdays as number[], months: months as number[], endsAt, createdBy: user.id,
  });
  return response({ data: created }, 201);
}
