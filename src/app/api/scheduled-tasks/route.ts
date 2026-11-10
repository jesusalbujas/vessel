import { getScheduledTasks, postScheduledTasks } from "@/server/api/scheduled-tasks";
import { withAudit } from "@/lib/audit-log";
export const GET = getScheduledTasks;
export const POST = (request: Request) => withAudit(request, postScheduledTasks, "scheduled-tasks");
