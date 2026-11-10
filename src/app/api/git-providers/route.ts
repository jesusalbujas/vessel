import { deleteGitProviderRequest, getGitProviders, postGitProviders } from "@/server/api/git-providers";
import { withAudit } from "@/lib/audit-log";

export const runtime = "nodejs";
export const GET = getGitProviders;
export const POST = (request: Request) => withAudit(request, postGitProviders, "git-providers");
export const DELETE = (request: Request) => withAudit(request, deleteGitProviderRequest, "git-providers");
