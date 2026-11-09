import { deleteUser, getUsers, patchUsers, postUsers } from "@/server/api/users";
export const GET = getUsers;
export const POST = postUsers;
export const PATCH = patchUsers;
export const DELETE = deleteUser;
