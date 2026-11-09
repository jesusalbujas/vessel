import { receiveGitWebhook } from "@/server/api/git-webhooks";

export const runtime = "nodejs";
export const POST = receiveGitWebhook;
