import { getOverview } from "@/server/api/overview";
import { withDockerEngine } from "@/lib/docker/request-context";

export const GET = withDockerEngine(getOverview);
