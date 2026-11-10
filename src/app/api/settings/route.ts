import { getSettings, patchSettings } from "@/server/api/settings";
import { withAudit } from "@/lib/audit-log";

export const GET = getSettings;
export const PATCH = (request: Request) => withAudit(request, patchSettings, "settings");
