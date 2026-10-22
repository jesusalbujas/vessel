import { createHash, createHmac } from "node:crypto";

type EcrCredentials = {
  url: string;
  region?: string | null;
  username: string;
  password: string;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

/** Exchange an AWS IAM key pair for ECR's short-lived Docker login token. */
export async function ecrDockerCredentials(credentials: EcrCredentials): Promise<{ username: string; password: string }> {
  const registry = new URL(credentials.url);
  const match = registry.hostname.match(/^(\d{12})\.dkr\.ecr\.([a-z0-9-]+-\d)\.amazonaws\.com(\.cn)?$/i);
  const region = credentials.region?.trim() || match?.[2];
  if (!match || !region || match[2] !== region) throw new Error("La configuración del registry ECR no contiene una cuenta y región válidas");
  if (!credentials.username || !credentials.password) throw new Error("Faltan las credenciales IAM de AWS para ECR");

  const accountId = match[1];
  const suffix = match[3] ?? "";
  const host = `api.ecr.${region}.amazonaws.com${suffix}`;
  const target = "AmazonEC2ContainerRegistry_V20150921.GetAuthorizationToken";
  const body = JSON.stringify({ registryIds: [accountId] });
  const payloadHash = sha256(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = amzDate.slice(0, 8);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date;x-amz-target";
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${date}/${region}/ecr/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(`AWS4${credentials.password}`, date);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "ecr");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.username}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  let response: Response;
  try {
    response = await fetch(`https://${host}/`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/x-amz-json-1.1",
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        "x-amz-target": target,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("AWS ECR tardó demasiado en emitir credenciales de descarga");
    throw new Error("No fue posible conectar con AWS ECR desde Vessel");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("AWS rechazó las credenciales IAM o no tienen permiso ecr:GetAuthorizationToken");
    throw new Error(`AWS ECR no pudo emitir credenciales (HTTP ${response.status})`);
  }

  const payload = await response.json().catch(() => null) as { authorizationData?: Array<{ authorizationToken?: string; proxyEndpoint?: string }> } | null;
  const token = payload?.authorizationData?.find((item) => item.proxyEndpoint?.toLowerCase().includes(registry.hostname))?.authorizationToken ?? payload?.authorizationData?.[0]?.authorizationToken;
  if (!token) throw new Error("AWS ECR respondió sin un token de autorización válido");
  const decoded = Buffer.from(token, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 1) throw new Error("AWS ECR devolvió un token en formato inesperado");
  return { username: decoded.slice(0, separator), password: decoded.slice(separator + 1) };
}
