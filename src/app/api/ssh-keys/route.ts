import { deleteSSHKeys, getSSHKeys, postSSHKeys } from "@/server/api/ssh-keys";

export const GET = getSSHKeys;
export const POST = postSSHKeys;
export const DELETE = deleteSSHKeys;
