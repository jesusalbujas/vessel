import { receiveGitWebhook } from "@/server/api/git-webhooks";

// Compatibility endpoint for GitHub Apps created by earlier Vessel builds.
export const runtime = "nodejs";
export const POST = receiveGitWebhook;
