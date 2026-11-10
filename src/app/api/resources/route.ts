import { getResources, postResources, deleteResources } from "@/server/api/resources";
import { withDockerEngine } from "@/lib/docker/request-context";
import { withAudit } from "@/lib/audit-log";
export const GET = withDockerEngine(getResources);
export const POST = (request: Request) => withAudit(request, withDockerEngine(postResources), "docker-resources");
export const DELETE = (request: Request) => withAudit(request, withDockerEngine(deleteResources), "docker-resources");
