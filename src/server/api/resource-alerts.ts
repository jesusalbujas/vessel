import { NextResponse } from "next/server";
import { authenticatedUser, mutationUser, userHasPermission } from "@/lib/control-plane";
import { deleteResourceAlertRule, listResourceAlertEvents, listResourceAlertRules, resourceAlertEngines, saveResourceAlertRule, type ResourceMetric } from "@/lib/resource-alerts";

const headers = { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" };

export async function getResourceAlerts(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
  if (!userHasPermission(user, "monitoring.view")) return NextResponse.json({ error: "Permission denied" }, { status: 403, headers });
  return NextResponse.json({ rules: listResourceAlertRules(), events: listResourceAlertEvents(), engines: resourceAlertEngines(), canManage: userHasPermission(user, "monitoring.manage") }, { headers });
}

export async function mutateResourceAlerts(request: Request) {
  const user = mutationUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers });
  if (!userHasPermission(user, "monitoring.manage")) return NextResponse.json({ error: "Permission denied" }, { status: 403, headers });
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!input || typeof input.action !== "string") return NextResponse.json({ error: "Invalid request" }, { status: 400, headers });
  try {
    if (input.action === "delete" && typeof input.id === "string") {
      if (!deleteResourceAlertRule(input.id)) return NextResponse.json({ error: "Alert rule not found" }, { status: 404, headers });
      return NextResponse.json({ ok: true }, { headers });
    }
    if (input.action === "save") {
      const rule = saveResourceAlertRule({
        id: typeof input.id === "string" ? input.id : undefined,
        name: String(input.name ?? ""), engineId: String(input.engineId ?? ""),
        metric: input.metric as ResourceMetric, operator: input.operator as "above" | "below",
        threshold: Number(input.threshold), consecutiveSamples: Number(input.consecutiveSamples),
        notificationIntervalMinutes: Number(input.notificationIntervalMinutes ?? 15),
      });
      return NextResponse.json({ rule }, { headers });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400, headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save alert rule" }, { status: 400, headers });
  }
}
