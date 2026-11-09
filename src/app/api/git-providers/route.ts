import { deleteGitProviderRequest, getGitProviders, postGitProviders } from "@/server/api/git-providers";

export const runtime = "nodejs";
export const GET = getGitProviders;
export const POST = postGitProviders;
export const DELETE = deleteGitProviderRequest;
