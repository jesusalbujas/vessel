import { NextResponse } from "next/server";
import {
  authenticatedUser,
  addVesselProjectService,
  clearGitDeploymentHistory,
  createGitSource,
  deleteGitSource,
  deleteGitSourceSecret,
  gitProviderById,
  getGitDeployment,
  gitSourceById,
  gitSourceRuntimeData,
  gitSourceSecretNames,
  listGitDeployments,
  listGitProviders,
  listGitSources,
  listVesselProjectServices,
  secretStorageReady,
  setGitSourceSecret,
  updateGitSource,
  vesselProjectById,
  type GitProviderKind,
} from "@/lib/control-plane";
import { inspectGitRepository, listGitRepositories, readGitRepositoryComposeFile } from "@/lib/git-provider-clients";
import { cancelQueuedGitDeployments, killGitBuild, startGitDeployment, type GitDeploymentOperation } from "@/lib/git-deployments";

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}

function manager(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return { response: privateJson({ error: "Authentication required" }, { status: 401 }) };
  if (user.role === "viewer") return { response: privateJson({ error: "This account cannot manage deployments" }, { status: 403 }) };
  return { user };
}

function canUseProvider(id: string, role: string) {
  const provider = gitProviderById(id);
  return provider?.connected && (role === "administrator" || provider.shareWithOrganization) ? provider : null;
}

function canUseSource(id: string, role: string) {
  const source = gitSourceById(id);
  if (!source) return null;
  if (role === "administrator") return source;
  if (!source.providerId) return role === "administrator" ? source : null;
  return canUseProvider(source.providerId, role) ? source : null;
}

function validLegacyGitHubRepository(value: string) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "github.com" && !url.username && !url.password && !url.search && !url.hash && parts.length === 2 && parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part));
  } catch { return false; }
}

function validateSource(body: Record<string, unknown>) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const repository = typeof body.repository === "string" ? body.repository.trim().replace(/\.git\/?$/i, "") : "";
  const providerId = typeof body.providerId === "string" ? body.providerId : null;
  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  const composePath = typeof body.composePath === "string" ? body.composePath.trim() : "";
  const triggerType = ["push", "tag", "release", "manual"].includes(String(body.triggerType)) ? String(body.triggerType) as "push" | "tag" | "release" | "manual" : body.autoDeploy === false ? "manual" : "push";
  const pollIntervalSeconds = Number(body.pollIntervalSeconds ?? 60);
  const autoDeploy = triggerType !== "manual";
  const watchPaths = Array.isArray(body.watchPaths) ? [...new Set(body.watchPaths.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))] : [];
  const enableSubmodules = body.enableSubmodules === true;
  const accessToken = typeof body.accessToken === "string" ? body.accessToken : undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name)) throw new Error("El nombre debe tener entre 1 y 64 caracteres: letras, números, punto, guion o guion bajo");
  if (!repository || repository.length > 500) throw new Error("Selecciona un repositorio Git válido");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith("/") || branch.endsWith(".lock") || branch.includes("@{")) throw new Error("La rama Git no es válida");
  if (!composePath || composePath.length > 512 || composePath.startsWith("/") || composePath.split(/[\\/]/).some((part) => part === "..") || !/\.ya?ml$/i.test(composePath)) throw new Error("Indica una ruta relativa a un archivo .yml o .yaml dentro del repositorio");
  if (![0, 15, 30, 60, 120, 300].includes(pollIntervalSeconds)) throw new Error("El intervalo debe ser desactivado, 15, 30, 60, 120 o 300 segundos");
  if (watchPaths.length > 20 || watchPaths.some((path) => path.length > 256 || path.startsWith("/") || path.split(/[\\/]/).some((part) => part === "..") || /[\r\n\0]/.test(path))) throw new Error("Watch paths must be relative paths or glob patterns (up to 20 entries)");
  if (accessToken !== undefined && (accessToken.length > 4096 || /[\r\n\0]/.test(accessToken))) throw new Error("El token GitHub no es válido");
  return { name, repository, providerId, branch, composePath, triggerType, autoDeploy, pollIntervalSeconds, watchPaths, enableSubmodules, accessToken };
}

async function verifyRepository(providerId: string, repository: string, branch?: string) {
  const provider = gitProviderById(providerId);
  if (!provider?.connected) throw new Error("La conexión Git no está autorizada; vuelve a conectar el proveedor");
  return inspectGitRepository(providerId, repository, branch);
}

export function getDeployments(request: Request) {
  const auth = manager(request);
  if ("response" in auth) return auth.response;
  const role = auth.user.role;
  const deploymentId = new URL(request.url).searchParams.get("deploymentId");
  if (deploymentId) {
    const deployment = getGitDeployment(deploymentId);
    if (!deployment || !canUseSource(deployment.sourceId, role)) return privateJson({ error: "Deployment not found or unavailable" }, { status: 404 });
    return privateJson({ data: { id: deployment.id, status: deployment.status, phase: deployment.phase, logs: deployment.logs, error: deployment.error, updatedAt: deployment.updatedAt } });
  }
  const providers = listGitProviders().filter((provider) => role === "administrator" || (provider.connected && provider.shareWithOrganization));
  const providerIds = new Set(providers.map((provider) => provider.id));
  const sources = listGitSources().filter((source) => role === "administrator" || (source.providerId !== null && providerIds.has(source.providerId)));
  const deploymentRecords = role === "administrator"
    ? listGitDeployments(undefined, 200)
    : sources.flatMap((source) => listGitDeployments(source.id, 200)).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200);
  const deployments = deploymentRecords.map(({ logs: _logs, ...deployment }) => deployment);
  const data = sources.map((source) => ({ ...source, secrets: gitSourceSecretNames(source.id) }));
  const availableProviders = providers.map(({ id, provider, name, connected, shareWithOrganization }) => ({ id, provider, name, connected, shareWithOrganization }));
  return privateJson({ data, deployments, providers: availableProviders, secretStorageReady: secretStorageReady() });
}

export async function postDeployments(request: Request) {
  const auth = manager(request);
  if ("response" in auth) return auth.response;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 64_000) return privateJson({ error: "Request is too large" }, { status: 413 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return privateJson({ error: "Invalid request" }, { status: 400 });
  if (JSON.stringify(body).length > 64_000) return privateJson({ error: "Request is too large" }, { status: 413 });
  const role = auth.user.role;
  try {
    if (["clear_history", "cancel_queue", "kill_build"].includes(body.action)) {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id || !canUseSource(id, role)) return privateJson({ error: "Git source not found or unavailable" }, { status: 404 });
      if (body.action === "clear_history") return privateJson({ ok: true, data: { cleared: clearGitDeploymentHistory(id) } });
      if (body.action === "cancel_queue") return privateJson({ ok: true, data: { cancelled: cancelQueuedGitDeployments(id) } });
      if (!killGitBuild(id)) return privateJson({ error: "No active Compose build can be stopped for this source" }, { status: 409 });
      return privateJson({ ok: true });
    }
    if (body.action === "list_repositories") {
      const providerId = typeof body.providerId === "string" ? body.providerId : "";
      if (!providerId || !canUseProvider(providerId, role)) return privateJson({ error: "Git provider is unavailable or not shared with this account" }, { status: 403 });
      return privateJson({ data: await listGitRepositories(providerId) });
    }
    if (body.action === "inspect_repository") {
      const providerId = typeof body.providerId === "string" ? body.providerId : "";
      const repository = typeof body.repository === "string" ? body.repository.trim() : "";
      const branch = typeof body.branch === "string" ? body.branch.trim() : undefined;
      if (!providerId || !canUseProvider(providerId, role)) return privateJson({ error: "Git provider is unavailable or not shared with this account" }, { status: 403 });
      if (!repository) return privateJson({ error: "Selecciona un repositorio Git" }, { status: 400 });
      return privateJson({ data: await verifyRepository(providerId, repository, branch) });
    }
    if (body.action === "preview_compose") {
      const id = typeof body.id === "string" ? body.id : "";
      const source = id ? canUseSource(id, role) : null;
      const providerId = source?.providerId ?? (typeof body.providerId === "string" ? body.providerId : "");
      const repository = source?.repository ?? (typeof body.repository === "string" ? body.repository.trim() : "");
      const branch = source?.branch ?? (typeof body.branch === "string" ? body.branch.trim() : "");
      const composePath = source?.composePath ?? (typeof body.composePath === "string" ? body.composePath.trim() : "");
      if (!providerId || !canUseProvider(providerId, role) || (id && !source)) return privateJson({ error: "La fuente Git no está disponible para esta cuenta" }, { status: 404 });
      if (!repository || !branch || !composePath) return privateJson({ error: "Selecciona un repositorio, una rama y un archivo YAML" }, { status: 400 });
      const yaml = await readGitRepositoryComposeFile(providerId, repository, branch, composePath);
      return privateJson({ data: { yaml, repository, branch, composePath } });
    }
    if (body.action === "configure_application") {
      const projectId = typeof body.projectId === "string" ? body.projectId : "";
      const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
      if (!projectId || !vesselProjectById(projectId)) return privateJson({ error: "Project not found" }, { status: 404 });
      const service = listVesselProjectServices(projectId).find((item) => item.id === serviceId);
      if (!service || service.kind !== "application") return privateJson({ error: "Application service not found" }, { status: 404 });
      const sourceSuffix = service.id.replace(/-/g, "").slice(-6);
      const sourceBase = (service.appName || service.name).toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
      const sourceName = `${sourceBase.slice(0, 56)}-${sourceSuffix}`;
      const input = validateSource({ ...body, name: sourceName });
      if (!input.providerId || !canUseProvider(input.providerId, role)) return privateJson({ error: "Selecciona una conexión Git autorizada y compartida" }, { status: 403 });
      const provider = gitProviderById(input.providerId);
      if (input.autoDeploy && input.pollIntervalSeconds === 0 && !provider?.hasWebhookSecret) return privateJson({ error: "git_webhook_secret_required" }, { status: 400 });
      input.repository = (await verifyRepository(input.providerId, input.repository)).repository;
      let source = service.targetType === "git" && service.targetRef ? canUseSource(service.targetRef, role) : null;
      if (source) {
        source = updateGitSource({ ...input, id: source.id }) ?? null;
        if (!source) return privateJson({ error: "Git source not found" }, { status: 404 });
      } else {
        source = createGitSource(input);
      }
      const updatedService = addVesselProjectService({ projectId, kind: "application", name: service.name, appName: service.appName, description: service.description, targetType: "git", targetRef: source.id });
      return privateJson({ data: { service: updatedService, source: { ...source, secrets: gitSourceSecretNames(source.id) } } }, { status: 200 });
    }
    if (body.action === "create" || body.action === "update") {
      const input = validateSource(body);
      if (body.action === "create") {
        if (!input.providerId || !canUseProvider(input.providerId, role)) return privateJson({ error: "Selecciona una conexión Git autorizada y compartida" }, { status: 403 });
        const provider = gitProviderById(input.providerId);
        if (input.autoDeploy && input.pollIntervalSeconds === 0 && !provider?.hasWebhookSecret) return privateJson({ error: "git_webhook_secret_required" }, { status: 400 });
        const projectId = typeof body.projectId === "string" ? body.projectId : "";
        if (projectId && !vesselProjectById(projectId)) return privateJson({ error: "Project not found" }, { status: 404 });
        input.repository = (await verifyRepository(input.providerId, input.repository)).repository;
        const source = createGitSource(input);
        if (projectId) addVesselProjectService({ projectId, kind: "git", name: source.name, description: `${source.repository} · ${source.branch}`, targetType: "git", targetRef: source.id });
        return privateJson({ data: { ...source, secrets: [] } }, { status: 201 });
      }
      if (typeof body.id !== "string") return privateJson({ error: "Git source not found or unavailable" }, { status: 404 });
      const existing = canUseSource(body.id, role);
      if (!existing) return privateJson({ error: "Git source not found or unavailable" }, { status: 404 });
      if (input.autoDeploy && input.pollIntervalSeconds === 0 && input.providerId) {
        const provider = gitProviderById(input.providerId);
        if (!provider?.hasWebhookSecret) return privateJson({ error: "git_webhook_secret_required" }, { status: 400 });
      }
      if (input.providerId) {
        if (!canUseProvider(input.providerId, role)) return privateJson({ error: "Selecciona una conexión Git autorizada y compartida" }, { status: 403 });
        input.repository = (await verifyRepository(input.providerId, input.repository)).repository;
      } else if (existing.providerId || role !== "administrator" || !validLegacyGitHubRepository(input.repository)) {
        return privateJson({ error: "Selecciona una conexión Git autorizada y compartida" }, { status: 403 });
      }
      const source = updateGitSource({ ...input, id: body.id, clearToken: body.clearToken === true });
      if (!source) return privateJson({ error: "Git source not found" }, { status: 404 });
      return privateJson({ data: { ...source, secrets: gitSourceSecretNames(source.id) } });
    }
    if (body.action === "sync") {
      if (typeof body.id !== "string") return privateJson({ error: "Git source not found or unavailable" }, { status: 404 });
      const source = canUseSource(body.id, role);
      if (!source) return privateJson({ error: "Git source not found or unavailable" }, { status: 404 });
      if (source.providerId && !canUseProvider(source.providerId, role)) return privateJson({ error: "Reconnect this Git provider before deploying" }, { status: 409 });
      const allowedOperations: GitDeploymentOperation[] = ["deploy", "rebuild", "fresh_volumes", "start", "stop"];
      const operation = typeof body.operation === "string" && allowedOperations.includes(body.operation as GitDeploymentOperation)
        ? body.operation as GitDeploymentOperation
        : "deploy";
      const result = startGitDeployment(body.id, "manual", undefined, undefined, operation);
      const { logs: _logs, ...summary } = result;
      return privateJson({ ok: true, data: summary }, { status: 202 });
    }
    if (body.action === "set_secret") {
      if (typeof body.id !== "string" || !canUseSource(body.id, role)) return privateJson({ error: "Git source not found or unavailable" }, { status: 404 });
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const value = typeof body.value === "string" ? body.value : "";
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)) return privateJson({ error: "El nombre del secreto debe ser una variable de entorno válida" }, { status: 400 });
      if (!value || value.length > 32_768 || /\0/.test(value)) return privateJson({ error: "El valor del secreto está vacío o supera el máximo permitido" }, { status: 400 });
      setGitSourceSecret(body.id, name, value);
      return privateJson({ ok: true, secrets: gitSourceSecretNames(body.id) });
    }
    if (body.action === "delete_secret") {
      if (typeof body.id !== "string" || typeof body.name !== "string" || !canUseSource(body.id, role)) return privateJson({ error: "Git source or secret not found" }, { status: 404 });
      deleteGitSourceSecret(body.id, body.name);
      return privateJson({ ok: true, secrets: gitSourceSecretNames(body.id) });
    }
    return privateJson({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to process Git deployment";
    const status = message.includes("UNIQUE constraint failed") ? 409 : 400;
    return privateJson({ error: message }, { status });
  }
}

export async function deleteDeployments(request: Request) {
  const auth = manager(request);
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !canUseSource(id, auth.user.role)) return privateJson({ error: "Git source not found or unavailable" }, { status: 404 });
  deleteGitSource(id);
  // Existing Compose resources and checkouts remain untouched by removing this deployment source.
  return privateJson({ ok: true, note: "Se elimina la fuente y sus secretos; no se detienen ni borran recursos Compose." });
}
