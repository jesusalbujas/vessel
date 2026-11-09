import { NextResponse } from "next/server";
import {
  addVesselProjectService,
  assignVesselProjectTags,
  authenticatedUser,
  createVesselProjectTag,
  createVesselProject,
  deleteVesselProjectEnvironmentVariable,
  deleteVesselProject,
  listVesselProjectEnvironmentNames,
  listVesselProjectTags,
  gitProviderById,
  gitSourceById,
  listVesselProjectServices,
  listVesselProjects,
  listGitSources,
  listGitProviders,
  listGitDeployments,
  updateGitDeploymentCommitTitle,
  mutationUser,
  removeVesselProjectService,
  setVesselProjectEnvironmentVariable,
  updateVesselProject,
  vesselProjectById,
  type VesselProjectServiceKind,
} from "@/lib/control-plane";
import { inspectDockerContainer, listDockerContainers } from "@/lib/docker/containers";
import { localGitCommitTitles } from "@/lib/git-commit-metadata";

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}

const kinds = new Set<VesselProjectServiceKind>(["application", "database", "compose", "template", "assistant", "import", "git"]);

export function getProjects(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return json({ error: "Authentication required" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ data: listVesselProjects(), tags: listVesselProjectTags() });
  const project = vesselProjectById(id);
  if (!project) return json({ error: "Project not found" }, { status: 404 });
  const serviceId = new URL(request.url).searchParams.get("serviceId");
  if (!serviceId && new URL(request.url).searchParams.get("environment") === "1") {
    return json({ data: { project, environmentNames: listVesselProjectEnvironmentNames(id) } });
  }
  if (serviceId) {
    const service = listVesselProjectServices(id).find((item) => item.id === serviceId);
    if (!service) return json({ error: "Project service not found" }, { status: 404 });
    const providers = listGitProviders()
      .filter((provider) => provider.connected && (user.role === "administrator" || provider.shareWithOrganization))
      .map(({ id: providerId, provider, name, accountName }) => ({ id: providerId, provider, name, accountName }));
    if (!service.targetType) {
      return json({ data: { project, service, resources: [], deployments: [], gitSource: null, providers } });
    }
    return listDockerContainers().then(async (containers) => {
      let deployments: Array<Omit<ReturnType<typeof listGitDeployments>[number], "logs">> = [];
      let gitSource: { id: string; name: string; repository: string; providerId: string | null; providerType: string | null; providerName: string | null; branch: string; composePath: string; autoDeploy: boolean; triggerType: string; pollIntervalSeconds: number; watchPaths: string[]; enableSubmodules: boolean; lastStatus: string; webhookReady: boolean } | null = null;
      let gitComposeProject: string | null = null;
      if (service.targetType === "git" && service.targetRef) {
        const source = gitSourceById(service.targetRef);
        const provider = source?.providerId ? gitProviderById(source.providerId) : null;
        const canUse = user.role === "administrator" || Boolean(source?.providerId && provider?.connected && provider.shareWithOrganization);
        if (!source || !canUse) return json({ error: "Git deployment source not found or unavailable" }, { status: 404 });
        const deploymentRecords = listGitDeployments(source.id, 100);
        const missingTitles = deploymentRecords.filter((deployment) => deployment.commit && !deployment.commitTitle).map((deployment) => deployment.commit!);
        const commitTitles = await localGitCommitTitles(source.id, missingTitles);
        for (const deployment of deploymentRecords) {
          const title = deployment.commit ? commitTitles[deployment.commit] : undefined;
          if (title) updateGitDeploymentCommitTitle(deployment.id, title);
        }
        deployments = deploymentRecords.map(({ logs: _logs, ...deployment }) => ({ ...deployment, commitTitle: deployment.commitTitle ?? (deployment.commit ? commitTitles[deployment.commit] ?? null : null) }));
        gitSource = { id: source.id, name: source.name, repository: source.repository, providerId: source.providerId, providerType: source.providerType, providerName: source.providerName, branch: source.branch, composePath: source.composePath, autoDeploy: source.autoDeploy, triggerType: source.triggerType, pollIntervalSeconds: source.pollIntervalSeconds, watchPaths: source.watchPaths, enableSubmodules: source.enableSubmodules, lastStatus: source.lastStatus, webhookReady: Boolean(provider?.hasWebhookSecret) };
        const normalized = source.name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
        gitComposeProject = normalized.length >= 2 ? normalized : `vessel-${normalized || "app"}`;
      }
      let selected = containers.filter((container) => service.targetType === "container"
        ? (container.Names ?? []).some((name) => name.replace(/^\//, "") === service.targetRef)
        : service.targetType === "compose" && container.Labels?.["com.docker.compose.project"] === service.targetRef
          || service.targetType === "git" && container.Labels?.["com.docker.compose.project"] === gitComposeProject);
      const resources = await Promise.all(selected.map(async (container) => {
        const details = await inspectDockerContainer(container.Id).catch(() => null);
        const environmentNames = (details?.Config?.Env ?? []).map((entry) => entry.split("=", 1)[0]).filter(Boolean);
        return {
          id: container.Id,
          serviceId: `container-${container.Id.slice(0, 12)}`,
          name: (container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, ""),
          image: container.Image ?? "",
          status: container.State ?? "unknown",
          statusText: container.Status ?? "",
          ports: (container.Ports ?? []).filter((port) => port.PrivatePort).map((port) => ({ host: port.PublicPort ?? null, container: port.PrivatePort, protocol: port.Type ?? "tcp" })),
          networks: Object.keys(details?.NetworkSettings?.Networks ?? {}),
          environmentNames,
          restartPolicy: details?.HostConfig?.RestartPolicy?.Name ?? "no",
          composeService: container.Labels?.["com.docker.compose.service"] ?? null,
          createdAt: container.Created ? new Date(container.Created * 1000).toISOString() : null,
        };
      }));
      return json({ data: { project, service, resources, deployments, gitSource, providers } });
    }).catch(() => json({ error: "Could not read the project service." }, { status: 502 }));
  }
  return listDockerContainers().then((allContainers) => {
    const ownContainerName = process.env.VESSEL_CONTAINER_NAME ?? "vessel";
    const containers = allContainers.filter((container) => !(container.Names ?? []).some((name) => name.replace(/^\//, "") === ownContainerName));
    const compose = new Map<string, { name: string; containers: string[] }>();
    const safeContainers = containers.map((container) => {
      const name = (container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, "");
      const composeProject = container.Labels?.["com.docker.compose.project"] ?? null;
      if (composeProject) {
        const entry = compose.get(composeProject) ?? { name: composeProject, containers: [] };
        entry.containers.push(name);
        compose.set(composeProject, entry);
      }
      return { id: container.Id, name, image: container.Image ?? "", status: container.State ?? "unknown", composeProject };
    });
    const sharedProviderIds = new Set(listGitProviders().filter((provider) => user.role === "administrator" || (provider.connected && provider.shareWithOrganization)).map((provider) => provider.id));
    const gitSources = listGitSources().filter((source) => user.role === "administrator" || (source.providerId !== null && sharedProviderIds.has(source.providerId))).map(({ id: sourceId, name, repository, branch, composePath, lastStatus }) => ({ id: sourceId, name, repository, branch, composePath, lastStatus }));
      return json({ data: { ...project, services: listVesselProjectServices(id), environmentNames: listVesselProjectEnvironmentNames(id), availableTags: listVesselProjectTags(), catalog: { containers: safeContainers, compose: [...compose.values()], git: gitSources } } });
  }).catch(() => json({ data: { ...project, services: listVesselProjectServices(id), environmentNames: listVesselProjectEnvironmentNames(id), availableTags: listVesselProjectTags(), catalog: { containers: [], compose: [], git: [] } } }));
}

export async function postProjects(request: Request) {
  const user = mutationUser(request);
  if (!user) return json({ error: "Authentication required" }, { status: 401 });
  if (user.role === "viewer") return json({ error: "This account cannot manage projects" }, { status: 403 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") return json({ error: "Invalid request" }, { status: 400 });
  try {
    if (body.action === "create") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const tagIds = Array.isArray(body.tagIds) && body.tagIds.every((value) => typeof value === "string") ? body.tagIds as string[] : [];
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,62}$/u.test(name)) return json({ error: "Use a project name between 2 and 63 characters." }, { status: 400 });
      if (description.length > 500) return json({ error: "Description is too long." }, { status: 400 });
      const invalidTags = tagIds.filter((tagId) => !listVesselProjectTags().some((tag) => tag.id === tagId));
      if (invalidTags.length) return json({ error: "A project tag was not found" }, { status: 400 });
      const project = createVesselProject({ name, description, createdBy: user.id });
      if (tagIds.length) assignVesselProjectTags(project.id, tagIds);
      return json({ data: vesselProjectById(project.id) }, { status: 201 });
    }
    if (body.action === "update") {
      const id = typeof body.id === "string" ? body.id : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const tagIds = Array.isArray(body.tagIds) && body.tagIds.every((value) => typeof value === "string") ? body.tagIds as string[] : [];
      if (!id || !vesselProjectById(id)) return json({ error: "Project not found" }, { status: 404 });
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,62}$/u.test(name)) return json({ error: "Use a project name between 2 and 63 characters." }, { status: 400 });
      if (description.length > 500) return json({ error: "Description is too long." }, { status: 400 });
      const validTagIds = new Set(listVesselProjectTags().map((tag) => tag.id));
      if (tagIds.some((tagId) => !validTagIds.has(tagId))) return json({ error: "A project tag was not found" }, { status: 400 });
      if (!updateVesselProject({ id, name, description })) return json({ error: "Project not found" }, { status: 404 });
      assignVesselProjectTags(id, tagIds);
      return json({ data: vesselProjectById(id) });
    }
    if (body.action === "create_tag") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u.test(name)) return json({ error: "Use a tag name between 1 and 40 characters." }, { status: 400 });
      return json({ data: createVesselProjectTag(name) }, { status: 201 });
    }
    if (body.action === "set_environment") {
      const projectId = typeof body.projectId === "string" ? body.projectId : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const value = typeof body.value === "string" ? body.value : "";
      if (!projectId || !vesselProjectById(projectId)) return json({ error: "Project not found" }, { status: 404 });
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || value.length > 16_384) return json({ error: "Project environment variable is invalid" }, { status: 400 });
      setVesselProjectEnvironmentVariable(projectId, name, value);
      return json({ ok: true, environmentNames: listVesselProjectEnvironmentNames(projectId) });
    }
    if (body.action === "delete_environment") {
      const projectId = typeof body.projectId === "string" ? body.projectId : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!projectId || !vesselProjectById(projectId)) return json({ error: "Project not found" }, { status: 404 });
      if (!deleteVesselProjectEnvironmentVariable(projectId, name)) return json({ error: "Project environment variable not found" }, { status: 404 });
      return json({ ok: true, environmentNames: listVesselProjectEnvironmentNames(projectId) });
    }
    if (body.action === "delete") {
      const id = typeof body.id === "string" ? body.id : "";
      if (!id) return json({ error: "Project not found" }, { status: 404 });
      const result = deleteVesselProject(id);
      if (result === "not_found") return json({ error: "Project not found" }, { status: 404 });
      if (result === "has_services") return json({ error: "This project still has services. Remove its services before deleting the project." }, { status: 409 });
      return json({ ok: true, note: "Project metadata and links removed. Docker resources remain unchanged." });
    }
    if (body.action === "create_application") {
      const projectId = typeof body.projectId === "string" ? body.projectId : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const appName = typeof body.appName === "string" ? body.appName.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      if (!projectId || !vesselProjectById(projectId)) return json({ error: "Project not found" }, { status: 404 });
      if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,62}$/u.test(name) || description.length > 500) return json({ error: "Application details are invalid" }, { status: 400 });
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(appName) || appName.length > 63) return json({ error: "App name must use lowercase letters, numbers, and hyphens." }, { status: 400 });
      const existing = listVesselProjectServices(projectId);
      if (existing.some((service) => service.name.toLocaleLowerCase() === name.toLocaleLowerCase() || service.appName === appName)) {
        return json({ error: "An application or app name with these values already exists in this project." }, { status: 409 });
      }
      const data = addVesselProjectService({ projectId, kind: "application", name, appName, description });
      return json({ data }, { status: 201 });
    }
    if (body.action === "add_service") {
      const projectId = typeof body.projectId === "string" ? body.projectId : "";
      const kind = typeof body.kind === "string" && kinds.has(body.kind as VesselProjectServiceKind) ? body.kind as VesselProjectServiceKind : null;
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";
      const targetType = body.targetType === "container" || body.targetType === "compose" || body.targetType === "git" ? body.targetType : null;
      const targetRef = typeof body.targetRef === "string" ? body.targetRef.trim() : "";
      if (!projectId || !vesselProjectById(projectId)) return json({ error: "Project not found" }, { status: 404 });
      if (!kind || !name || name.length > 128 || description.length > 500) return json({ error: "Service details are invalid" }, { status: 400 });
      if (targetType && !targetRef) return json({ error: "A target is required for imported services" }, { status: 400 });
      if (targetType === "git") {
        const source = gitSourceById(targetRef);
        const provider = source?.providerId ? gitProviderById(source.providerId) : null;
        const canUse = user.role === "administrator" || Boolean(source?.providerId && provider?.connected && provider.shareWithOrganization);
        if (!source || !canUse) return json({ error: "Git deployment source not found or unavailable" }, { status: 404 });
      }
      if (targetType === "container" || targetType === "compose") {
        const containers = await listDockerContainers();
        const found = targetType === "container"
          ? containers.some((container) => (container.Names ?? []).some((containerName) => containerName.replace(/^\//, "") === targetRef))
          : containers.some((container) => container.Labels?.["com.docker.compose.project"] === targetRef);
        if (!found) return json({ error: targetType === "container" ? "Docker container not found" : "Compose project not found" }, { status: 404 });
      }
      const data = addVesselProjectService({ projectId, kind, name, description, targetType, targetRef: targetType ? targetRef : null });
      return json({ data }, { status: 201 });
    }
    if (body.action === "remove_service") {
      const projectId = typeof body.projectId === "string" ? body.projectId : "";
      const serviceId = typeof body.serviceId === "string" ? body.serviceId : "";
      if (!removeVesselProjectService(projectId, serviceId)) return json({ error: "Project service not found" }, { status: 404 });
      return json({ ok: true, note: "Project link removed. The Docker or Git resource remains unchanged." });
    }
    return json({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save project";
    const duplicate = message.includes("UNIQUE constraint failed");
    const duplicateMessage = body.action === "create_tag" ? "A project tag with this name already exists." : "A project or service with this name already exists.";
    return json({ error: duplicate ? duplicateMessage : message }, { status: duplicate ? 409 : 400 });
  }
}
