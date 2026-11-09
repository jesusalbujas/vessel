import { readFile } from "node:fs/promises";
import { registryCredentialsForImage } from "../control-plane";
import { ecrDockerCredentials } from "../ecr";
import { registryServerAddress, type RegistryProvider } from "../registries";
import { dockerApiBase, dockerHeaders, isDockerConfigured } from "./client";

type RegistryCredentials = {
  provider: RegistryProvider;
  url: string;
  baseUrl?: string | null;
  region?: string | null;
  username: string;
  password: string;
};

async function toDockerCredentials(credentials: RegistryCredentials): Promise<{ username: string; password: string }> {
  return credentials.provider === "ecr" ? ecrDockerCredentials(credentials) : credentials;
}

export async function testDockerRegistryCredentials(credentials: RegistryCredentials): Promise<void> {
  if (!isDockerConfigured()) throw new Error("El backend de Docker no está configurado; no se pueden probar las credenciales");
  const dockerCredentials = await toDockerCredentials(credentials);
  let response: Response;
  try {
    response = await fetch(`${dockerApiBase()}/auth`, {
      method: "POST",
      headers: dockerHeaders(true),
      body: JSON.stringify({ username: dockerCredentials.username, password: dockerCredentials.password, serveraddress: registryServerAddress(credentials.provider, credentials.url, credentials.baseUrl) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("El Engine tardó demasiado en validar el registry");
    throw new Error("No fue posible conectar con Docker Engine para validar el registry");
  }
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) throw new Error("Docker Engine rechazó las credenciales; verifica usuario, token y permisos de lectura");
  throw new Error(`Docker Engine no pudo validar el registry (HTTP ${response.status})`);
}

export async function registryAuthHeaders(image: string, baseHeaders: Record<string, string>): Promise<Record<string, string>> {
  const savedCredentials = registryCredentialsForImage(image);
  if (savedCredentials) {
    const dockerCredentials = await toDockerCredentials(savedCredentials);
    const registryAuth = { username: dockerCredentials.username, password: dockerCredentials.password, serveraddress: registryServerAddress(savedCredentials.provider, savedCredentials.url, savedCredentials.baseUrl) };
    return { ...baseHeaders, "X-Registry-Auth": Buffer.from(JSON.stringify(registryAuth)).toString("base64") };
  }

  const configPath = process.env.DOCKER_CONFIG_JSON_PATH;
  if (!configPath) return baseHeaders;
  try {
    const config = JSON.parse(await readFile(configPath, "utf8")) as { auths?: Record<string, Record<string, unknown>> };
    const firstPart = image.split("/")[0];
    const registry = firstPart.includes(".") || firstPart.includes(":") || firstPart === "localhost" ? firstPart : "https://index.docker.io/v1/";
    const auth = config.auths?.[registry] ?? config.auths?.[`https://${registry}`] ?? config.auths?.[`https://${registry}/v1/`];
    if (!auth) return baseHeaders;
    const authConfig: Record<string, unknown> = { ...auth, serveraddress: registry };
    if (typeof authConfig.auth === "string") {
      const decoded = Buffer.from(authConfig.auth, "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator > 0) {
        authConfig.username = decoded.slice(0, separator);
        authConfig.password = decoded.slice(separator + 1);
        delete authConfig.auth;
      }
    }
    return { ...baseHeaders, "X-Registry-Auth": Buffer.from(JSON.stringify(authConfig)).toString("base64") };
  } catch {
    return baseHeaders;
  }
}
