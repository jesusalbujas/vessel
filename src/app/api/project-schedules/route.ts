import { getProjectSchedules, postProjectSchedules } from "@/server/api/project-schedules";
import { withAudit } from "@/lib/audit-log";
export const GET = getProjectSchedules;
export const POST = (request: Request) => withAudit(request, postProjectSchedules, "project-schedules");
