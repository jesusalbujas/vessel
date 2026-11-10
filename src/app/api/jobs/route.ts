import { getJobs, postJobs } from "@/server/api/jobs";
import { withAudit } from "@/lib/audit-log";
export const GET = getJobs;
export const POST = (request: Request) => withAudit(request, postJobs, "jobs");
