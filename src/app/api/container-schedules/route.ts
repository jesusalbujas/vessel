import { withAudit } from "@/lib/audit-log";
import { getContainerSchedules, postContainerSchedules } from "@/server/api/container-schedules";

export const GET = getContainerSchedules;
export const POST = (request: Request) => withAudit(request, postContainerSchedules, "container-schedules");
