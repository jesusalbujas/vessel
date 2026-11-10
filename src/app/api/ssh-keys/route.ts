import { deleteSSHKeys, getSSHKeys, postSSHKeys } from "@/server/api/ssh-keys";
import { withAudit } from "@/lib/audit-log";

export const GET = getSSHKeys;
export const POST = (request: Request) => withAudit(request, postSSHKeys, "ssh-keys");
export const DELETE = (request: Request) => withAudit(request, deleteSSHKeys, "ssh-keys");
