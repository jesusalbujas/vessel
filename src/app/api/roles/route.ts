import { deleteRoles, getRoles, patchRoles, postRoles } from "@/server/api/roles";

export const GET = getRoles;
export const POST = postRoles;
export const PATCH = patchRoles;
export const DELETE = deleteRoles;
