import { getCompose, postCompose } from "@/server/api/compose";
import { withDockerEngine, withRemoteDockerCli } from "@/lib/docker/request-context";
export const GET = withDockerEngine(withRemoteDockerCli(getCompose));
export const POST = withDockerEngine(withRemoteDockerCli(postCompose));
