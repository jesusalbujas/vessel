import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { isAbsolute, join, relative, resolve } from "node:path";
import { NextResponse } from "next/server";
import { authenticatedUser, mutationUser } from "@/lib/control-plane";
import { listDockerContainers } from "@/lib/docker";

const root = process.env.VESSEL_COMPOSE_ROOT ?? "/app/data/compose-projects";
const sourceRoot = process.env.VESSEL_COMPOSE_SOURCE_ROOT ?? "/app/compose-host";
const sourceHostRoot = process.env.VESSEL_COMPOSE_SOURCE_HOST_ROOT?.trim();
function validName(value: string) { return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{1,63}$/.test(value); }
async function runCompose(project: string, args: string[]) {
  return new Promise<{ code: number; output: string }>((resolve) => {
    const child = spawn("docker", ["compose", "-p", project, "-f", join(/* turbopackIgnore: true */ root, project, "compose.yaml"), ...args], { env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", (error) => { output += error.message; resolve({ code: 1, output }); });
    child.on("close", (code) => resolve({ code: code ?? 1, output: output.slice(-12000) }));
  });
}
async function saveCompose(name: string, yaml: string) {
  if (!validName(name)) throw new Error("Invalid Compose project name");
  if (!yaml.trim() || yaml.length > 2_000_000) throw new Error("Compose file is empty or too large");
  const directory = join(/* turbopackIgnore: true */ root, name);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "compose.yaml"), yaml, "utf8");
}
async function discoveredComposeFile(name: string): Promise<string | null> {
  if (!sourceHostRoot) return null;
  const containers = await listDockerContainers();
  const container = containers.find((item) => item.Labels?.["com.docker.compose.project"] === name);
  const configured = container?.Labels?.["com.docker.compose.project.config_files"]?.split(",")[0]?.trim();
  if (!configured) return null;
  const relativePath = relative(resolve(sourceHostRoot), resolve(configured));
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return join(sourceRoot, relativePath);
}
export async function getCompose(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const name = new URL(request.url).searchParams.get("name");
  if (!name) {
    try {
      const containers = await listDockerContainers();
      const projects = new Map<string, { name: string; source: string; workingDir: string | null; configFiles: string[]; containers: string[] }>();
      for (const container of containers) {
        const labels = container.Labels ?? {};
        const project = labels["com.docker.compose.project"];
        if (!project) continue;
        const current = projects.get(project) ?? {
          name: project,
          source: "docker-labels",
          workingDir: labels["com.docker.compose.project.working_dir"] ?? null,
          configFiles: (labels["com.docker.compose.project.config_files"] ?? "").split(",").map((item) => item.trim()).filter(Boolean),
          containers: [],
        };
        current.containers.push((container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, ""));
        projects.set(project, current);
      }
      return NextResponse.json({ data: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)) });
    } catch {
      return NextResponse.json({ data: [], error: "Docker Compose projects could not be discovered" }, { status: 502 });
    }
  }
  if (!validName(name)) return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  try { return NextResponse.json({ name, yaml: await readFile(join(/* turbopackIgnore: true */ root, name, "compose.yaml"), "utf8"), source: "vessel" }); }
  catch {
    try {
      const file = await discoveredComposeFile(name);
      if (!file) return NextResponse.json({ error: "Compose source path is not mounted in Vessel" }, { status: 409 });
      return NextResponse.json({ name, yaml: await readFile(file, "utf8"), source: "docker-labels" });
    } catch { return NextResponse.json({ error: "Compose project not found" }, { status: 404 }); }
  }
}
export async function postCompose(request: Request) {
  if (!mutationUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: string; yaml?: string; action?: "validate" | "up" | "down" } | null;
  if (!body?.name || !body.yaml || !["validate", "up", "down"].includes(body.action ?? "")) return NextResponse.json({ error: "name, yaml and a valid action are required" }, { status: 400 });
  try { await saveCompose(body.name, body.yaml); const validation = await runCompose(body.name, ["config"]); if (validation.code !== 0) return NextResponse.json({ ok: false, action: "validate", output: validation.output }, { status: 422 }); if (body.action === "validate") return NextResponse.json({ ok: true, action: "validate", output: validation.output }); const result = await runCompose(body.name, [body.action === "up" ? "up" : "down", ...(body.action === "up" ? ["-d", "--remove-orphans"] : ["--remove-orphans"])]); return NextResponse.json({ ok: result.code === 0, action: body.action, output: result.output }, { status: result.code === 0 ? 200 : 502 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Compose operation failed" }, { status: 400 }); }
}
