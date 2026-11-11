import { postContainerExec } from "@/server/api/container-exec";
import { withDockerEngine } from "@/lib/docker/request-context";
import { withAudit } from "@/lib/audit-log";

export const POST = (request: Request) => withAudit(request, withDockerEngine(postContainerExec), "container-exec");
