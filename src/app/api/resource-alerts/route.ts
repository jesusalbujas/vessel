import { getResourceAlerts, mutateResourceAlerts } from "@/server/api/resource-alerts";
import { withAudit } from "@/lib/audit-log";

export const GET = getResourceAlerts;
export const POST = (request: Request) => withAudit(request, mutateResourceAlerts, "resource-alerts");
