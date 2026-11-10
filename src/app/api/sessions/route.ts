import { deleteSession, getSessions } from "@/server/api/sessions";
import { withAudit } from "@/lib/audit-log";

export const runtime = "nodejs";
export const GET = getSessions;
export const DELETE = (request: Request) => withAudit(request, deleteSession, "sessions");
