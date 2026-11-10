import { getCompose, postCompose } from "@/server/api/compose";
import { withDockerEngine, withRemoteDockerCli } from "@/lib/docker/request-context";
import { withAudit } from "@/lib/audit-log";
export const GET = withDockerEngine(withRemoteDockerCli(getCompose));
export const POST = (request: Request) => withAudit(request, withDockerEngine(withRemoteDockerCli(postCompose)), "compose");
