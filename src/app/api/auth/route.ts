import { getAuth, postAuth, patchAuth, deleteAuth } from "@/server/api/auth";
import { withAudit } from "@/lib/audit-log";
export const GET = getAuth;
export const POST = (request: Request) => withAudit(request, postAuth, "auth");
export const PATCH = (request: Request) => withAudit(request, patchAuth, "auth");
export const DELETE = (request: Request) => withAudit(request, deleteAuth, "auth");
