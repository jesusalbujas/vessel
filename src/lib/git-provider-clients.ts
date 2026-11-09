import { sign } from "node:crypto";
import {
  gitProviderRuntimeData,
  saveGitProviderAuthorization,
  updateGitProviderTokens,
  type GitProviderKind,
  type GitProviderRuntime,
} from "@/lib/control-plane";

export type GitRepositorySummary = {
  repository: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export type GitRepositoryInspection = GitRepositorySummary & {
  branches: string[];
  composeFiles: string[];
  treeTruncated: boolean;
};

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function providerApiBase(provider: GitProviderRuntime) {
  if (provider.provider === "github") return "https://api.github.com";
  if (provider.provider === "gitlab") return `${provider.baseUrl}/api/v4`;
  if (provider.provider === "bitbucket") return "https://api.bitbucket.org/2.0";
  return `${provider.baseUrl}/api/v1`;
}

function apiHeaders(provider: GitProviderRuntime, token: string) {
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });
  if (provider.provider === "github") {
    headers.set("Accept", "application/vnd.github+json");
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    headers.set("User-Agent", "Vessel-Git-Providers");
  }
  return headers;
}

async function requestJson<T>(url: string, headers: Headers, init?: RequestInit): Promise<{ data: T; response: Response }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("No se pudo contactar con el proveedor Git desde el servidor Vessel");
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error("El proveedor rechazó la conexión; vuelve a autorizarla");
    if (response.status === 403 || response.status === 429) throw new Error("El proveedor denegó o limitó la solicitud; revisa los permisos de lectura");
    if (response.status === 404) throw new Error("No se encontró el repositorio o la conexión no tiene acceso");
    throw new Error(`El proveedor Git respondió con HTTP ${response.status}`);
  }
  const data = await response.json().catch(() => null) as T | null;
  if (data === null) throw new Error("El proveedor Git devolvió una respuesta inválida");
  return { data, response };
}

async function getGitHubInstallationToken(provider: GitProviderRuntime) {
  if (!provider.appId || !provider.appPrivateKey || !provider.installationId) throw new Error("La GitHub App no está instalada o su configuración está incompleta");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 30, exp: now + 8 * 60, iss: provider.appId }));
  const input = `${header}.${payload}`;
  const jwt = `${input}.${sign("RSA-SHA256", Buffer.from(input), provider.appPrivateKey).toString("base64url")}`;
  const response = await fetch(`https://api.github.com/app/installations/${encodeURIComponent(provider.installationId)}/access_tokens`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Vessel-Git-Providers", "Content-Type": "application/json" },
    body: JSON.stringify({ permissions: { contents: "read", metadata: "read" } }),
  });
  if (!response.ok) throw new Error("GitHub no pudo emitir un token de instalación; verifica permisos de Contents: read");
  const data = await response.json() as { token?: string; expires_at?: string };
  if (!data.token || !data.expires_at) throw new Error("GitHub devolvió un token de instalación incompleto");
  return data.token;
}

export async function gitProviderAccessToken(providerId: string): Promise<{ token: string; gitUsername: string; provider: GitProviderRuntime }> {
  const provider = gitProviderRuntimeData(providerId);
  if (!provider?.connected) throw new Error("La conexión Git no está autorizada");
  if (provider.provider === "github") return { token: await getGitHubInstallationToken(provider), gitUsername: "x-access-token", provider };
  if (!provider.accessToken) throw new Error("La conexión Git debe autorizarse de nuevo");
  if (provider.tokenExpiresAt && Date.parse(provider.tokenExpiresAt) < Date.now() + 90_000) {
    if (!provider.refreshToken) throw new Error("La autorización Git venció; vuelve a conectar el proveedor");
    const refreshed = await refreshGitProvider(provider);
    return { token: refreshed, gitUsername: gitUsername(provider), provider: gitProviderRuntimeData(providerId)! };
  }
  return { token: provider.accessToken, gitUsername: gitUsername(provider), provider };
}

function gitUsername(provider: GitProviderRuntime) {
  if (provider.provider === "gitlab") return "oauth2";
  if (provider.provider === "bitbucket") return "x-token-auth";
  return provider.accountName || "oauth2";
}

function tokenEndpoint(provider: GitProviderRuntime) {
  if (provider.provider === "gitlab") return `${provider.baseUrl}/oauth/token`;
  if (provider.provider === "bitbucket") return "https://bitbucket.org/site/oauth2/access_token";
  if (provider.provider === "gitea") return `${provider.baseUrl}/login/oauth/access_token`;
  throw new Error("GitHub usa tokens de instalación y no un token OAuth intercambiable");
}

async function exchangeOAuthToken(provider: GitProviderRuntime, parameters: URLSearchParams, basicAuth = false) {
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" });
  if (basicAuth) headers.set("Authorization", `Basic ${Buffer.from(`${provider.clientId}:${provider.clientSecret ?? ""}`).toString("base64")}`);
  else {
    parameters.set("client_id", provider.clientId);
    parameters.set("client_secret", provider.clientSecret ?? "");
  }
  let response: Response;
  try {
    response = await fetch(tokenEndpoint(provider), { method: "POST", headers, body: parameters.toString(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error("No se pudo completar el intercambio OAuth con el proveedor Git");
  }
  const data = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string } | null;
  if (!response.ok || !data?.access_token) throw new Error("El proveedor rechazó la autorización OAuth; revisa Client ID, secreto y callback URL");
  const expiresAt = Number.isFinite(data.expires_in) ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString() : null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, expiresAt };
}

async function refreshGitProvider(provider: GitProviderRuntime) {
  const parameters = new URLSearchParams({ grant_type: "refresh_token", refresh_token: provider.refreshToken ?? "" });
  const tokens = await exchangeOAuthToken(provider, parameters, provider.provider === "bitbucket");
  updateGitProviderTokens(provider.id, tokens);
  return tokens.accessToken;
}

export async function completeGitOAuth(provider: GitProviderRuntime, code: string, verifier: string, callbackUrl: string) {
  const parameters = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl });
  if (provider.provider === "gitlab") parameters.set("code_verifier", verifier);
  const tokens = await exchangeOAuthToken(provider, parameters, provider.provider === "bitbucket");
  const headers = apiHeaders(provider, tokens.accessToken);
  const identityPath = provider.provider === "gitlab" ? "/user" : provider.provider === "bitbucket" ? "/user" : "/user";
  const { data } = await requestJson<{ username?: string; login?: string; nickname?: string; display_name?: string; name?: string }>(`${providerApiBase(provider)}${identityPath}`, headers);
  const accountName = data.username ?? data.login ?? data.nickname ?? data.display_name ?? data.name ?? null;
  saveGitProviderAuthorization(provider.id, { ...tokens, accountName });
}

export async function verifyGitHubInstallation(provider: GitProviderRuntime, installationId: string) {
  if (provider.provider !== "github" || !provider.appId || !provider.appPrivateKey) throw new Error("Configura primero una GitHub App completa");
  if (!/^\d{1,20}$/.test(installationId)) throw new Error("El ID de instalación de GitHub no es válido");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 30, exp: now + 8 * 60, iss: provider.appId }));
  const input = `${header}.${payload}`;
  const jwt = `${input}.${sign("RSA-SHA256", Buffer.from(input), provider.appPrivateKey).toString("base64url")}`;
  const { data } = await requestJson<{ id: number; app_id: number; account?: { login?: string } }>(
    `https://api.github.com/app/installations/${installationId}`,
    new Headers({ Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Vessel-Git-Providers" }),
  );
  if (String(data.app_id) !== String(provider.appId)) throw new Error("La instalación pertenece a otra GitHub App");
  const token = await getGitHubInstallationToken({ ...provider, installationId });
  saveGitProviderAuthorization(provider.id, { accessToken: token, accountName: data.account?.login ?? null, installationId });
}

async function fetchProvider<T>(provider: GitProviderRuntime, token: string, path: string) {
  const apiBase = providerApiBase(provider).replace(/\/+$/, "");
  const url = new URL(path.startsWith("http") ? path : `${apiBase}/${path.replace(/^\/+/, "")}`);
  const apiUrl = new URL(apiBase);
  const apiPath = apiUrl.pathname.replace(/\/$/, "");
  if (url.origin !== apiUrl.origin || !(url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`))) throw new Error("La ruta de la API del proveedor no es válida");
  return (await requestJson<T>(url.toString(), apiHeaders(provider, token))).data;
}

function providerPaginationUrl(provider: GitProviderRuntime, candidate: string) {
  const apiBase = new URL(providerApiBase(provider));
  const url = new URL(candidate);
  const apiPath = apiBase.pathname.replace(/\/$/, "");
  if (url.origin !== apiBase.origin || !(url.pathname === apiPath || url.pathname.startsWith(`${apiPath}/`))) throw new Error("El proveedor devolvió una ruta de paginación no confiable");
  return url.toString();
}

function validWebRepository(provider: GitProviderRuntime, value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false;
    const providerBase = new URL(provider.baseUrl);
    const providerHost = providerBase.hostname.toLowerCase();
    const expectedHost = provider.provider === "github" ? "github.com" : provider.provider === "bitbucket" ? "bitbucket.org" : providerHost;
    const pathPrefix = ["github", "bitbucket"].includes(provider.provider) ? "" : providerBase.pathname.replace(/\/$/, "");
    const hasProviderPath = !pathPrefix || url.pathname === pathPrefix || url.pathname.startsWith(`${pathPrefix}/`);
    const repositoryPath = hasProviderPath ? url.pathname.slice(pathPrefix.length) : "";
    return url.hostname.toLowerCase() === expectedHost && hasProviderPath && repositoryPath.split("/").filter(Boolean).length >= 2;
  } catch { return false; }
}

function repositoryParts(provider: GitProviderRuntime, repositoryUrl: string) {
  const url = new URL(repositoryUrl);
  const pathPrefix = ["github", "bitbucket"].includes(provider.provider) ? "" : new URL(provider.baseUrl).pathname.replace(/\/$/, "");
  return url.pathname.slice(pathPrefix.length).split("/").filter(Boolean).map((part) => part.replace(/\.git$/i, ""));
}

export async function recentGitReleaseTags(providerId: string, repositoryUrl: string): Promise<string[]> {
  const { provider, token } = await gitProviderAccessToken(providerId);
  if (!validWebRepository(provider, repositoryUrl)) throw new Error("El repositorio no pertenece al proveedor Git conectado");
  const parts = repositoryParts(provider, repositoryUrl);
  if (provider.provider === "bitbucket") return [];
  if (provider.provider === "github") {
    const releases = await fetchProvider<Array<{ tag_name?: string; published_at?: string | null }>>(provider, token, `/repos/${parts.map(encodeURIComponent).join("/")}/releases?per_page=20`);
    return releases.filter((release) => release.tag_name && release.published_at).sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).map((release) => release.tag_name!);
  }
  if (provider.provider === "gitlab") {
    const project = encodeURIComponent(parts.join("/"));
    const releases = await fetchProvider<Array<{ tag_name?: string; released_at?: string | null }>>(provider, token, `/projects/${project}/releases?per_page=20&order_by=released_at&sort=desc`);
    return releases.filter((release) => release.tag_name).map((release) => release.tag_name!);
  }
  const releases = await fetchProvider<Array<{ tag_name?: string; published_at?: string | null }>>(provider, token, `/repos/${parts.map(encodeURIComponent).join("/")}/releases?limit=20`);
  return releases.filter((release) => release.tag_name).sort((a, b) => String(b.published_at ?? "").localeCompare(String(a.published_at ?? ""))).map((release) => release.tag_name!);
}

export async function listGitRepositories(providerId: string): Promise<GitRepositorySummary[]> {
  const { provider, token } = await gitProviderAccessToken(providerId);
  if (provider.provider === "github") {
    const repositories: GitRepositorySummary[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await fetchProvider<{ repositories: Array<{ full_name: string; html_url: string; default_branch: string; private: boolean }> }>(provider, token, `/installation/repositories?per_page=100&page=${page}`);
      repositories.push(...data.repositories.map((repo) => ({ repository: repo.html_url, fullName: repo.full_name, defaultBranch: repo.default_branch, private: repo.private })));
      if (data.repositories.length < 100) break;
    }
    return repositories;
  }
  if (provider.provider === "gitlab") {
    const repositories: GitRepositorySummary[] = [];
    for (let page = 1; page <= 10; page++) {
      const data = await fetchProvider<Array<{ path_with_namespace: string; web_url: string; default_branch: string | null; visibility: string }>>(provider, token, `/projects?membership=true&simple=true&per_page=100&page=${page}&order_by=last_activity_at`);
      repositories.push(...data.map((repo) => ({ repository: repo.web_url, fullName: repo.path_with_namespace, defaultBranch: repo.default_branch ?? "main", private: repo.visibility !== "public" })));
      if (data.length < 100) break;
    }
    return repositories;
  }
  if (provider.provider === "gitea") {
    const repositories: GitRepositorySummary[] = [];
    for (let page = 1; page <= 20; page++) {
      const data = await fetchProvider<Array<{ full_name: string; html_url: string; default_branch: string; private: boolean }>>(provider, token, `/user/repos?limit=50&page=${page}`);
      repositories.push(...data.map((repo) => ({ repository: repo.html_url, fullName: repo.full_name, defaultBranch: repo.default_branch, private: repo.private })));
      if (data.length < 50) break;
    }
    return repositories;
  }
  const repositories: GitRepositorySummary[] = [];
  let next: string | null = `${providerApiBase(provider)}/repositories?role=member&pagelen=100`;
  type BitbucketRepoPage = { values: Array<{ full_name: string; links: { html: { href: string } }; mainbranch?: { name: string }; is_private: boolean }>; next?: string };
  for (let pageNumber = 0; next && pageNumber < 10; pageNumber++) {
    const page: { data: BitbucketRepoPage; response: Response } = await requestJson<BitbucketRepoPage>(providerPaginationUrl(provider, next), apiHeaders(provider, token));
    repositories.push(...page.data.values.map((repo) => ({ repository: repo.links.html.href, fullName: repo.full_name, defaultBranch: repo.mainbranch?.name ?? "main", private: repo.is_private })));
    next = page.data.next ?? null;
  }
  return repositories;
}

function composeFile(path: string) {
  return /\.ya?ml$/i.test(path);
}

export async function inspectGitRepository(providerId: string, repositoryUrl: string, requestedBranch?: string): Promise<GitRepositoryInspection> {
  const { provider, token } = await gitProviderAccessToken(providerId);
  if (!validWebRepository(provider, repositoryUrl)) throw new Error("El repositorio no pertenece al proveedor conectado o su URL no es válida");
  const parts = repositoryParts(provider, repositoryUrl);
  let fullName = parts.join("/");
  let defaultBranch = "main";
  let isPrivate = true;
  let branches: string[] = [];
  let composeFiles: string[] = [];
  let treeTruncated = false;
  const selectedBranch = (available: string[]) => {
    const selected = requestedBranch || defaultBranch;
    if (!available.includes(selected)) throw new Error("La rama seleccionada no existe o Vessel no puede leerla");
    return selected;
  };

  if (provider.provider === "github") {
    if (parts.length !== 2) throw new Error("La URL de un repositorio GitHub debe tener formato propietario/repositorio");
    const repo = await fetchProvider<{ full_name: string; html_url: string; default_branch: string; private: boolean }>(provider, token, `/repos/${parts.map(encodeURIComponent).join("/")}`);
    fullName = repo.full_name; defaultBranch = repo.default_branch; isPrivate = repo.private;
    const branchData = await fetchProvider<Array<{ name: string; commit: { sha: string } }>>(provider, token, `/repos/${parts.map(encodeURIComponent).join("/")}/branches?per_page=100`);
    branches = branchData.map((branch) => branch.name);
    const ref = selectedBranch(branches);
    const treeRef = branchData.find((branch) => branch.name === ref)?.commit.sha ?? ref;
    const tree = await fetchProvider<{ tree?: Array<{ path: string; type: string }>; truncated?: boolean }>(provider, token, `/repos/${parts.map(encodeURIComponent).join("/")}/git/trees/${encodeURIComponent(treeRef)}?recursive=1`);
    const yamlFiles = (tree.tree ?? []).filter((entry) => entry.type === "blob" && composeFile(entry.path)).map((entry) => entry.path);
    composeFiles = yamlFiles.slice(0, 500);
    treeTruncated = Boolean(tree.truncated) || yamlFiles.length > 500;
  } else if (provider.provider === "gitlab") {
    const project = encodeURIComponent(parts.join("/"));
    const repo = await fetchProvider<{ path_with_namespace: string; web_url: string; default_branch: string | null; visibility: string }>(provider, token, `/projects/${project}`);
    fullName = repo.path_with_namespace; defaultBranch = repo.default_branch ?? "main"; isPrivate = repo.visibility !== "public";
    const branchData = await fetchProvider<Array<{ name: string }>>(provider, token, `/projects/${project}/repository/branches?per_page=100`);
    branches = branchData.map((branch) => branch.name);
    const ref = selectedBranch(branches);
    const tree: Array<{ path: string; type: string }> = [];
    for (let page = 1; page <= 10; page++) {
      const chunk = await fetchProvider<Array<{ path: string; type: string }>>(provider, token, `/projects/${project}/repository/tree?recursive=true&ref=${encodeURIComponent(ref)}&per_page=100&page=${page}`);
      tree.push(...chunk);
      if (chunk.length < 100) break;
      if (page === 10) treeTruncated = true;
    }
    const yamlFiles = tree.filter((entry) => entry.type === "blob" && composeFile(entry.path)).map((entry) => entry.path);
    composeFiles = yamlFiles.slice(0, 500);
    treeTruncated ||= yamlFiles.length > 500;
  } else if (provider.provider === "gitea") {
    if (parts.length < 2) throw new Error("La URL del repositorio Gitea debe incluir propietario y repositorio");
    const repoPath = parts.map(encodeURIComponent).join("/");
    const repo = await fetchProvider<{ full_name: string; html_url: string; default_branch: string; private: boolean }>(provider, token, `/repos/${repoPath}`);
    fullName = repo.full_name; defaultBranch = repo.default_branch || "main"; isPrivate = repo.private;
    const branchData = await fetchProvider<Array<{ name: string; commit: { sha: string } }>>(provider, token, `/repos/${repoPath}/branches?limit=50`);
    branches = branchData.map((branch) => branch.name);
    const ref = selectedBranch(branches);
    const branch = branchData.find((item) => item.name === ref);
    if (branch) {
      const tree = await fetchProvider<{ tree?: Array<{ path: string; type: string }>; truncated?: boolean }>(provider, token, `/repos/${repoPath}/git/trees/${encodeURIComponent(branch.commit.sha)}?recursive=true`);
      const yamlFiles = (tree.tree ?? []).filter((entry) => entry.type === "blob" && composeFile(entry.path)).map((entry) => entry.path);
      composeFiles = yamlFiles.slice(0, 500);
      treeTruncated = Boolean(tree.truncated) || yamlFiles.length > 500;
    }
  } else {
    if (parts.length !== 2) throw new Error("La URL de Bitbucket debe tener formato workspace/repositorio");
    const repoPath = parts.map(encodeURIComponent).join("/");
    const repo = await fetchProvider<{ full_name: string; links: { html: { href: string } }; mainbranch?: { name: string }; is_private: boolean }>(provider, token, `/repositories/${repoPath}`);
    fullName = repo.full_name; defaultBranch = repo.mainbranch?.name ?? "main"; isPrivate = repo.is_private;
    let next: string | null = `${providerApiBase(provider)}/repositories/${repoPath}/refs/branches?pagelen=100`;
    while (next && branches.length < 500) {
      const page: { data: { values: Array<{ name: string }>; next?: string }; response: Response } = await requestJson<{ values: Array<{ name: string }>; next?: string }>(providerPaginationUrl(provider, next), apiHeaders(provider, token));
      branches.push(...page.data.values.map((branch) => branch.name));
      next = page.data.next ?? null;
    }
    const ref = selectedBranch(branches);
    // Bitbucket's source endpoint is paginated and path-based. Traverse directories with a hard cap.
    const queue = [""];
    let visited = 0;
    while (queue.length && visited < 80 && composeFiles.length < 500) {
      const directory = queue.shift()!;
      const sourcePath = directory ? `${encodeURIComponent(ref)}/${directory.split("/").map(encodeURIComponent).join("/")}` : encodeURIComponent(ref);
      let cursor: string | null = `${providerApiBase(provider)}/repositories/${repoPath}/src/${sourcePath}/?pagelen=100`;
      visited++;
      while (cursor) {
        const page: { data: { values: Array<{ path: string; type: string }>; next?: string }; response: Response } = await requestJson<{ values: Array<{ path: string; type: string }>; next?: string }>(providerPaginationUrl(provider, cursor), apiHeaders(provider, token));
        for (const entry of page.data.values) {
          if (["commit_directory", "directory"].includes(entry.type)) queue.push(entry.path);
          else if (composeFile(entry.path)) composeFiles.push(entry.path);
        }
        cursor = page.data.next ?? null;
      }
    }
    treeTruncated = queue.length > 0 || visited >= 80;
  }

  return { repository: repositoryUrl.replace(/\.git$/i, "").replace(/\/$/, ""), fullName, private: isPrivate, defaultBranch, branches, composeFiles: [...new Set(composeFiles)].sort(), treeTruncated };
}

export async function readGitRepositoryComposeFile(providerId: string, repositoryUrl: string, branch: string, composePath: string): Promise<string> {
  const { provider, token } = await gitProviderAccessToken(providerId);
  if (!validWebRepository(provider, repositoryUrl)) throw new Error("El repositorio no pertenece al proveedor Git conectado");
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith("/") || branch.endsWith(".lock") || branch.includes("@{")) throw new Error("La rama Git no es válida");
  const pathParts = composePath.split("/");
  if (composePath.length > 512 || composePath.startsWith("/") || pathParts.some((part) => !part || part === "." || part === "..") || !/\.ya?ml$/i.test(composePath)) throw new Error("La ruta del archivo Compose no es válida");

  const parts = repositoryParts(provider, repositoryUrl);
  const decodeFile = (file: { type?: string; encoding?: string; content?: string }) => {
    if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") throw new Error("El proveedor Git no devolvió un archivo Compose legible");
    const yaml = Buffer.from(file.content.replace(/\s/g, ""), "base64").toString("utf8");
    if (!yaml.trim() || Buffer.byteLength(yaml, "utf8") > 2_000_000) throw new Error("El archivo Compose está vacío o supera el máximo de 2 MB");
    return yaml;
  };

  if (provider.provider === "github") {
    const repositoryPath = parts.map(encodeURIComponent).join("/");
    const filePath = pathParts.map(encodeURIComponent).join("/");
    const file = await fetchProvider<{ type?: string; encoding?: string; content?: string }>(provider, token, `/repos/${repositoryPath}/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
    return decodeFile(file);
  }
  if (provider.provider === "gitlab") {
    const project = encodeURIComponent(parts.join("/"));
    const filePath = encodeURIComponent(composePath);
    const file = await fetchProvider<{ file_name?: string; encoding?: string; content?: string }>(provider, token, `/projects/${project}/repository/files/${filePath}?ref=${encodeURIComponent(branch)}`);
    return decodeFile({ type: "file", encoding: file.encoding, content: file.content });
  }
  if (provider.provider === "gitea") {
    const repositoryPath = parts.map(encodeURIComponent).join("/");
    const filePath = pathParts.map(encodeURIComponent).join("/");
    const file = await fetchProvider<{ type?: string; encoding?: string; content?: string }>(provider, token, `/repos/${repositoryPath}/contents/${filePath}?ref=${encodeURIComponent(branch)}`);
    return decodeFile(file);
  }

  const repositoryPath = parts.map(encodeURIComponent).join("/");
  const filePath = pathParts.map(encodeURIComponent).join("/");
  const url = providerPaginationUrl(provider, `${providerApiBase(provider)}/repositories/${repositoryPath}/src/${encodeURIComponent(branch)}/${filePath}`);
  let response: Response;
  const headers = apiHeaders(provider, token);
  headers.set("Accept", "text/plain");
  try { response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new Error("No se pudo contactar con el proveedor Git desde Vessel"); }
  if (!response.ok) {
    if (response.status === 401) throw new Error("El proveedor rechazó la conexión; vuelve a autorizarla");
    if (response.status === 403 || response.status === 429) throw new Error("El proveedor denegó o limitó la lectura del archivo Compose");
    if (response.status === 404) throw new Error("No se encontró el archivo Compose en esa rama");
    throw new Error(`El proveedor Git respondió con HTTP ${response.status}`);
  }
  const yaml = await response.text();
  if (!yaml.trim() || Buffer.byteLength(yaml, "utf8") > 2_000_000) throw new Error("El archivo Compose está vacío o supera el máximo de 2 MB");
  return yaml;
}

export function gitCloneCredential(provider: GitProviderKind, token: string, username: string) {
  return `AUTHORIZATION: basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
}
