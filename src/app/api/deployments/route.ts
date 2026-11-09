import { deleteDeployments, getDeployments, postDeployments } from "@/server/api/deployments";

export const GET = getDeployments;
export const POST = postDeployments;
export const DELETE = deleteDeployments;
