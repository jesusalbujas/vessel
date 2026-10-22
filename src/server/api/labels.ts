import { NextResponse } from "next/server";
import { addContainerLabel, listContainerLabels, removeContainerLabel } from "@/lib/metadata";
import { authenticatedUser, mutationUser } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

export async function getLabels(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    return NextResponse.json({ data: listContainerLabels() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible leer las etiquetas" }, { status: 500 });
  }
}

export async function postLabels(request: Request) {
  if (!mutationUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { containerId?: string; label?: string };
    if (!body.containerId || !body.label) return NextResponse.json({ error: "containerId y label son obligatorios" }, { status: 400 });
    const label = addContainerLabel(body.containerId, body.label);
    return NextResponse.json({ ok: true, containerId: body.containerId, label });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible guardar la etiqueta" }, { status: 400 });
  }
}

export async function deleteLabels(request: Request) {
  if (!mutationUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const body = await request.json() as { containerId?: string; label?: string };
    if (!body.containerId || !body.label) return NextResponse.json({ error: "containerId y label son obligatorios" }, { status: 400 });
    removeContainerLabel(body.containerId, body.label);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible borrar la etiqueta" }, { status: 400 });
  }
}
