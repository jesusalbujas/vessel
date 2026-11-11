import { getContainerFiles, postContainerFiles } from "@/server/api/container-files";
import { withDockerEngine } from "@/lib/docker/request-context";
import { withAudit } from "@/lib/audit-log";

export const GET = withDockerEngine(getContainerFiles);
export const POST = (request: Request) => withAudit(request, withDockerEngine(postContainerFiles), "container-files");
