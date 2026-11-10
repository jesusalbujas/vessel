import { getLabels, postLabels, deleteLabels } from "@/server/api/labels";
import { withDockerEngine } from "@/lib/docker/request-context";
import { withAudit } from "@/lib/audit-log";
export const GET = withDockerEngine(getLabels);
export const POST = (request: Request) => withAudit(request, withDockerEngine(postLabels), "labels");
export const DELETE = (request: Request) => withAudit(request, withDockerEngine(deleteLabels), "labels");
