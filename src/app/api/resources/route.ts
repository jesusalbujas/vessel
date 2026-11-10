import { getResources, postResources, deleteResources } from "@/server/api/resources";
import { withDockerEngine } from "@/lib/docker/request-context";
export const GET = withDockerEngine(getResources);
export const POST = withDockerEngine(postResources);
export const DELETE = withDockerEngine(deleteResources);
