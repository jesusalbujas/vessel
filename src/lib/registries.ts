export const REGISTRY_PROVIDERS = ["dockerhub", "ecr", "digitalocean", "github", "gitlab", "quay", "proget", "azure", "generic"] as const;
export type RegistryProvider = (typeof REGISTRY_PROVIDERS)[number];

export type RegistryInput = {
  provider?: string;
  name?: string;
  url?: string;
  baseUrl?: string | null;
  region?: string | null;
  username?: string;
  password?: string;
};

const fixedEndpoints: Partial<Record<RegistryProvider, string>> = {
  dockerhub: "https://index.docker.io/v1/",
  ecr: undefined,
  digitalocean: "https://registry.digitalocean.com",
  github: "https://ghcr.io",
  quay: "https://quay.io",
  proget: undefined,
};

export function prepareRegistry(input: RegistryInput) {
  if (input.provider && !REGISTRY_PROVIDERS.includes(input.provider as RegistryProvider)) throw new Error("El proveedor de registry seleccionado no está soportado");
  const provider = (input.provider as RegistryProvider | undefined) ?? "generic";
  const name = input.name?.trim().slice(0, 120) ?? "";
  const username = input.username?.trim().slice(0, 256) ?? "";
  const password = input.password ?? "";
  const region = input.region?.trim().toLowerCase() ?? "";
  let url = fixedEndpoints[provider] ?? input.url?.trim() ?? "";
  let baseUrl = input.baseUrl?.trim() ?? "";

  if (provider === "azure") {
    const host = url.replace(/^https?:\/\//i, "").replace(/\/$/, "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,48}\.azurecr\.io$/.test(host)) throw new Error("Indica el host del registro, por ejemplo miempresa.azurecr.io");
    url = `https://${host}`;
  }
  if (provider === "gitlab" && !url) url = "https://registry.gitlab.com";
  if (!name || !username || !password) throw new Error("Completa el nombre, usuario y token o contraseña");
  if (username.length > 256 || password.length > 8192 || url.length > 2048) throw new Error("Uno de los campos supera el tamaño permitido");
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("La URL del registry no es válida"); }
  const pathAllowed = provider === "proget";
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (!pathAllowed && parsed.pathname !== "/" && !(provider === "dockerhub" && parsed.pathname === "/v1/"))) {
    throw new Error(pathAllowed ? "Usa una URL HTTP(S) de ProGet sin credenciales, parámetros ni fragmentos" : "Usa la URL HTTP(S) del registry, sin credenciales, ruta, parámetros ni fragmentos");
  }
  if (provider !== "dockerhub" && provider !== "proget") url = `${parsed.protocol}//${parsed.host}`;
  if (provider === "ecr") {
    const host = parsed.host.toLowerCase();
    const ecr = host.match(/^(\d{12})\.dkr\.ecr\.([a-z0-9-]+-\d)\.amazonaws\.com(?:\.cn)?$/);
    if (!ecr) throw new Error("El endpoint ECR debe tener formato <cuenta>.dkr.ecr.<región>.amazonaws.com");
    if (!/^[a-z0-9-]+-\d$/.test(region) || region !== ecr[2]) throw new Error("La región indicada debe coincidir con la región del endpoint ECR");
    url = `${parsed.protocol}//${parsed.host}`;
  }
  if (provider === "proget") {
    if (!parsed.pathname || parsed.pathname === "/") throw new Error("Indica la URL del feed Docker de ProGet, incluida su ruta");
    if (!baseUrl) throw new Error("Indica también la URL base del servidor ProGet");
    let parsedBase: URL;
    try { parsedBase = new URL(baseUrl); } catch { throw new Error("La URL base de ProGet no es válida"); }
    if (!/^https?:$/.test(parsedBase.protocol) || parsedBase.username || parsedBase.password || parsedBase.pathname !== "/" || parsedBase.search || parsedBase.hash || parsedBase.host !== parsed.host) {
      throw new Error("La URL base debe usar el mismo host que el feed de ProGet y no incluir rutas ni credenciales");
    }
    baseUrl = `${parsedBase.protocol}//${parsedBase.host}`;
    url = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/$/, "")}`;
  }
  return { provider, name, url, baseUrl: baseUrl || null, region: region || null, username, password };
}

export function registryServerAddress(provider: string, url: string, baseUrl?: string | null): string {
  if (provider === "dockerhub") return "https://index.docker.io/v1/";
  return new URL(baseUrl || url).host;
}

export function normalizeRegistryHost(host: string): string {
  const normalized = host.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  return normalized === "docker.io" || normalized === "index.docker.io" ? "docker.io" : normalized;
}
