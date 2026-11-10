import { deleteUser, getUsers, patchUsers, postUsers } from "@/server/api/users";
import { withAudit } from "@/lib/audit-log";
export const GET = getUsers;
export const POST = (request: Request) => withAudit(request, postUsers, "users");
export const PATCH = (request: Request) => withAudit(request, patchUsers, "users");
export const DELETE = (request: Request) => withAudit(request, deleteUser, "users");
