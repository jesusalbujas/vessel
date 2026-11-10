import { getLogs } from "@/server/api/logs";
import { withDockerEngine } from "@/lib/docker/request-context";
export const GET = withDockerEngine(getLogs);
