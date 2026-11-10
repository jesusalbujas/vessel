import { getLabels, postLabels, deleteLabels } from "@/server/api/labels";
import { withDockerEngine } from "@/lib/docker/request-context";
export const GET = withDockerEngine(getLabels);
export const POST = withDockerEngine(postLabels);
export const DELETE = withDockerEngine(deleteLabels);
