import { deleteSession, getSessions } from "@/server/api/sessions";

export const runtime = "nodejs";
export const GET = getSessions;
export const DELETE = deleteSession;
