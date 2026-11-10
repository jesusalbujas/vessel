import { getRegistries, postRegistries, deleteRegistries } from "@/server/api/registries";
import { withAudit } from "@/lib/audit-log";
export const GET = getRegistries;
export const POST = (request: Request) => withAudit(request, postRegistries, "registries");
export const DELETE = (request: Request) => withAudit(request, deleteRegistries, "registries");
