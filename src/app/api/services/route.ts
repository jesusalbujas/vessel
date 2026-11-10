import { getServices, postServices } from "@/server/api/services";
import { withDockerEngine } from "@/lib/docker/request-context";
import { withAudit } from "@/lib/audit-log";
export const GET = withDockerEngine(getServices);
export const POST = (request: Request) => withAudit(request, withDockerEngine(postServices), "containers");
