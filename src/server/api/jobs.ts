import { NextResponse } from "next/server";
import { getCloneJob, getCloneJobs, retryOperationJob } from "@/lib/jobs";
import { authenticatedUser, mutationUser } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

export async function getJobs(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (id) {
    const job = getCloneJob(id);
    return job ? NextResponse.json({ data: job }) : NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ data: getCloneJobs().slice(0, 8) });
}

export async function postJobs(request: Request) {
  if (!mutationUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  let body: { id?: string; action?: string };
  try {
    body = await request.json() as { id?: string; action?: string };
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  if (body.action !== "retry" || !body.id) return NextResponse.json({ error: "id y action=retry son obligatorios" }, { status: 400 });
  const job = retryOperationJob(body.id);
  return job ? NextResponse.json({ data: job }) : NextResponse.json({ error: "Este trabajo no se puede reintentar" }, { status: 409 });
}
