import { deleteRemoteServers, getRemoteServers, postRemoteServers } from "@/server/api/remote-servers";
import { withAudit } from "@/lib/audit-log";

export const GET = getRemoteServers;
export const POST = (request: Request) => withAudit(request, postRemoteServers, "servers");
export const DELETE = (request: Request) => withAudit(request, deleteRemoteServers, "servers");
