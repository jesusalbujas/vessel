import { NextResponse } from "next/server";
import { authenticatedUser, mutationUser } from "@/lib/control-plane";
import { dockerApiBase } from "@/lib/docker/client";
import { deleteRemoteServer, listRemoteServers, markRemoteServerTested, remoteServerWithKey, saveRemoteServer } from "@/lib/remote-servers";
import { getSSHKeyPrivate } from "@/lib/ssh-keys";

type RemoteInput = { id?: string; name?: string; host?: string; port?: number; username?: string; privateKey?: string; sshKeyId?: string; fingerprint?: string; knownHost?: string };
type EngineInfo = { name: string; serverVersion: string; operatingSystem: string; architecture: string; nCPU: number; memTotal: number };
type ValidRemoteInput = { name: string; host: string; port: number; username: string; privateKey: string; fingerprint: string; knownHost: string };

function response(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}

async function backend(path: string, method: "GET" | "POST" | "DELETE", body?: unknown) {
  const result = await fetch(`${dockerApiBase()}/${path}`, {
    method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await result.json().catch(() => ({})) as Record<string, unknown>;
  if (!result.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo conectar con el backend de Docker");
  return payload;
}

function validInput(input: RemoteInput, privateKey: string): boolean {
  return typeof input.name === "string" && input.name.trim().length > 0 && input.name.trim().length <= 80 &&
    typeof input.host === "string" && input.host.trim().length > 0 && input.host.trim().length <= 253 &&
    Number.isInteger(input.port) && Number(input.port) > 0 && Number(input.port) <= 65535 &&
    typeof input.username === "string" && /^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(input.username) &&
    privateKey.length > 0 && privateKey.length <= 64_000 && privateKey.length <= 64_000 && privateKey.includes("PRIVATE KEY") &&
    typeof input.fingerprint === "string" && /^SHA256:[A-Za-z0-9+/]{20,50}=?$/.test(input.fingerprint) &&
    typeof input.knownHost === "string" && input.knownHost.length > 0 && input.knownHost.length <= 4096;
}

export async function getRemoteServers(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return response({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "administrator") return response({ error: "Administrator access required" }, { status: 403 });
  const servers = listRemoteServers();
  await Promise.allSettled(servers.map(async (server) => {
    const privateRecord = remoteServerWithKey(server.id);
    if (privateRecord) await backend("engines/register", "POST", privateRecord);
  }));
  return response({ data: servers });
}

export async function postRemoteServers(request: Request) {
  const user = mutationUser(request);
  if (!user) return response({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "administrator") return response({ error: "Administrator access required" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 80_000) return response({ error: "Request too large" }, { status: 413 });
  const body = await request.json().catch(() => null) as ({ action?: string } & RemoteInput) | null;
  if (!body) return response({ error: "Invalid request" }, { status: 400 });
  try {
    if (body.action === "fingerprint") {
      if (typeof body.host !== "string" || body.host.trim().length > 253 || !body.host.trim() || !Number.isInteger(body.port) || Number(body.port) < 1 || Number(body.port) > 65535) return response({ error: "Indica un host y puerto SSH válidos" }, { status: 400 });
      const result = await backend("engines/fingerprint", "POST", { host: body.host.trim(), port: body.port });
      return response(result);
    }
    if (body.action === "test") {
      const privateKey = typeof body.sshKeyId === "string" ? getSSHKeyPrivate(body.sshKeyId) : typeof body.privateKey === "string" ? body.privateKey : "";
      if (!privateKey || !validInput(body, privateKey)) return response({ error: "Revisa nombre, host, puerto, usuario, clave SSH y huella SSH" }, { status: 400 });
      const test = await backend("engines/test", "POST", {
        id: "vessel-test-0001", name: body.name.trim(), host: body.host.trim(), port: body.port,
        username: body.username, privateKey, fingerprint: body.fingerprint, knownHost: body.knownHost,
      });
      let server;
      try { server = saveRemoteServer({ ...body, privateKey } as ValidRemoteInput); }
      catch (error) {
        if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return response({ error: "Ya existe un servidor con ese nombre" }, { status: 409 });
        throw error;
      }
      const privateRecord = remoteServerWithKey(server.id);
      if (privateRecord) await backend("engines/register", "POST", privateRecord);
      return response({ ok: true, data: server, engine: test.data as EngineInfo }, { status: 201 });
    }
    if (body.action === "retest" && typeof body.id === "string") {
      const record = remoteServerWithKey(body.id);
      if (!record) return response({ error: "Servidor no encontrado" }, { status: 404 });
      const test = await backend("engines/test", "POST", record);
      markRemoteServerTested(record.id);
      await backend("engines/register", "POST", record);
      return response({ ok: true, engine: test.data as EngineInfo });
    }
    return response({ error: "Acción no válida" }, { status: 400 });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "No se pudo conectar al servidor remoto" }, { status: 502 });
  }
}

export async function deleteRemoteServers(request: Request) {
  const user = mutationUser(request);
  if (!user) return response({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "administrator") return response({ error: "Administrator access required" }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9-]{36}$/i.test(id)) return response({ error: "ID de servidor inválido" }, { status: 400 });
  try {
    await backend(`engines/remove/${encodeURIComponent(id)}`, "DELETE");
    return response({ ok: deleteRemoteServer(id) });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "No se pudo quitar el servidor" }, { status: 502 });
  }
}
