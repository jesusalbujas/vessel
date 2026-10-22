import { NextResponse } from "next/server";
import { createRegistry, currentUser, deleteRegistry, listRegistries, registryCredentialsById } from "@/lib/control-plane";
import { isDockerConfigured, testDockerRegistryCredentials } from "@/lib/docker";
import { prepareRegistry } from "@/lib/registries";

function auth(request: Request) {
  return currentUser(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null);
}

export async function getRegistries(request: Request) {
  const user = auth(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ data: listRegistries(), canManage: user.role === "administrator" });
}

export async function postRegistries(request: Request) {
  const user = auth(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  let body: { action?: "test" | "test_saved" | "save"; id?: string; provider?: string; name?: string; url?: string; baseUrl?: string; region?: string; username?: string; password?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }

  try {
    if (body.action === "test_saved") {
      if (!body.id) return NextResponse.json({ error: "Registry id is required" }, { status: 400 });
      const credentials = registryCredentialsById(body.id);
      if (!credentials) return NextResponse.json({ error: "Registry not found" }, { status: 404 });
      await testDockerRegistryCredentials(credentials);
      return NextResponse.json({ ok: true, message: "Registry credentials accepted by Docker Engine" });
    }
    const credentials = prepareRegistry(body);
    if (body.action === "test") {
      await testDockerRegistryCredentials(credentials);
      return NextResponse.json({ ok: true, message: "Registry credentials accepted by Docker Engine" });
    }
    if (body.action !== "save") return NextResponse.json({ error: "Unsupported registry action" }, { status: 400 });
    const registry = createRegistry(credentials);
    return NextResponse.json({ data: registry }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process registry";
    const status = !isDockerConfigured() && message.includes("backend Docker") ? 503 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function deleteRegistries(request: Request) {
  const user = auth(request);
  if (!user || user.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  let body: { id?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "Registry id is required" }, { status: 400 });
  deleteRegistry(body.id);
  return NextResponse.json({ ok: true });
}
