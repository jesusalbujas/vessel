import { getProjects, postProjects } from "@/server/api/projects";
import { withAudit } from "@/lib/audit-log";

export const GET = getProjects;
export const POST = (request: Request) => withAudit(request, postProjects, "projects");
