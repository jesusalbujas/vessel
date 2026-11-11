import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  appendGitDeploymentLog,
  cancelGitDeploymentRecord,
  createGitDeployment,
  getGitDeployment,
  claimGitSourceEventRef,
  gitSourceRuntimeData,
  gitSourceEventBaselineExists,
  initializeGitSourceEventBaseline,
  listPendingGitSourceEventRefs,
  listGitSourceEventRefs,
  listGitSources,
  recordGitWebhookDelivery,
  recoverInterruptedGitDeployments,
  secretStorageReady,
  updateGitDeployment,
  updateGitSourceEventRef,
  gitSourceHasDeferredProjectSchedule,
  updateGitSourceState,
} from "@/lib/control-plane";
import { gitProviderAccessToken, recentGitReleaseTags } from "@/lib/git-provider-clients";
import { portConflict, missingPublishedPort, type ContainerNetwork, type PublishedPort } from "@/lib/compose-network";
import { dockerCliEnvironment } from "@/lib/docker/engine-context";

const checkoutRoot = resolve(/* turbopackIgnore: true */ process.env.VESSEL_GIT_ROOT ?? "/app/data/git-sources");
const activeDeployments = new Set<string>();
const activeSourceChecks = new Set<string>();
type GitDeploymentTarget = { ref: string; commit?: string; eventType?: "push" | "tag" | "release"; refName?: string };
export type GitDeploymentOperation = "deploy" | "rebuild" | "fresh_volumes" | "start" | "stop" | "restart" | "logs" | "down" | "down_up";
export type GitDeploymentOptions = { services?: string[]; detach?: boolean };
const queuedDeployments = new Map<string, Array<{ trigger: "manual" | "automatic"; target?: GitDeploymentTarget; deploymentId: string }>>();
const activeBuildProcesses = new Map<string, ChildProcess>();
const activeDeploymentIds = new Map<string, string>();
const cancelledDeployments = new Set<string>();
const pollIntervalMs = 5_000;

type CommandResult = { code: number; stdout: string; stderr: string };

const inheritedEnvironmentKeys = [
  "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TZ",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG",
  "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "DOCKER_API_VERSION",
];

function safeCommandEnvironment(): NodeJS.ProcessEnv {
  const contextual = dockerCliEnvironment();
  return Object.fromEntries(inheritedEnvironmentKeys.flatMap((key) => contextual[key] !== undefined ? [[key, contextual[key]]] : process.env[key] === undefined ? [] : [[key, process.env[key]]])) as NodeJS.ProcessEnv;
}

function gitEnvironment(token: string | null, username = "x-access-token"): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...safeCommandEnvironment(),
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "Never",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "0",
  };
  for (const key of Object.keys(env)) if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete env[key];
  if (token) {
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "http.extraheader";
    env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
  }
  return env;
}

function run(program: string, args: string[], cwd: string | undefined, env: NodeJS.ProcessEnv, timeoutMs = 60_000, onOutput?: (chunk: string) => void, onSpawn?: (child: ChildProcess) => void): Promise<CommandResult> {
  return new Promise((resolveResult) => {
    const child = spawn(program, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    onSpawn?.(child);
    let stdout = "";
    let stderr = "";
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      if (target === "stdout") stdout = (stdout + chunk.toString()).slice(-128_000);
      else stderr = (stderr + chunk.toString()).slice(-128_000);
    };
    child.stdout.on("data", (chunk: Buffer) => { append("stdout", chunk); onOutput?.(chunk.toString()); });
    child.stderr.on("data", (chunk: Buffer) => { append("stderr", chunk); onOutput?.(chunk.toString()); });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveResult({ code: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({ code: code ?? 1, stdout, stderr });
    });
  });
}

function safeProjectName(value: string) {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
  return cleaned.length >= 2 ? cleaned : `vessel-${cleaned || "app"}`;
}

async function composeFilePath(repositoryDirectory: string, composePath: string) {
  if (isAbsolute(composePath) || composePath.split(/[\\/]/).some((part) => part === "..")) throw new Error("Compose path must be relative to the repository");
  let root: string;
  let file: string;
  try {
    root = await realpath(repositoryDirectory);
    file = await realpath(resolve(root, composePath));
  } catch {
    throw new Error("No se encontró el archivo Compose indicado");
  }
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !/\.(ya?ml)$/i.test(file)) throw new Error("Compose path is invalid");
  return file;
}

function dotenvValue(value: string) {
  // Compose interpolates double-quoted env-file values; doubling dollar signs
  // keeps the secret literal instead of expanding a coincidental ${NAME}.
  return JSON.stringify(value).replace(/\$/g, () => "$$");
}

async function createTemporaryEnv(secrets: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "vessel-compose-env-"));
  const path = join(directory, "runtime.env");
  const content = Object.entries(secrets).map(([key, value]) => `${key}=${dotenvValue(value)}`).join("\n");
  await writeFile(path, content ? `${content}\n` : "", { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { directory, path };
}

async function currentRemoteCommit(repository: string, branch: string, token: string | null, username: string) {
  const result = await run("git", ["ls-remote", "--heads", repository, `refs/heads/${branch}`], undefined, gitEnvironment(token, username));
  if (result.code !== 0) {
    if (/spawn git ENOENT/i.test(result.stderr)) throw new Error("Git no está instalado en el contenedor de Vessel");
    throw new Error("El proveedor Git no respondió o Vessel no tiene permiso de lectura del repositorio");
  }
  const sha = result.stdout.trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{40,64}$/i.test(sha ?? "")) throw new Error("No se encontró la rama configurada en el proveedor Git");
  return sha;
}

async function currentRemoteTags(repository: string, token: string | null, username: string) {
  const result = await run("git", ["ls-remote", "--tags", repository], undefined, gitEnvironment(token, username));
  if (result.code !== 0) throw new Error("No se pudieron consultar los tags del repositorio");
  const tags = new Map<string, string>();
  for (const line of result.stdout.split("\n").filter(Boolean)) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!ref?.startsWith("refs/tags/")) continue;
    const peeled = ref.endsWith("^{}");
    const name = ref.slice("refs/tags/".length).replace(/\^\{\}$/, "");
    if (!name) continue;
    if (peeled || !tags.has(name)) tags.set(name, sha);
  }
  return [...tags].map(([name, commit]) => ({ name, commit }));
}

async function currentRemoteRefCommit(repository: string, ref: string, token: string | null, username: string) {
  const peeledRef = ref + "^{}";
  const result = await run("git", ["ls-remote", repository, ref, peeledRef], undefined, gitEnvironment(token, username));
  if (result.code !== 0) throw new Error("El proveedor Git no respondió o Vessel no tiene permiso de lectura del repositorio");
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const peeled = lines.find((line) => line.trim().split(/\s+/)[1] === peeledRef);
  const sha = (peeled ?? lines[0] ?? "").trim().split(/\s+/)[0];
  if (!/^[a-f0-9]{40,64}$/i.test(sha)) throw new Error("No se encontró el tag indicado en el proveedor Git");
  return sha;
}

async function ensureCheckoutAtRef(sourceId: string, repository: string, ref: string, commit: string, token: string | null, username: string, enableSubmodules = false) {
  await mkdir(checkoutRoot, { recursive: true, mode: 0o700 });
  const repositoryDirectory = join(checkoutRoot, sourceId, "repository");
  const gitEnv = gitEnvironment(token, username);
  let checkoutExists = true;
  try { await access(join(repositoryDirectory, ".git")); } catch { checkoutExists = false; }
  if (!checkoutExists) {
    await mkdir(dirname(repositoryDirectory), { recursive: true, mode: 0o700 });
    const cloned = await run("git", ["clone", "--quiet", "--no-checkout", repository, repositoryDirectory], undefined, gitEnv, 10 * 60_000);
    if (cloned.code !== 0) throw new Error("No se pudo clonar el repositorio para desplegar la revisión recibida");
  }
  const remote = await run("git", ["remote", "get-url", "origin"], repositoryDirectory, gitEnv);
  const normalize = (value: string) => value.trim().replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
  if (remote.code !== 0 || normalize(remote.stdout) !== normalize(repository)) throw new Error("La URL del repositorio cambió; no se puede reutilizar el checkout administrado por Vessel");
  const fetched = await run("git", ["fetch", "--quiet", "origin", ref], repositoryDirectory, gitEnv, 5 * 60_000);
  if (fetched.code !== 0) throw new Error("No se pudo descargar el tag recibido por el webhook");
  const checkedOut = await run("git", ["checkout", "--quiet", "--detach", commit], repositoryDirectory, gitEnv);
  if (checkedOut.code !== 0) throw new Error("No se pudo seleccionar el commit del evento Git");
  if (enableSubmodules) {
    const submodules = await run("git", ["submodule", "update", "--init", "--recursive"], repositoryDirectory, gitEnv, 10 * 60_000);
    if (submodules.code !== 0) throw new Error("No se pudieron inicializar los submódulos Git");
  }
  return repositoryDirectory;
}

async function ensureCheckout(sourceId: string, repository: string, branch: string, token: string | null, username: string, enableSubmodules = false) {
  await mkdir(checkoutRoot, { recursive: true, mode: 0o700 });
  const repositoryDirectory = join(checkoutRoot, sourceId, "repository");
  const gitEnv = gitEnvironment(token, username);
  let checkoutExists = true;
  try { await access(join(repositoryDirectory, ".git")); } catch { checkoutExists = false; }
  if (checkoutExists) {
    const remote = await run("git", ["remote", "get-url", "origin"], repositoryDirectory, gitEnv);
    const normalize = (value: string) => value.trim().replace(/\.git$/i, "").replace(/\/$/, "").toLowerCase();
    if (remote.code !== 0 || normalize(remote.stdout) !== normalize(repository)) throw new Error("La URL del repositorio cambió; elimina esta fuente y créala de nuevo para evitar mezclar checkouts");
    const fetched = await run("git", ["fetch", "--quiet", "--prune", "origin", branch], repositoryDirectory, gitEnv, 5 * 60_000);
    if (fetched.code !== 0) throw new Error("No se pudo actualizar el checkout del repositorio");
    const localBranch = await run("git", ["show-ref", "--verify", `refs/heads/${branch}`], repositoryDirectory, gitEnv);
    const checkedOut = await run("git", localBranch.code === 0 ? ["checkout", "--quiet", branch] : ["checkout", "--quiet", "-b", branch, "FETCH_HEAD"], repositoryDirectory, gitEnv);
    if (checkedOut.code !== 0) throw new Error("No se pudo seleccionar la rama configurada; revisa el checkout administrado por Vessel");
    const fastForward = await run("git", ["merge", "--ff-only", "FETCH_HEAD"], repositoryDirectory, gitEnv);
    if (fastForward.code !== 0) throw new Error("La rama no avanzó de forma lineal; se requiere revisar manualmente el checkout");
    if (enableSubmodules) {
      const submodules = await run("git", ["submodule", "update", "--init", "--recursive"], repositoryDirectory, gitEnv, 10 * 60_000);
      if (submodules.code !== 0) throw new Error("No se pudieron inicializar los submódulos Git");
    }
  } else {
    const cloneArgs = ["clone", "--quiet", "--single-branch", "--branch", branch];
    if (enableSubmodules) cloneArgs.push("--recurse-submodules");
    cloneArgs.push(repository, repositoryDirectory);
    const result = await run("git", cloneArgs, undefined, gitEnv, 10 * 60_000);
    if (result.code !== 0) throw new Error("No se pudo clonar el repositorio. Verifica URL, rama y permisos de lectura.");
  }
  return repositoryDirectory;
}

async function credentialsFor(runtime: NonNullable<ReturnType<typeof gitSourceRuntimeData>>) {
  if (runtime.source.providerId) {
    const credentials = await gitProviderAccessToken(runtime.source.providerId);
    return { token: credentials.token, username: credentials.gitUsername };
  }
  return { token: runtime.accessToken, username: "x-access-token" };
}

export async function listGitComposeServices(id: string): Promise<string[]> {
  const runtime = gitSourceRuntimeData(id);
  if (!runtime) throw new Error("Git source not found");
  const credentials = await credentialsFor(runtime);
  const checkout = await ensureCheckout(id, runtime.source.repository, runtime.source.branch, credentials.token, credentials.username, runtime.source.enableSubmodules);
  const file = await composeFilePath(checkout, runtime.source.composePath);
  const env = await createTemporaryEnv(runtime.secrets);
  try {
    const project = safeProjectName(runtime.source.name);
    const result = await run("docker", ["compose", "--project-name", project, "--env-file", env.path, "--file", file, "config", "--services"], checkout, safeCommandEnvironment());
    if (result.code !== 0) throw new Error("No se pudieron cargar los servicios del Compose configurado");
    return [...new Set(result.stdout.split(/\r?\n/).map((service) => service.trim()).filter((service) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(service)))];
  } finally { await rm(env.directory, { recursive: true, force: true }); }
}

function redactDeploymentOutput(output: string, secrets: Record<string, string>) {
  let redacted = output;
  for (const secret of Object.values(secrets)) {
    if (secret.length >= 4) redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

async function runCompose(repositoryDirectory: string, composeFile: string, projectName: string, envFile: string, args: string[], deploymentId: string, secrets: Record<string, string>, sourceId: string) {
  const composeName = composeFile.split(/[\\/]/).pop() ?? "compose.yml";
  appendGitDeploymentLog(deploymentId, `\n$ docker compose --project-name ${projectName} --file ${composeName} ${args.join(" ")}\n`);
  const secretValues = Object.values(secrets).filter((secret) => secret.length >= 4);
  let heldOutput = "";
  const persistOutput = (chunk: string, flush = false) => {
    let combined = heldOutput + chunk;
    for (const secret of secretValues) combined = combined.split(secret).join("[REDACTED]");
    const holdLength = flush ? 0 : Math.min(Math.max(0, ...secretValues.map((secret) => secret.length - 1)), combined.length);
    const output = combined.slice(0, combined.length - holdLength);
    heldOutput = combined.slice(combined.length - holdLength);
    if (output) appendGitDeploymentLog(deploymentId, output);
  };
  let buildProcess: ChildProcess | null = null;
  const result = await run("docker", [
    "compose", "--project-name", projectName, "--env-file", envFile,
    "--file", composeFile, ...args,
  ], repositoryDirectory, safeCommandEnvironment(), 20 * 60_000, (chunk) => persistOutput(chunk), args.includes("--build") ? (child) => { buildProcess = child; activeBuildProcesses.set(sourceId, child); } : undefined);
  if (buildProcess && activeBuildProcesses.get(sourceId) === buildProcess) activeBuildProcesses.delete(sourceId);
  persistOutput("", true);
  if (result.code !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (output.includes("is not valid yaml") || output.includes("yaml: ")) throw new Error("El archivo Compose no es YAML válido");
    if (output.includes("no such file") && output.includes("compose")) throw new Error("No se encontró el archivo Compose indicado");
    if (output.includes("permission denied") || output.includes("denied")) throw new Error("Docker denegó la operación. Verifica permisos, imágenes y configuración del Engine.");
    throw new Error("Falló la validación o el despliegue Compose. Revisa los logs de Docker y la configuración del proyecto.");
  }
}

async function readContainerNetworks(project?: string): Promise<ContainerNetwork[]> {
  const args = ["ps", "-q", ...(project ? ["-a", "--filter", `label=com.docker.compose.project=${project}`] : [])];
  const ids = await run("docker", args, undefined, safeCommandEnvironment());
  if (ids.code !== 0) throw new Error("Could not inspect Docker port assignments.");
  const containers: ContainerNetwork[] = [];
  const format = '{"name":{{json .Name}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}},"bindings":{{json .HostConfig.PortBindings}},"ports":{{json .NetworkSettings.Ports}}}';
  for (const id of ids.stdout.trim().split(/\s+/).filter(Boolean)) {
    const inspected = await run("docker", ["inspect", "--format", format, id], undefined, safeCommandEnvironment());
    if (inspected.code !== 0) throw new Error("Could not inspect Docker port assignments.");
    containers.push(JSON.parse(inspected.stdout));
  }
  return containers;
}

export function startGitDeployment(id: string, trigger: "manual" | "automatic" = "manual", target?: GitDeploymentTarget, queuedDeploymentId?: string, operation: GitDeploymentOperation = "deploy", options: GitDeploymentOptions = {}) {
  if (activeDeployments.has(id)) throw new Error("Ya hay un despliegue en curso para esta fuente");
  const runtime = gitSourceRuntimeData(id);
  if (!runtime) throw new Error("Fuente Git no encontrada");
  if (Object.keys(runtime.secrets).length && !secretStorageReady()) throw new Error("La clave de cifrado de Vessel no está configurada; no se puede desplegar con secretos");
  const deployment = queuedDeploymentId ? getGitDeployment(queuedDeploymentId) : createGitDeployment({ source: runtime.source, trigger });
  if (!deployment) throw new Error("No se encontró el despliegue en cola");
  activeDeployments.add(id);
  activeDeploymentIds.set(id, deployment.id);
  updateGitSourceState(id, { lastStatus: "deploying", lastError: null });
  appendGitDeploymentLog(deployment.id, `Deployment queued (${trigger}).\nRepository: ${runtime.source.repository}\n${target ? `Git ref: ${target.ref}` : `Branch: ${runtime.source.branch}`}\n`);
  void performGitDeployment(id, deployment.id, runtime, target, operation, options).catch(() => undefined).finally(() => {
    activeDeployments.delete(id);
    activeBuildProcesses.delete(id);
    activeDeploymentIds.delete(id);
    const next = queuedDeployments.get(id)?.shift();
    if (next) {
      if (!queuedDeployments.get(id)?.length) queuedDeployments.delete(id);
      try { startGitDeployment(id, next.trigger, next.target, next.deploymentId); } catch { /* Pending event references are recovered by the source poller. */ }
    }
  });
  return deployment;
}

export function scheduleGitDeployment(id: string, trigger: "manual" | "automatic" = "manual", target?: GitDeploymentTarget) {
  if (trigger === "automatic" && gitSourceHasDeferredProjectSchedule(id)) return;
  if (!activeDeployments.has(id)) { startGitDeployment(id, trigger, target); return; }
  const queue = queuedDeployments.get(id) ?? [];
  const key = target?.eventType && target.refName ? `${target.eventType}:${target.refName}` : target?.commit ?? target?.ref ?? "branch";
  if (!queue.some((item) => (item.target?.eventType && item.target.refName ? `${item.target.eventType}:${item.target.refName}` : item.target?.commit ?? item.target?.ref ?? "branch") === key)) {
    const runtime = gitSourceRuntimeData(id);
    if (!runtime) return;
    const deployment = createGitDeployment({ source: runtime.source, trigger });
    appendGitDeploymentLog(deployment.id, `Deployment queued (${trigger}).\nRepository: ${runtime.source.repository}\n${target ? `Git ref: ${target.ref}` : `Branch: ${runtime.source.branch}`}\n`);
    queue.push({ trigger, target, deploymentId: deployment.id });
    queuedDeployments.set(id, queue);
  }
}

export function cancelQueuedGitDeployments(id: string) {
  const queue = queuedDeployments.get(id) ?? [];
  let cancelled = 0;
  for (const entry of queue) {
    if (cancelGitDeploymentRecord(entry.deploymentId)) cancelled++;
    if (entry.target?.eventType && entry.target.refName) updateGitSourceEventRef(id, entry.target.eventType, entry.target.refName, "failed", entry.target.commit);
  }
  queuedDeployments.delete(id);
  return cancelled;
}

export function killGitBuild(id: string) {
  const child = activeBuildProcesses.get(id);
  const deploymentId = activeDeploymentIds.get(id);
  if (!child || !deploymentId) return false;
  cancelledDeployments.add(deploymentId);
  try {
    const killed = child.kill("SIGTERM");
    if (!killed) cancelledDeployments.delete(deploymentId);
    return killed;
  }
  catch { cancelledDeployments.delete(deploymentId); return false; }
}

function repositoryKey(value: unknown) {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return `${url.hostname.toLowerCase()}/${url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").toLowerCase()}`;
  } catch { return value.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "").toLowerCase(); }
}

export function dispatchGitWebhook(providerId: string, deliveryId: string, event: string, payload: Record<string, unknown>) {
  if (!recordGitWebhookDelivery(providerId, deliveryId)) return { accepted: true, duplicate: true, queued: 0 };
  const repository = payload.repository as { html_url?: unknown; web_url?: unknown; clone_url?: unknown; full_name?: unknown; links?: { html?: { href?: unknown } } } | undefined;
  const identity = repositoryKey(repository?.html_url ?? repository?.web_url ?? repository?.links?.html?.href ?? repository?.clone_url ?? repository?.full_name);
  if (!identity) return { accepted: true, ignored: "repository_missing", queued: 0 };
  const candidates = listGitSources().filter((source) => source.providerId === providerId && source.autoDeploy && repositoryKey(source.repository) === identity);
  const queued: string[] = [];
  for (const source of candidates) {
    if (event === "push") {
      const ref = typeof payload.ref === "string" ? payload.ref : "";
      const commit = typeof payload.after === "string" ? payload.after : "";
      if (source.triggerType === "push" && ref === `refs/heads/${source.branch}` && /^[a-f0-9]{40,64}$/i.test(commit)) {
        const files = Array.isArray(payload.changedFiles) ? payload.changedFiles.filter((file): file is string => typeof file === "string") : [];
        if (source.watchPaths.length && files.length && !files.some((file) => source.watchPaths.some((pattern) => matchesWatchPath(file, pattern)))) continue;
        const eventRef = `branch:${source.branch}:${commit}`;
        if (!claimGitSourceEventRef(source.id, "push", eventRef, commit)) continue;
        scheduleGitDeployment(source.id, "automatic", { ref, commit, eventType: "push", refName: eventRef });
        queued.push(source.id);
      } else if (source.triggerType === "tag" && ref.startsWith("refs/tags/") && !/^0{40,64}$/.test(commit) && (commit === "" || /^[a-f0-9]{40,64}$/i.test(commit))) {
        const tagName = ref.slice("refs/tags/".length);
        if (!claimGitSourceEventRef(source.id, "tag", tagName, commit || undefined)) continue;
        scheduleGitDeployment(source.id, "automatic", { ref, commit: commit || undefined, eventType: "tag", refName: tagName });
        queued.push(source.id);
      }
    } else if (event === "release" && source.triggerType === "release") {
      const action = payload.action;
      const release = payload.release as { tag_name?: unknown } | undefined;
      const tagName = typeof release?.tag_name === "string" ? release.tag_name : "";
      if ((action === "published" || action === "released") && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(tagName) && !tagName.includes("..")) {
        if (!claimGitSourceEventRef(source.id, "release", tagName)) continue;
        scheduleGitDeployment(source.id, "automatic", { ref: `refs/tags/${tagName}`, eventType: "release", refName: tagName });
        queued.push(source.id);
      }
    }
  }
  return { accepted: true, duplicate: false, queued: queued.length };
}

async function performGitDeployment(id: string, deploymentId: string, runtime: NonNullable<ReturnType<typeof gitSourceRuntimeData>>, target?: GitDeploymentTarget, operation: GitDeploymentOperation = "deploy", options: GitDeploymentOptions = {}) {
  let envDirectory: string | null = null;
  let targetCommit: string | null = null;
  let targetCommitTitle: string | null = null;
  try {
    const source = runtime.source;
    updateGitDeployment(deploymentId, { phase: "checking_remote" });
    appendGitDeploymentLog(deploymentId, target ? `\nResolving event ref ${target.ref}…\n` : "\nChecking the remote branch…\n");
    const credentials = await credentialsFor(runtime);
    const sha = target?.commit ?? (target ? await currentRemoteRefCommit(source.repository, target.ref, credentials.token, credentials.username) : await currentRemoteCommit(source.repository, source.branch, credentials.token, credentials.username));
    targetCommit = sha;
    appendGitDeploymentLog(deploymentId, `Remote commit: ${sha}\n`);
    updateGitDeployment(deploymentId, { phase: "syncing_repository", commit: sha });
    appendGitDeploymentLog(deploymentId, "\nSyncing repository checkout…\n");
    const repositoryDirectory = target
      ? await ensureCheckoutAtRef(id, source.repository, target.ref, sha, credentials.token, credentials.username, source.enableSubmodules)
      : await ensureCheckout(id, source.repository, source.branch, credentials.token, credentials.username, source.enableSubmodules);
    const subject = await run("git", ["show", "-s", "--format=%s", sha], repositoryDirectory, safeCommandEnvironment());
    if (subject.code === 0 && subject.stdout.trim()) {
      targetCommitTitle = subject.stdout.trim().slice(0, 500);
      updateGitDeployment(deploymentId, { phase: "syncing_repository", commit: sha, commitTitle: targetCommitTitle });
    }
    updateGitDeployment(deploymentId, { phase: "validating_compose" });
    appendGitDeploymentLog(deploymentId, `\nValidating Compose configuration for ${operation.replaceAll("_", " ")}…\n`);
    const composeFile = await composeFilePath(repositoryDirectory, source.composePath);
    await access(composeFile);
    const temp = await createTemporaryEnv(runtime.secrets);
    envDirectory = temp.directory;
    const name = safeProjectName(source.name);
    await runCompose(repositoryDirectory, composeFile, name, temp.path, ["config", "--quiet"], deploymentId, runtime.secrets, id);
    // Keep resolved configuration (which may contain secrets) out of deployment logs.
    const resolved = await run("docker", ["compose", "--project-name", name, "--env-file", temp.path, "--file", composeFile, "config", "--format", "json"], repositoryDirectory, safeCommandEnvironment());
    if (resolved.code !== 0) throw new Error("Could not inspect Compose port configuration.");
    const configuration = JSON.parse(resolved.stdout) as { services: Record<string, { ports?: PublishedPort[]; profiles?: string[]; network_mode?: string }> };
    const selectedServices = [...new Set(options.services ?? [])];
    if (selectedServices.length > 100 || selectedServices.some((service) => !Object.hasOwn(configuration.services, service))) throw new Error("One or more selected Compose services do not exist");
    const activeServiceNames = selectedServices.length ? selectedServices : Object.keys(configuration.services);
    const portServices = Object.entries(configuration.services).filter(([serviceName, service]) => activeServiceNames.includes(serviceName) && !service.profiles?.length && service.network_mode !== "host" && service.ports?.length);
    const ports = portServices.flatMap(([, service]) => service.ports ?? []);
    if (operation !== "stop") {
      const conflict = portConflict(ports, await readContainerNetworks(), name);
      if (conflict) throw new Error(conflict);
    }
    const existingContainers = await readContainerNetworks(name);
    if (operation === "stop") {
      updateGitDeployment(deploymentId, { phase: "stopping" });
      appendGitDeploymentLog(deploymentId, "\nStopping Compose services…\n");
      await runCompose(repositoryDirectory, composeFile, name, temp.path, ["stop", ...selectedServices], deploymentId, runtime.secrets, id);
    } else if (operation === "start") {
      updateGitDeployment(deploymentId, { phase: "starting" });
      appendGitDeploymentLog(deploymentId, "\nStarting Compose services…\n");
      await runCompose(repositoryDirectory, composeFile, name, temp.path, ["up", ...(options.detach === false ? [] : ["--detach"]), ...selectedServices], deploymentId, runtime.secrets, id);
    } else if (operation === "restart" || operation === "logs") {
      updateGitDeployment(deploymentId, { phase: operation === "logs" ? "validating_compose" : "starting" });
      await runCompose(repositoryDirectory, composeFile, name, temp.path, [operation, ...(operation === "logs" ? ["--tail", "200", "--no-color"] : []), ...selectedServices], deploymentId, runtime.secrets, id);
    } else if (operation === "down") {
      updateGitDeployment(deploymentId, { phase: "stopping" });
      await runCompose(repositoryDirectory, composeFile, name, temp.path, ["down", "--remove-orphans"], deploymentId, runtime.secrets, id);
    } else {
      if (operation === "fresh_volumes") {
        updateGitDeployment(deploymentId, { phase: "cleaning_volumes" });
        appendGitDeploymentLog(deploymentId, "\nRemoving this Compose project's containers and volumes…\n");
        await runCompose(repositoryDirectory, composeFile, name, temp.path, ["down", "--volumes", "--remove-orphans"], deploymentId, runtime.secrets, id);
      }
      if (operation === "down_up") {
        updateGitDeployment(deploymentId, { phase: "stopping" });
        appendGitDeploymentLog(deploymentId, "\nScheduled window: bringing the Compose project down before applying the latest repository revision…\n");
        await runCompose(repositoryDirectory, composeFile, name, temp.path, ["down", "--remove-orphans"], deploymentId, runtime.secrets, id);
      }
      updateGitDeployment(deploymentId, { phase: operation === "rebuild" ? "rebuilding" : "building_and_deploying" });
      appendGitDeploymentLog(deploymentId, operation === "rebuild" ? "\nRebuilding and recreating Compose services…\n" : "\nBuilding and deploying services…\n");
      const needsNetworkRecovery = existingContainers.some((container) =>
        portServices.some(([serviceName]) => serviceName === container.service) && missingPublishedPort(container),
      );
      const upArgs = ["up", ...(options.detach === false ? [] : ["--detach", "--remove-orphans"]), "--build", ...selectedServices];
      if (operation === "rebuild" || operation === "fresh_volumes" || needsNetworkRecovery) upArgs.push("--force-recreate");
      await runCompose(repositoryDirectory, composeFile, name, temp.path, upArgs, deploymentId, runtime.secrets, id);
      appendGitDeploymentLog(deploymentId, "\nVerifying published container ports…\n");
      const deployedContainers = await readContainerNetworks(name);
      for (const [serviceName, service] of portServices) {
        const containers = deployedContainers.filter((container) => container.service === serviceName);
        if (!containers.length || containers.some((container) => service.ports?.some((port) => !container.bindings?.[`${port.target}/${port.protocol ?? "tcp"}`]?.length))) {
          throw new Error(`Service ${serviceName} is missing its configured port bindings.`);
        }
      }
      for (const container of deployedContainers) {
        if (!portServices.some(([serviceName]) => serviceName === container.service)) continue;
        const failure = missingPublishedPort(container);
        if (failure) throw new Error(failure);
      }
    }
    updateGitDeployment(deploymentId, { phase: "completed", status: "succeeded", commit: sha, commitTitle: targetCommitTitle, error: null, finished: true });
    appendGitDeploymentLog(deploymentId, `\nCompose ${operation.replaceAll("_", " ")} completed successfully.\n`);
    const now = new Date().toISOString();
    updateGitSourceState(id, { lastCommit: sha, lastEventRef: target?.ref, lastCheckedAt: now, lastDeployedAt: now, lastStatus: "deployed", lastError: null });
    if (target?.eventType && target.refName) updateGitSourceEventRef(id, target.eventType, target.refName, "deployed", sha);
  } catch (error) {
    if (cancelledDeployments.has(deploymentId)) {
      cancelGitDeploymentRecord(deploymentId);
      updateGitSourceState(id, { lastStatus: "idle", lastError: null });
      return;
    }
    const message = error instanceof Error ? error.message : "Falló el despliegue";
    appendGitDeploymentLog(deploymentId, `\nDeployment failed: ${redactDeploymentOutput(message, runtime.secrets)}\n`);
    updateGitDeployment(deploymentId, { phase: "failed", status: "failed", commit: targetCommit, commitTitle: targetCommitTitle, error: message.slice(0, 300), finished: true });
    updateGitSourceState(id, { lastCommit: targetCommit, lastCheckedAt: new Date().toISOString(), lastStatus: "failed", lastError: message.slice(0, 300) });
    if (target?.eventType && target.refName) updateGitSourceEventRef(id, target.eventType, target.refName, "failed", targetCommit ?? undefined);
  } finally {
    cancelledDeployments.delete(deploymentId);
    if (envDirectory) await rm(envDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function checkGitSource(id: string) {
  if (activeDeployments.has(id) || activeSourceChecks.has(id)) return;
  activeSourceChecks.add(id);
  try {
    const runtime = gitSourceRuntimeData(id);
    if (!runtime) return;
    // Recover accepted webhook events after a process restart, even for webhook-only sources.
    if (runtime.source.triggerType !== "manual") {
      const pending = listPendingGitSourceEventRefs(id, runtime.source.triggerType);
      if (pending.length) {
        const event = pending[0];
        const target: GitDeploymentTarget = runtime.source.triggerType === "push"
          ? { ref: `refs/heads/${runtime.source.branch}`, commit: event.commit ?? undefined, eventType: "push", refName: event.name }
          : { ref: `refs/tags/${event.name}`, commit: event.commit ?? undefined, eventType: runtime.source.triggerType, refName: event.name };
        scheduleGitDeployment(id, "automatic", target);
        return;
      }
    }
    // Manual-only sources should not poll the Git provider in the background.
    if (!runtime.source.autoDeploy || runtime.source.pollIntervalSeconds === 0) return;
    if (runtime.source.lastCheckedAt && Date.now() - Date.parse(runtime.source.lastCheckedAt) < runtime.source.pollIntervalSeconds * 1000) return;
    const credentials = await credentialsFor(runtime);
    const now = new Date().toISOString();
    if (runtime.source.triggerType === "tag") {
      const refs = await currentRemoteTags(runtime.source.repository, credentials.token, credentials.username);
      if (!gitSourceEventBaselineExists(id, "tag")) {
        initializeGitSourceEventBaseline(id, "tag", refs);
        updateGitSourceState(id, { lastCheckedAt: now, lastStatus: "idle", lastError: null });
        return;
      }
      const seen = new Set(listGitSourceEventRefs(id, "tag").map((ref) => ref.name));
      const next = refs.find((ref) => !seen.has(ref.name) && claimGitSourceEventRef(id, "tag", ref.name, ref.commit));
      updateGitSourceState(id, { lastCheckedAt: now });
      if (next) scheduleGitDeployment(id, "automatic", { ref: `refs/tags/${next.name}`, commit: next.commit, eventType: "tag", refName: next.name });
      return;
    }
    if (runtime.source.triggerType === "release") {
      if (runtime.source.providerId && runtime.source.providerType !== "bitbucket") {
        const releaseTags = await recentGitReleaseTags(runtime.source.providerId, runtime.source.repository);
        const refs = releaseTags.map((name) => ({ name }));
        if (!gitSourceEventBaselineExists(id, "release")) {
          initializeGitSourceEventBaseline(id, "release", refs);
          updateGitSourceState(id, { lastCheckedAt: now, lastStatus: "idle", lastError: null });
          return;
        }
        const seen = new Set(listGitSourceEventRefs(id, "release").map((ref) => ref.name));
        const newReleases = refs.filter((ref) => !seen.has(ref.name) && claimGitSourceEventRef(id, "release", ref.name));
        updateGitSourceState(id, { lastCheckedAt: now });
        for (const release of newReleases.reverse()) scheduleGitDeployment(id, "automatic", { ref: `refs/tags/${release.name}`, eventType: "release", refName: release.name });
      }
      return;
    }
    if (runtime.source.triggerType !== "push") return;
    const sha = await currentRemoteCommit(runtime.source.repository, runtime.source.branch, credentials.token, credentials.username);
    const previous = runtime.source.lastCommit;
    updateGitSourceState(id, { lastCheckedAt: now });
    // The first poll records a baseline; deployment starts after an explicit first deploy.
    if (!previous) {
      updateGitSourceState(id, { lastCommit: sha, lastStatus: "idle", lastError: null });
      return;
    }
    if (sha === previous) {
      updateGitSourceState(id, { lastStatus: runtime.source.lastDeployedAt ? "deployed" : "idle", lastError: null });
      return;
    }
    if (previous && runtime.source.watchPaths.length) {
      const repositoryDirectory = await ensureCheckout(id, runtime.source.repository, runtime.source.branch, credentials.token, credentials.username, runtime.source.enableSubmodules);
      const changed = await run("git", ["diff", "--name-only", `${previous}..${sha}`], repositoryDirectory, gitEnvironment(credentials.token, credentials.username));
      if (changed.code !== 0) throw new Error("No se pudieron revisar los cambios del repositorio para los Watch Paths");
      const matches = changed.stdout.split("\n").filter(Boolean).some((file) => runtime.source.watchPaths.some((pattern) => matchesWatchPath(file, pattern)));
      if (!matches) {
        updateGitSourceState(id, { lastCommit: sha, lastStatus: "idle", lastError: null });
        return;
      }
    }
    if (runtime.source.autoDeploy) {
      const eventRef = `branch:${runtime.source.branch}:${sha}`;
      if (claimGitSourceEventRef(id, "push", eventRef, sha)) scheduleGitDeployment(id, "automatic", { ref: `refs/heads/${runtime.source.branch}`, commit: sha, eventType: "push", refName: eventRef });
    }
    else updateGitSourceState(id, { lastStatus: "update-available", lastError: null });
  } catch (error) {
    updateGitSourceState(id, { lastCheckedAt: new Date().toISOString(), lastStatus: "failed", lastError: error instanceof Error ? error.message.slice(0, 300) : "No se pudo consultar GitHub" });
  } finally {
    activeSourceChecks.delete(id);
  }
}

function matchesWatchPath(file: string, pattern: string) {
  let expression = "^";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") { expression += "(?:.*/)?"; index += 2; }
      else { expression += ".*"; index++; }
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  expression += "$";
  try { return new RegExp(expression).test(file); } catch { return false; }
}

const pollerGlobal = globalThis as typeof globalThis & { __vesselGitSourcePollerStarted?: boolean };
export function startGitSourcePoller() {
  if (pollerGlobal.__vesselGitSourcePollerStarted || process.env.NODE_ENV === "test") return;
  pollerGlobal.__vesselGitSourcePollerStarted = true;
  recoverInterruptedGitDeployments();
  const tick = () => {
    try { for (const source of listGitSources()) void checkGitSource(source.id); } catch { /* A later poll retries transient SQLite errors. */ }
  };
  const timer = setInterval(tick, pollIntervalMs);
  timer.unref?.();
  setTimeout(tick, 15_000).unref?.();
}
