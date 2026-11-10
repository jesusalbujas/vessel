import { getDockerUpdate } from "@/server/api/docker-update";
import { withDockerEngine } from "@/lib/docker/request-context";

export const runtime = "nodejs";
export const GET = withDockerEngine(getDockerUpdate);
