import { finishGitProviderConnection } from "@/server/api/git-provider-connect";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return finishGitProviderConnection(request, id);
}
