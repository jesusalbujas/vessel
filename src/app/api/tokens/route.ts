import { deleteUserToken, getUserTokens, postUserToken } from "@/server/api/tokens";
import { withAudit } from "@/lib/audit-log";

export const GET = getUserTokens;
export const POST = (request: Request) => withAudit(request, postUserToken, "api-tokens");
export const DELETE = (request: Request) => withAudit(request, deleteUserToken, "api-tokens");
