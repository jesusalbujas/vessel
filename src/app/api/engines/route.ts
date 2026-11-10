import { getRemoteEngineChoices, patchRemoteEngineChoices } from "@/server/api/remote-servers";
import { withAudit } from "@/lib/audit-log";

export const GET = getRemoteEngineChoices;
export const PATCH = (request: Request) => withAudit(request, patchRemoteEngineChoices, "engines");
