import { getMetrics } from "@/server/api/metrics";
import { withDockerEngine } from "@/lib/docker/request-context";
export const GET = withDockerEngine(getMetrics);
