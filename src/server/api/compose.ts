import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NextResponse } from "next/server";
import { addVesselProjectService, authenticatedUser, getVesselProjectEnvironment, mutationUser, userHasPermission, vesselProjectById, vesselProjectIdForResource } from "@/lib/control-plane";
import { listDockerContainers } from "@/lib/docker/containers";
import { dockerCliEnvironment, currentDockerEngineId } from "@/lib/docker/engine-context";

const root = process.env.VESSEL_COMPOSE_ROOT ?? "/app/data/compose-projects";
const sourceRoot = process.env.VESSEL_COMPOSE_SOURCE_ROOT ?? "/app/compose-host";
const sourceHostRoot = process.env.VESSEL_COMPOSE_SOURCE_HOST_ROOT?.trim();
function validName(value: string) { return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/.test(value); }
const composeSourceLimit = 2_000_000;
function validatedComposePath(value: string): string {
  const file = value.trim();
  if (!isAbsolute(file) || file.length > 4096 || /[\x00-\x1f,]/.test(file) || (!/\.ya?ml$/i.test(file) && basename(file) !== ".env")) throw new Error("La ruta detectada no es un archivo Compose o .env válido");
  return resolve(file);
}
function shellQuote(value: string) { return `'${value.replace(/'/g, "'\\''")}'`; }
function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv, input = ""): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = "";
    let oversized = false;
    let settled = false;
    const finishError = (error: Error) => { if (!settled) { settled = true; clearTimeout(timeout); reject(error); } };
    const timeout = setTimeout(() => { child.kill("SIGTERM"); finishError(new Error("La lectura del archivo Compose superó el tiempo límite")); }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = Buffer.concat([stdout, chunk]);
      if (stdout.length > composeSourceLimit) { oversized = true; child.kill("SIGTERM"); finishError(new Error("El archivo Compose supera el límite de 2 MB")); }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-2000); });
    child.once("error", (error) => finishError(error));
    child.stdin.on("error", () => undefined);
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (oversized) return reject(new Error("El archivo Compose supera el límite de 2 MB"));
      if (code !== 0) return reject(new Error(stderr.trim() || "No se pudo leer el archivo Compose en el host Docker"));
      resolveOutput(stdout.toString("utf8"));
    });
    child.stdin.end(input);
  });
}
async function readComposeFileFromHost(path: string, optional = false): Promise<string> {
  const file = validatedComposePath(path);
  const env = { ...process.env, ...dockerCliEnvironment() };
  if (currentDockerEngineId()) {
    const dockerHost = env.DOCKER_HOST;
    const home = env.HOME;
    if (!dockerHost || !home) throw new Error("No está preparada la sesión SSH del Engine remoto");
    const alias = new URL(dockerHost).hostname;
    const remoteCommand = optional
      ? `if [ -f ${shellQuote(file)} ]; then cat -- ${shellQuote(file)}; else printf '__VESSEL_OPTIONAL_FILE_MISSING__'; fi`
      : `cat -- ${shellQuote(file)}`;
    const result = await runCommand("ssh", ["-F", join(home, ".ssh", "config"), "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", alias, remoteCommand], env);
    return optional && result === "__VESSEL_OPTIONAL_FILE_MISSING__" ? "" : result;
  }
  const vesselName = process.env.VESSEL_CONTAINER_NAME ?? "vessel";
  const containers = await listDockerContainers();
  const vessel = containers.find((container) => (container.Names ?? []).some((name) => name.replace(/^\//, "") === vesselName));
  if (!vessel?.Image) throw new Error("No se encontró la imagen local de Vessel para leer el archivo de forma temporal");
  const mount = `type=bind,source=${dirname(file)},target=/vessel-config,readonly`;
  const targetPath = `/vessel-config/${basename(file)}`;
  const command = optional
    ? `if [ -f ${shellQuote(targetPath)} ]; then cat -- ${shellQuote(targetPath)}; else printf '__VESSEL_OPTIONAL_FILE_MISSING__'; fi`
    : `cat -- ${shellQuote(targetPath)}`;
  const result = await runCommand("docker", ["run", "--pull=never", "--rm", "--network=none", "--memory=32m", "--cpus=0.25", "--read-only", "--user=0:0", "--mount", mount, "--entrypoint", "/bin/sh", vessel.Image, "-c", command], env);
  return optional && result === "__VESSEL_OPTIONAL_FILE_MISSING__" ? "" : result;
}
async function writeComposeFileToHost(path: string, yaml: string): Promise<void> {
  const file = validatedComposePath(path);
  if (yaml.length > composeSourceLimit) throw new Error("El archivo Compose supera el límite de 2 MB");
  const env = { ...process.env, ...dockerCliEnvironment() };
  if (currentDockerEngineId()) {
    const dockerHost = env.DOCKER_HOST;
    const home = env.HOME;
    if (!dockerHost || !home) throw new Error("No está preparada la sesión SSH del Engine remoto");
    const alias = new URL(dockerHost).hostname;
    await runCommand("ssh", ["-F", join(home, ".ssh", "config"), "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", alias, `umask 077; cat > ${shellQuote(file)} && chmod 600 ${shellQuote(file)}`], env, yaml);
    return;
  }
  const vesselName = process.env.VESSEL_CONTAINER_NAME ?? "vessel";
  const containers = await listDockerContainers();
  const vessel = containers.find((container) => (container.Names ?? []).some((name) => name.replace(/^\//, "") === vesselName));
  if (!vessel?.Image) throw new Error("No se encontró la imagen local de Vessel para guardar el archivo de forma temporal");
  const mount = `type=bind,source=${dirname(file)},target=/vessel-config`;
  const target = `/vessel-config/${basename(file)}`;
  await runCommand("docker", ["run", "--pull=never", "--rm", "--network=none", "--memory=32m", "--cpus=0.25", "--read-only", "--user=0:0", "--mount", mount, "--entrypoint", "/bin/sh", vessel.Image, "-c", `umask 077; cat > ${shellQuote(target)} && chmod 600 ${shellQuote(target)}`], env, yaml);
}
function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}
async function runCompose(project: string, args: string[], composeFile = join(/* turbopackIgnore: true */ root, project, "compose.yaml"), projectDirectory = join(/* turbopackIgnore: true */ root, project), maxOutput = 12000, contextProjectId?: string, envFileOverride?: string) {
  let runtimeComposeFile = composeFile;
  let temporaryDirectory: string | null = null;
  let hasEnvFile = false;
  let environment: NodeJS.ProcessEnv = process.env;
  try {
    const source = await readFile(composeFile, "utf8");
    const projectReferences = [...source.matchAll(/\$\{\{project\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map((match) => match[1]);
    const projectId = contextProjectId ?? vesselProjectIdForResource("compose", project);
    if (projectReferences.length && !projectId) return { code: 1, output: "Project environment references require a linked project." };
    const projectEnvironment = projectId ? getVesselProjectEnvironment(projectId) : {};
    environment = { ...process.env, ...projectEnvironment };
    if (projectReferences.length) {
      const transformed = source.replace(/\$\{\{project\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_match, name: string) => {
        if (!Object.hasOwn(projectEnvironment, name)) throw new Error(`Project environment variable ${name} is not configured`);
        return `\${${name}}`;
      });
      temporaryDirectory = await mkdtemp(join(tmpdir(), "vessel-compose-runtime-"));
      runtimeComposeFile = join(temporaryDirectory, "compose.yaml");
      await writeFile(runtimeComposeFile, transformed, "utf8");
    }
    let envFileContent = envFileOverride;
    if (envFileContent === undefined) {
      try { envFileContent = await readFile(join(projectDirectory, ".env"), "utf8"); }
      catch {
        const hostComposeFile = await discoveredComposeHostFile(project);
        if (hostComposeFile && !isVesselManagedComposePath(hostComposeFile) && dirname(validatedComposePath(hostComposeFile)) === resolve(projectDirectory)) {
          envFileContent = await readComposeFileFromHost(join(dirname(validatedComposePath(hostComposeFile)), ".env"), true);
        }
      }
    }
    if (envFileContent !== undefined) {
      if (!temporaryDirectory) temporaryDirectory = await mkdtemp(join(tmpdir(), "vessel-compose-runtime-"));
      await writeFile(join(temporaryDirectory, "project.env"), envFileContent, { encoding: "utf8", mode: 0o600 });
      hasEnvFile = true;
    }
  } catch (error) {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    return { code: 1, output: error instanceof Error ? error.message : "Could not prepare the Compose environment." };
  }
  return new Promise<{ code: number; output: string }>((resolve) => {
    const cleanup = () => temporaryDirectory ? rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined) : Promise.resolve();
    const envFilePath = hasEnvFile && temporaryDirectory ? join(temporaryDirectory, "project.env") : "";
    const envFileArgs = envFilePath ? ["--env-file", envFilePath] : [];
    const child = spawn("docker", ["compose", "-p", project, "--project-directory", projectDirectory, "-f", runtimeComposeFile, ...envFileArgs, ...args], { env: { ...environment, ...dockerCliEnvironment() } });
    let output = "";
    const append = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-maxOutput); };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", async (error) => { output += error.message; await cleanup(); resolve({ code: 1, output }); });
    child.on("close", async (code) => { await cleanup(); resolve({ code: code ?? 1, output: output.slice(-maxOutput) }); });
  });
}
async function saveCompose(name: string, yaml: string) {
  if (!validName(name)) throw new Error("Invalid Compose project name");
  if (!yaml.trim() || yaml.length > 2_000_000) throw new Error("Compose file is empty or too large");
  const directory = join(/* turbopackIgnore: true */ root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "compose.yaml"), yaml, "utf8");
}
async function discoveredComposeHostFile(name: string): Promise<string | null> {
  const containers = await listDockerContainers();
  const container = containers.find((item) => item.Labels?.["com.docker.compose.project"] === name);
  return container?.Labels?.["com.docker.compose.project.config_files"]?.split(",")[0]?.trim() || null;
}
async function discoveredComposeFile(name: string): Promise<string | null> {
  const configured = await discoveredComposeHostFile(name);
  if (!configured) return null;
  const hostPath = validatedComposePath(configured);
  // Some deployments mount the host Compose file at the identical absolute path.
  try { await access(hostPath); return hostPath; } catch { /* map through the configured host source mount below */ }
  // Keep the Engine's original path when there is no configured source mount.
  // The reader below can access it through SSH (remote) or a short-lived,
  // read-only helper container (local).
  if (!sourceHostRoot) return hostPath;
  const relativePath = relative(resolve(sourceHostRoot), hostPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return hostPath;
  return join(/* turbopackIgnore: true */ sourceRoot, relativePath);
}
function isVesselManagedComposePath(path: string): boolean {
  const fromRoot = relative(resolve(/* turbopackIgnore: true */ root), resolve(path));
  return fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot));
}
async function composeProjectDirectory(name: string): Promise<string> {
  const sourceFile = await discoveredComposeHostFile(name);
  if (sourceFile && !isVesselManagedComposePath(sourceFile)) return dirname(validatedComposePath(sourceFile));
  return join(/* turbopackIgnore: true */ root, name);
}
export async function getCompose(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  if (!userHasPermission(user, "compose.view")) return privateJson({ error: "Permission denied" }, { status: 403 });
  const name = new URL(request.url).searchParams.get("name");
  if (!name) {
    try {
      const containers = await listDockerContainers();
      const projects = new Map<string, { name: string; source: string; containers: string[]; configFiles?: string[]; status?: string }>();
      for (const container of containers) {
        const labels = container.Labels ?? {};
        const project = labels["com.docker.compose.project"];
        if (!project) continue;
        const current = projects.get(project) ?? {
          name: project,
          source: "docker-labels",
          containers: [],
        };
        current.containers.push((container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, ""));
        const configFiles = labels["com.docker.compose.project.config_files"]?.split(",").map((file) => file.trim()).filter(Boolean) ?? [];
        if (configFiles.length) current.configFiles = [...new Set([...(current.configFiles ?? []), ...configFiles])];
        current.status = container.State ?? current.status;
        projects.set(project, current);
      }
      return privateJson({ data: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)) });
    } catch {
      return privateJson({ data: [], error: "Docker Compose projects could not be discovered" }, { status: 502 });
    }
  }
  if (!validName(name)) return privateJson({ error: "Invalid project name" }, { status: 400 });
  let hostFile: string | null = null;
  try {
    hostFile = await discoveredComposeHostFile(name);
    if (hostFile && !isVesselManagedComposePath(hostFile)) {
      const file = await discoveredComposeFile(name);
      if (!file) return privateJson({ error: "Docker detectó el proyecto, pero no informó la ruta de su archivo Compose." }, { status: 409 });
      let yaml: string;
      try { yaml = await readFile(/* turbopackIgnore: true */ file, "utf8"); }
      catch { yaml = await readComposeFileFromHost(hostFile); }
      let env: string;
      const hostEnvPath = join(dirname(validatedComposePath(hostFile)), ".env");
      try { env = await readFile(/* turbopackIgnore: true */ hostEnvPath, "utf8"); }
      catch { env = await readComposeFileFromHost(hostEnvPath, true); }
      return privateJson({ name, yaml, env, source: "docker-labels" });
    }
    let env = "";
    try { env = await readFile(join(/* turbopackIgnore: true */ root, name, ".env"), "utf8"); } catch { /* .env is optional */ }
    return privateJson({ name, yaml: await readFile(join(/* turbopackIgnore: true */ root, name, "compose.yaml"), "utf8"), env, source: "vessel" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error de lectura desconocido";
    if ((hostFile && !isVesselManagedComposePath(hostFile)) || /archivo Compose|Compose YAML|lectura del archivo/i.test(message)) {
      return privateJson({ error: `Vessel encontró la ruta Compose en Docker, pero no pudo acceder al archivo: ${message}` }, { status: 409 });
    }
    return privateJson({ error: "Compose project not found" }, { status: 404 });
  }
}

export async function runScheduledComposeProject(name: string, projectId: string, action: "restart" | "start" | "down" | "down_up") {
  if (!validName(name)) throw new Error("Nombre Compose inválido");
  const sourceFile = await discoveredComposeHostFile(name);
  const composeFile = sourceFile ? (await discoveredComposeFile(name)) ?? validatedComposePath(sourceFile) : join(/* turbopackIgnore: true */ root, name, "compose.yaml");
  const directory = sourceFile ? dirname(validatedComposePath(sourceFile)) : join(/* turbopackIgnore: true */ root, name);
  try { await access(composeFile); } catch { throw new Error("No se pudo leer el archivo Compose del proyecto"); }
  if (action === "down_up") {
    const stopped = await runCompose(name, ["down", "--remove-orphans"], composeFile, directory, 12000, projectId);
    if (stopped.code !== 0) throw new Error("Compose down falló; no se ejecutó el up para evitar dejar el estado ambiguo");
    const started = await runCompose(name, ["up", "--detach", "--remove-orphans"], composeFile, directory, 12000, projectId);
    if (started.code !== 0) throw new Error("Compose down se completó, pero Compose up falló");
    return;
  }
  const result = await runCompose(name, [action, ...(action === "down" ? ["--remove-orphans"] : [])], composeFile, directory, 12000, projectId);
  if (result.code !== 0) throw new Error(`Compose ${action} falló`);
}

export async function postCompose(request: Request) {
  const user = mutationUser(request);
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  if (!userHasPermission(user, "compose.manage")) return privateJson({ error: "Permission denied" }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: string; yaml?: string; env?: string; envEdited?: boolean; action?: "preview" | "validate" | "save" | "save_env" | "services" | "up" | "up_service" | "start" | "stop" | "restart" | "logs" | "down"; service?: string; services?: string[]; detach?: boolean; projectId?: string; projectServiceKind?: "compose" | "template" } | null;
  if (!body?.name || !body.yaml || !["preview", "validate", "save", "save_env", "services", "up", "up_service", "start", "stop", "restart", "logs", "down"].includes(body.action ?? "")) return privateJson({ error: "name, yaml and a valid action are required" }, { status: 400 });
  if (body.projectId && (!vesselProjectById(body.projectId) || !["compose", "template"].includes(body.projectServiceKind ?? ""))) return privateJson({ error: "The Vessel project or service type is invalid" }, { status: 400 });
  if (!validName(body.name) || body.yaml.length > 2_000_000) return privateJson({ error: "Invalid Compose project name or file is too large" }, { status: 400 });
  if (body.env !== undefined && (typeof body.env !== "string" || body.env.length > 1_000_000)) return privateJson({ error: "The .env file exceeds the 1 MB limit." }, { status: 400 });
  if (body.action === "up_service" && (!body.service || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(body.service))) {
    return privateJson({ error: "A valid Compose service name is required" }, { status: 400 });
  }
  try {
    const environmentProjectId = body.projectId ?? vesselProjectIdForResource("compose", body.name);
    const sourceDirectory = await composeProjectDirectory(body.name);
    if (body.action === "save_env") {
      if (typeof body.env !== "string" || body.env.length > 1_000_000) return privateJson({ error: "The .env file is invalid or exceeds the 1 MB limit." }, { status: 400 });
      const sourceFile = await discoveredComposeHostFile(body.name);
      if (sourceFile && !isVesselManagedComposePath(sourceFile)) {
        await writeComposeFileToHost(join(dirname(validatedComposePath(sourceFile)), ".env"), body.env);
        return privateJson({ ok: true, action: "save_env", source: "docker-labels" });
      }
      const projectDirectory = join(/* turbopackIgnore: true */ root, body.name);
      await mkdir(projectDirectory, { recursive: true });
      await writeFile(join(projectDirectory, ".env"), body.env, { encoding: "utf8", mode: 0o600 });
      return privateJson({ ok: true, action: "save_env", source: "vessel" });
    }
    if (body.action === "save") {
      const sourceFile = await discoveredComposeHostFile(body.name);
      if (!sourceFile) return privateJson({ error: "No se encontró la ruta original del archivo Compose." }, { status: 404 });
      await writeComposeFileToHost(sourceFile, body.yaml);
      await saveCompose(body.name, body.yaml);
      return privateJson({ ok: true, action: "save", source: "docker-labels" });
    }
    if (body.action === "preview") {
      const previewBase = join(/* turbopackIgnore: true */ root, body.name);
      const managedFile = join(previewBase, "compose.yaml");
      let projectDirectory = sourceDirectory;
      try { await access(managedFile); }
      catch { if (sourceDirectory === join(/* turbopackIgnore: true */ root, body.name)) projectDirectory = previewBase; }
      let createdPreviewBase = false;
      try {
        try { await access(previewBase); } catch { createdPreviewBase = true; }
        await mkdir(previewBase, { recursive: true });
        const previewDirectory = await mkdtemp(join(/* turbopackIgnore: true */ previewBase, ".vessel-preview-"));
        const composeFile = join(previewDirectory, "compose.yaml");
        try {
          await writeFile(composeFile, body.yaml, "utf8");
          const preview = await runCompose(body.name, ["config", "--no-interpolate", "--no-env-resolution"], composeFile, projectDirectory, 2_000_000, environmentProjectId ?? undefined, body.env);
          if (preview.code !== 0) return privateJson({ ok: false, action: "preview", error: "Docker Compose could not convert this configuration.", details: preview.output }, { status: 422 });
          return privateJson({ ok: true, action: "preview", yaml: preview.output });
        } finally {
          await rm(previewDirectory, { recursive: true, force: true });
        }
      } finally {
        // An empty project directory may have been created solely for this preview.
        // Removing an existing/non-empty directory is intentionally avoided.
        if (createdPreviewBase) await rm(previewBase, { recursive: false, force: true }).catch(() => undefined);
      }
    }
    if (body.action === "validate") {
      const projectDirectory = join(/* turbopackIgnore: true */ root, body.name);
      await mkdir(projectDirectory, { recursive: true });
      const validationDirectory = await mkdtemp(join(/* turbopackIgnore: true */ projectDirectory, ".vessel-validate-"));
      const validationFile = join(validationDirectory, "compose.yaml");
      try {
        await writeFile(validationFile, body.yaml, "utf8");
        const result = await runCompose(body.name, ["config", "--quiet"], validationFile, sourceDirectory, 16000, environmentProjectId ?? undefined, body.env);
        return privateJson({ ok: result.code === 0, action: "validate", source: "vessel", ...(result.code === 0 ? {} : { error: "Compose validation failed.", details: result.output }) }, { status: result.code === 0 ? 200 : 422 });
      } finally {
        await rm(validationDirectory, { recursive: true, force: true });
      }
    }
    const projectDirectory = join(/* turbopackIgnore: true */ root, body.name);
    await mkdir(projectDirectory, { recursive: true });
    const validationDirectory = await mkdtemp(join(/* turbopackIgnore: true */ projectDirectory, ".vessel-validate-"));
    let validation: { code: number; output: string };
    try {
      const validationFile = join(validationDirectory, "compose.yaml");
      await writeFile(validationFile, body.yaml, "utf8");
      validation = await runCompose(body.name, ["config", "--quiet"], validationFile, sourceDirectory, 12000, environmentProjectId ?? undefined, body.env);
    } finally {
      await rm(validationDirectory, { recursive: true, force: true });
    }
    if (validation.code !== 0) return privateJson({ ok: false, action: body.action, error: "Compose validation failed. Review the configuration and validate it again.", details: validation.output }, { status: 422 });
    if (body.envEdited && typeof body.env === "string" && ["up", "up_service", "start", "stop", "restart"].includes(body.action ?? "")) {
      if (body.env.length > 1_000_000) return privateJson({ error: "The .env file exceeds the 1 MB limit." }, { status: 400 });
      const sourceFile = await discoveredComposeHostFile(body.name);
      if (sourceFile && !isVesselManagedComposePath(sourceFile)) {
        await writeComposeFileToHost(join(dirname(validatedComposePath(sourceFile)), ".env"), body.env);
      } else {
        const projectDirectory = join(/* turbopackIgnore: true */ root, body.name);
        await mkdir(projectDirectory, { recursive: true });
        await writeFile(join(projectDirectory, ".env"), body.env, { encoding: "utf8", mode: 0o600 });
      }
    }
    let source = "vessel";
    if (["up", "up_service", "start", "stop", "restart", "down"].includes(body.action ?? "")) {
      const sourceFile = await discoveredComposeHostFile(body.name);
      if (sourceFile && !isVesselManagedComposePath(sourceFile)) {
        await writeComposeFileToHost(sourceFile, body.yaml);
        source = "docker-labels";
      }
    }
    if (body.action !== "services") await saveCompose(body.name, body.yaml);
    if (body.action === "services") {
      const dir = await mkdtemp(join(/* turbopackIgnore: true */ root, body.name, ".vessel-services-"));
      try {
        const file = join(dir, "compose.yaml");
        await writeFile(file, body.yaml, "utf8");
        const result = await runCompose(body.name, ["config", "--services"], file, sourceDirectory, 12000, environmentProjectId ?? undefined, body.env);
        if (result.code !== 0) return privateJson({ error: "Compose could not list services", details: result.output }, { status: 422 });
        return privateJson({ ok: true, services: result.output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) });
      } finally { await rm(dir, { recursive: true, force: true }); }
    }
    if (body.action === "up_service") {
      const configuredServices = await runCompose(body.name, ["config", "--services"], undefined, sourceDirectory, 12000, environmentProjectId ?? undefined, body.env);
      if (configuredServices.code !== 0) return privateJson({ error: "Compose could not list services in this project" }, { status: 422 });
      const services = configuredServices.output.split(/\r?\n/).map((service) => service.trim()).filter(Boolean);
      if (!services.includes(body.service!)) return privateJson({ error: `Service ${body.service} was not found in this Compose project` }, { status: 422 });
      const result = await runCompose(body.name, ["up", "-d", "--no-deps", body.service!], undefined, sourceDirectory, 12000, environmentProjectId ?? undefined, body.env);
      return privateJson({ ok: result.code === 0, action: body.action, service: body.service, source, ...(result.code === 0 ? {} : { error: "The Compose service could not be applied. Check the project and Docker Engine state." }) }, { status: result.code === 0 ? 200 : 502 });
    }
    const selected = Array.isArray(body.services) ? [...new Set(body.services)] : [];
    if (selected.length > 100 || selected.some((service) => typeof service !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(service))) return privateJson({ error: "Invalid Compose service selection" }, { status: 400 });
    const configured = await runCompose(body.name, ["config", "--services"], undefined, sourceDirectory, 12000, environmentProjectId ?? undefined, body.env);
    const available = configured.output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (configured.code !== 0 || selected.some((service) => !available.includes(service))) return privateJson({ error: "One or more selected services do not exist in this Compose project" }, { status: 422 });
    if (["start", "stop", "restart", "logs"].includes(body.action ?? "")) {
      const args = [body.action!, ...(body.action === "logs" ? ["--tail", "200", "--no-color"] : []), ...selected];
      const result = await runCompose(body.name, args, undefined, sourceDirectory, 12000, environmentProjectId ?? undefined, body.env);
      return privateJson({ ok: result.code === 0, action: body.action, output: result.output, source }, { status: result.code === 0 ? 200 : 502 });
    }
    const args = body.action === "up"
      ? ["up", ...(body.detach === false ? [] : ["--detach"]), ...(body.detach === false ? [] : ["--remove-orphans"]), "--build", ...selected]
      : ["down", "--remove-orphans"];
    const result = await runCompose(body.name, args, undefined, sourceDirectory, 12000, environmentProjectId ?? undefined, body.env);
    if (result.code === 0 && body.action === "up" && body.projectId) {
      addVesselProjectService({ projectId: body.projectId, kind: body.projectServiceKind ?? "compose", name: body.name, description: "Docker Compose", targetType: "compose", targetRef: body.name });
    }
    return privateJson({ ok: result.code === 0, action: body.action, source, ...(result.code === 0 ? {} : { error: "The Compose operation failed. Check the project and Docker Engine state." }) }, { status: result.code === 0 ? 200 : 502 });
  } catch {
    return privateJson({ error: "Compose operation failed. Check the project and Docker Engine state." }, { status: 400 });
  }
}
