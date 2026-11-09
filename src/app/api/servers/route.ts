import { deleteRemoteServers, getRemoteServers, postRemoteServers } from "@/server/api/remote-servers";

export const GET = getRemoteServers;
export const POST = postRemoteServers;
export const DELETE = deleteRemoteServers;
