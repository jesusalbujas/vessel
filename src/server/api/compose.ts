import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { NextResponse } from "next/server";
import { addVesselProjectService, authenticatedUser, getVesselProjectEnvironment, mutationUser, vesselProjectById, vesselProjectIdForResource } from "@/lib/control-plane";
import { listDockerContainers } from "@/lib/docker/containers";

const root = process.env.VESSEL_COMPOSE_ROOT ?? "/app/data/compose-projects";
const sourceRoot = process.env.VESSEL_COMPOSE_SOURCE_ROOT ?? "/app/compose-host";
const sourceHostRoot = process.env.VESSEL_COMPOSE_SOURCE_HOST_ROOT?.trim();
function validName(value: string) { return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/.test(value); }
function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}
async function runCompose(project: string, args: string[], composeFile = join(/* turbopackIgnore: true */ root, project, "compose.yaml"), projectDirectory = join(/* turbopackIgnore: true */ root, project), maxOutput = 12000, contextProjectId?: string) {
  let runtimeComposeFile = composeFile;
  let temporaryDirectory: string | null = null;
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
  } catch (error) {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    return { code: 1, output: error instanceof Error ? error.message : "Could not prepare the Compose environment." };
  }
  return new Promise<{ code: number; output: string }>((resolve) => {
    const cleanup = () => temporaryDirectory ? rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined) : Promise.resolve();
    const child = spawn("docker", ["compose", "-p", project, "--project-directory", projectDirectory, "-f", runtimeComposeFile, ...args], { env: environment });
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
type ComposeCliProject = { Name?: string; Status?: string; ConfigFiles?: string };
async function listComposeProjects(): Promise<ComposeCliProject[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "ls", "--all", "--format", "json"]);
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 10000);
    child.stdout.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-2_000_000); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-16000); });
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return reject(new Error(stderr || "docker compose ls failed"));
      try { resolve(JSON.parse(stdout || "[]") as ComposeCliProject[]); }
      catch { reject(new Error("docker compose ls returned invalid JSON")); }
    });
  });
}
async function discoveredComposeFile(name: string): Promise<string | null> {
  let configured: string | undefined;
  try {
    const project = (await listComposeProjects()).find((item) => item.Name === name);
    configured = project?.ConfigFiles?.split(",")[0]?.trim();
  } catch {
    // Fall back to Docker labels if Compose CLI discovery is unavailable.
  }
  if (!configured) {
  const containers = await listDockerContainers();
  const container = containers.find((item) => item.Labels?.["com.docker.compose.project"] === name);
  configured = container?.Labels?.["com.docker.compose.project.config_files"]?.split(",")[0]?.trim();
  }
  if (!configured) return null;
  // Some deployments mount the host Compose file at the identical absolute path.
  try { await access(configured); return configured; } catch { /* map through the configured host source mount below */ }
  if (!sourceHostRoot) return null;
  const relativePath = relative(resolve(sourceHostRoot), resolve(configured));
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return join(/* turbopackIgnore: true */ sourceRoot, relativePath);
}
export async function getCompose(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
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
        projects.set(project, current);
      }
      try {
        for (const composeProject of await listComposeProjects()) {
          const projectName = composeProject.Name?.trim();
          if (!projectName) continue;
          const current = projects.get(projectName) ?? { name: projectName, source: "docker-compose-cli", containers: [] };
          current.configFiles = composeProject.ConfigFiles?.split(",").map((file) => file.trim()).filter(Boolean) ?? [];
          current.status = composeProject.Status;
          projects.set(projectName, current);
        }
      } catch {
        // Docker labels still provide a useful inventory if CLI discovery fails.
      }
      return privateJson({ data: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)) });
    } catch {
      return privateJson({ data: [], error: "Docker Compose projects could not be discovered" }, { status: 502 });
    }
  }
  if (user.role !== "administrator") return privateJson({ error: "Administrator access required to read Compose configuration" }, { status: 403 });
  if (!validName(name)) return privateJson({ error: "Invalid project name" }, { status: 400 });
  try { return privateJson({ name, yaml: await readFile(join(/* turbopackIgnore: true */ root, name, "compose.yaml"), "utf8"), source: "vessel" }); }
  catch {
    try {
      const file = await discoveredComposeFile(name);
      if (!file) return privateJson({ error: "Compose source is not mounted in Vessel" }, { status: 409 });
      return privateJson({ name, yaml: await readFile(/* turbopackIgnore: true */ file, "utf8"), source: "docker-labels" });
    } catch { return privateJson({ error: "Compose project not found" }, { status: 404 }); }
  }
}
export async function postCompose(request: Request) {
  const user = mutationUser(request);
  if (!user) return privateJson({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "administrator") return privateJson({ error: "Administrator access required to manage Compose projects" }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: string; yaml?: string; action?: "preview" | "validate" | "up" | "up_service" | "down"; service?: string; projectId?: string; projectServiceKind?: "compose" | "template" } | null;
  if (!body?.name || !body.yaml || !["preview", "validate", "up", "up_service", "down"].includes(body.action ?? "")) return privateJson({ error: "name, yaml and a valid action are required" }, { status: 400 });
  if (body.projectId && (!vesselProjectById(body.projectId) || !["compose", "template"].includes(body.projectServiceKind ?? ""))) return privateJson({ error: "The Vessel project or service type is invalid" }, { status: 400 });
  if (!validName(body.name) || body.yaml.length > 2_000_000) return privateJson({ error: "Invalid Compose project name or file is too large" }, { status: 400 });
  if (body.action === "up_service" && (!body.service || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(body.service))) {
    return privateJson({ error: "A valid Compose service name is required" }, { status: 400 });
  }
  try {
    const environmentProjectId = body.projectId ?? vesselProjectIdForResource("compose", body.name);
    if (body.action === "preview") {
      const previewBase = join(/* turbopackIgnore: true */ root, body.name);
      const managedFile = join(previewBase, "compose.yaml");
      let projectDirectory = previewBase;
      try { await access(managedFile); }
      catch {
        const sourceFile = await discoveredComposeFile(body.name);
        if (sourceFile) projectDirectory = dirname(sourceFile);
      }
      let createdPreviewBase = false;
      try {
        try { await access(previewBase); } catch { createdPreviewBase = true; }
        await mkdir(previewBase, { recursive: true });
        const previewDirectory = await mkdtemp(join(/* turbopackIgnore: true */ previewBase, ".vessel-preview-"));
        const composeFile = join(previewDirectory, "compose.yaml");
        try {
          await writeFile(composeFile, body.yaml, "utf8");
          const preview = await runCompose(body.name, ["config", "--no-interpolate", "--no-env-resolution"], composeFile, projectDirectory, 2_000_000, environmentProjectId ?? undefined);
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
        const result = await runCompose(body.name, ["config", "--quiet"], validationFile, projectDirectory, 16000, environmentProjectId ?? undefined);
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
      validation = await runCompose(body.name, ["config", "--quiet"], validationFile, projectDirectory, 12000, environmentProjectId ?? undefined);
    } finally {
      await rm(validationDirectory, { recursive: true, force: true });
    }
    if (validation.code !== 0) return privateJson({ ok: false, action: body.action, error: "Compose validation failed. Review the configuration and validate it again.", details: validation.output }, { status: 422 });
    await saveCompose(body.name, body.yaml);
    if (body.action === "up_service") {
      const configuredServices = await runCompose(body.name, ["config", "--services"], undefined, undefined, 12000, environmentProjectId ?? undefined);
      if (configuredServices.code !== 0) return privateJson({ error: "Compose could not list services in this project" }, { status: 422 });
      const services = configuredServices.output.split(/\r?\n/).map((service) => service.trim()).filter(Boolean);
      if (!services.includes(body.service!)) return privateJson({ error: `Service ${body.service} was not found in this Compose project` }, { status: 422 });
      const result = await runCompose(body.name, ["up", "-d", "--no-deps", body.service!], undefined, undefined, 12000, environmentProjectId ?? undefined);
      return privateJson({ ok: result.code === 0, action: body.action, service: body.service, source: "vessel", ...(result.code === 0 ? {} : { error: "The Compose service could not be applied. Check the project and Docker Engine state." }) }, { status: result.code === 0 ? 200 : 502 });
    }
    const result = await runCompose(body.name, [body.action === "up" ? "up" : "down", ...(body.action === "up" ? ["-d", "--remove-orphans"] : ["--remove-orphans"])], undefined, undefined, 12000, environmentProjectId ?? undefined);
    if (result.code === 0 && body.action === "up" && body.projectId) {
      addVesselProjectService({ projectId: body.projectId, kind: body.projectServiceKind ?? "compose", name: body.name, description: "Docker Compose", targetType: "compose", targetRef: body.name });
    }
    return privateJson({ ok: result.code === 0, action: body.action, source: "vessel", ...(result.code === 0 ? {} : { error: "The Compose operation failed. Check the project and Docker Engine state." }) }, { status: result.code === 0 ? 200 : 502 });
  } catch {
    return privateJson({ error: "Compose operation failed. Check the project and Docker Engine state." }, { status: 400 });
  }
}
