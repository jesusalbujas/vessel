import { getServices, postServices } from "@/server/api/services";
import { withDockerEngine } from "@/lib/docker/request-context";
export const GET = withDockerEngine(getServices);
export const POST = withDockerEngine(postServices);
