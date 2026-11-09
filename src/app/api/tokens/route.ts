import { deleteUserToken, getUserTokens, postUserToken } from "@/server/api/tokens";

export const GET = getUserTokens;
export const POST = postUserToken;
export const DELETE = deleteUserToken;
