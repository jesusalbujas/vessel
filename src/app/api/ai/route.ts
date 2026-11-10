import { getAISettings, postAISettings } from "@/server/api/ai";
import { withAudit } from "@/lib/audit-log";

export const GET = getAISettings;
export const POST = (request: Request) => withAudit(request, postAISettings, "ai-settings");
