import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/control-plane";
import { dockerApiBase } from "@/lib/docker/client";
import { currentDockerEngineId, runWithDockerEngine, runWithDockerCliEnvironment } from "@/lib/docker/engine-context";
import { remoteServerWithKey } from "@/lib/remote-servers";

export { currentDockerEngineId, dockerCliEnvironment, runWithDockerEngine } from "@/lib/docker/engine-context";

export function withDockerEngine<T extends Response | Promise<Response>>(handler: (request: Request) => T) {
  return async (request: Request): Promise<Response> => {
    if (!authenticatedUser(request)) return await handler(request);
    const cookie = request.headers.get("cookie") ?? "";
    const value = new URL(request.url).searchParams.get("engineId") ?? cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-engine-id="))?.slice("vessel-engine-id=".length);
    let engineId: string | null;
    try { engineId = value ? decodeURIComponent(value) : null; }
    catch { return NextResponse.json({ error: "El Engine seleccionado no es válido" }, { status: 400 }); }
    if (!engineId || engineId === "local") return await runWithDockerEngine(null, () => handler(request));
    if (!/^[a-f0-9-]{36}$/i.test(engineId)) return NextResponse.json({ error: "El Engine seleccionado no es válido" }, { status: 400 });
    const engine = remoteServerWithKey(engineId);
    if (!engine) return NextResponse.json({ error: "El servidor seleccionado ya no está registrado" }, { status: 404 });
    try {
      const registration = await fetch(`${dockerApiBase()}/engines/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(engine),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (!registration.ok) return NextResponse.json({ error: "No se pudo preparar la conexión con el Engine remoto" }, { status: 502 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo conectar con el Engine remoto" }, { status: 502 });
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
    return await runWithDockerEngine(engineId, () => handler(request), signal);
  };
}

export function withRemoteDockerCli<T extends Response | Promise<Response>>(handler: (request: Request) => T) {
  return async (request: Request): Promise<Response> => {
    const engineId = currentDockerEngineId();
    if (!engineId) return await handler(request);
    const engine = remoteServerWithKey(engineId);
    if (!engine) return NextResponse.json({ error: "El servidor seleccionado ya no está registrado" }, { status: 404 });
    const validHost = isIP(engine.host) !== 0 || engine.host.split(".").every((label) => /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label));
    if (!validHost || !/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}$/.test(engine.username)) {
      return NextResponse.json({ error: "La configuración SSH guardada para este servidor no es válida" }, { status: 400 });
    }
    const home = await mkdtemp(join(tmpdir(), "vessel-ssh-compose-"));
    const sshDirectory = join(home, ".ssh");
    const alias = `vessel-${engine.id}`;
    try {
      await mkdir(sshDirectory, { mode: 0o700 });
      const identityFile = join(sshDirectory, "id_ed25519");
      const knownHostsFile = join(sshDirectory, "known_hosts");
      const configFile = join(sshDirectory, "config");
      await writeFile(identityFile, engine.privateKey, { mode: 0o600 });
      await writeFile(knownHostsFile, `${engine.knownHost.trim()}\n`, { mode: 0o600 });
      await writeFile(configFile, [
        `Host ${alias}`,
        `  HostName ${engine.host}`,
        `  User ${engine.username}`,
        `  Port ${engine.port}`,
        `  IdentityFile ${identityFile}`,
        "  IdentitiesOnly yes",
        "  StrictHostKeyChecking yes",
        `  UserKnownHostsFile ${knownHostsFile}`,
        "  BatchMode yes",
        "",
      ].join("\n"), { mode: 0o600 });
      await chmod(home, 0o700);
      return await runWithDockerCliEnvironment(engineId, { HOME: home, DOCKER_HOST: `ssh://${engine.username}@${alias}`, DOCKER_CONTEXT: "" }, () => handler(request));
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  };
}
