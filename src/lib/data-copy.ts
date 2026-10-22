import { clonePostgresData } from "@/lib/database";
import { cloneMysqlData } from "@/lib/mysql";

export type DataEngine = "postgresql" | "mysql" | "mariadb";
export type DataCopyStep = "dumping" | "creating_resource" | "restoring";
export type DataCopyProgress = { step: DataCopyStep; message: string; percent: number; currentItem?: string | null; errors?: number };
export type DataSource = {
  engine: DataEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  resourceName: string;
  nameVariable?: string;
  urlVariable?: string;
  urlPrefix?: string;
};

type DataCopyAdapter = (source: DataSource, targetName: string, onProgress?: (patch: DataCopyProgress) => void) => Promise<{ sourceName: string; errors: number }>;
const dataCopyAdapters: Record<DataEngine, DataCopyAdapter> = {
  postgresql: clonePostgresData,
  mysql: cloneMysqlData,
  mariadb: cloneMysqlData,
};

function envMap(values: string[] | undefined): Map<string, string> {
  return new Map((values ?? []).map((item) => {
    const separator = item.indexOf("=");
    return separator < 0 ? [item, ""] : [item.slice(0, separator), item.slice(separator + 1)];
  }));
}

function first(env: Map<string, string>, keys: string[]): { key: string; value: string } | null {
  for (const key of keys) {
    const value = env.get(key);
    if (value) return { key, value };
  }
  return null;
}

function parseConnectionUrl(value: string): { engine: DataEngine; host: string; port?: number; user: string; password: string; resourceName: string; prefix: string } | null {
  const jdbc = value.match(/^(jdbc:)(.*)$/i);
  const prefix = jdbc?.[1] ?? "";
  try {
    const url = new URL(jdbc ? jdbc[2] : value);
    const protocol = url.protocol.toLowerCase();
    const engine: DataEngine | null = protocol.startsWith("postgres") ? "postgresql" : protocol.startsWith("mariadb") ? "mariadb" : protocol.startsWith("mysql") ? "mysql" : null;
    if (!engine) return null;
    return {
      engine,
      host: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      resourceName: decodeURIComponent(url.pathname.replace(/^\//, "").split("/")[0] ?? ""),
      prefix,
    };
  } catch {
    return null;
  }
}

export function detectDataSource(values: string[] | undefined): DataSource | null {
  const env = envMap(values);
  const connectionUrl = first(env, ["DATABASE_URL", "DB_URL", "JDBC_URL", "ADEMPIERE_DB_URL"]);
  const parsedUrl = connectionUrl ? parseConnectionUrl(connectionUrl.value) : null;
  const declaredEngine = (first(env, ["DATA_ENGINE", "DATABASE_TYPE", "DB_ENGINE", "DB_TYPE", "DB_DRIVER"])?.value ?? "").toLowerCase();
  const mysqlSignals = ["MYSQL_HOST", "MYSQL_DATABASE", "MARIADB_HOST", "MARIADB_DATABASE"].some((key) => env.has(key));
  const postgresSignals = ["PGHOST", "PGDATABASE", "POSTGRES_HOST", "POSTGRES_DB", "ADEMPIERE_DB_SERVER", "ADEMPIERE_DB_NAME"].some((key) => env.has(key));
  const engine: DataEngine | null = parsedUrl?.engine
    ?? (declaredEngine.includes("maria") ? "mariadb" : declaredEngine.includes("mysql") ? "mysql" : declaredEngine.includes("postgres") || declaredEngine.includes("pgsql") ? "postgresql" : null)
    ?? (mysqlSignals ? (env.has("MARIADB_HOST") || env.has("MARIADB_DATABASE") ? "mariadb" : "mysql") : postgresSignals ? "postgresql" : null);
  if (!engine) return null;

  const mysql = engine === "mysql" || engine === "mariadb";
  const prefix = mysql ? ["MYSQL", "MARIADB"] : ["POSTGRES", "PG"];
  const host = process.env.VESSEL_DATABASE_HOST?.trim()
    || parsedUrl?.host
    || first(env, [...prefix.map((item) => `${item}_HOST`), ...(mysql ? [] : ["PGHOST"]), "DB_HOST", "DATABASE_HOST", "ADEMPIERE_DB_SERVER"])?.value
    || "";
  const configuredPort = process.env.VESSEL_DATABASE_PORT?.trim();
  const envPort = first(env, [...prefix.map((item) => `${item}_PORT`), ...(mysql ? [] : ["PGPORT"]), "DB_PORT", "DATABASE_PORT", "ADEMPIERE_DB_PORT"])?.value;
  const port = Number(configuredPort || parsedUrl?.port || envPort || (mysql ? 3306 : 5432));
  const user = parsedUrl?.user || first(env, [...prefix.map((item) => `${item}_USER`), "DB_USER", "DATABASE_USER", "PGUSER", "ADEMPIERE_DB_USER"])?.value || "";
  const password = parsedUrl?.password || first(env, [...prefix.map((item) => `${item}_PASSWORD`), "DB_PASSWORD", "DATABASE_PASSWORD", "PGPASSWORD", "ADEMPIERE_DB_PASSWORD"])?.value || "";
  const nameKeyOrder = mysql
    ? [engine === "mariadb" ? "MARIADB_DATABASE" : "MYSQL_DATABASE", "DB_NAME", "DATABASE_NAME"]
    : ["POSTGRES_DB", "PGDATABASE", "ADEMPIERE_DB_NAME", "DB_NAME", "DATABASE_NAME"];
  const nameVariable = first(env, nameKeyOrder);
  const resourceName = parsedUrl?.resourceName || nameVariable?.value || "";
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !password || !resourceName) return null;
  return {
    engine, host, port, user, password, resourceName,
    nameVariable: nameVariable?.key,
    urlVariable: parsedUrl ? connectionUrl?.key : undefined,
    urlPrefix: parsedUrl?.prefix,
  };
}

export function validDataResourceName(engine: DataEngine, value: string): boolean {
  const maxLength = engine === "postgresql" ? 63 : 64;
  return value.length <= maxLength && /^[A-Za-z_][A-Za-z0-9_$-]*$/.test(value);
}

export function updateDataResourceName(source: DataSource, originalEnv: string[] | undefined, overrides: string[] | undefined, targetName: string): string[] {
  const values = overrides === undefined ? [...(originalEnv ?? [])] : [...overrides];
  if (source.urlVariable) {
    const original = envMap(originalEnv).get(source.urlVariable);
    const current = values.find((item) => item.startsWith(`${source.urlVariable}=`))?.slice(source.urlVariable.length + 1) || original;
    if (!current) throw new Error("No se pudo actualizar la variable de conexión del recurso clonado");
    const jdbc = current.match(/^(jdbc:)(.*)$/i);
    const prefix = jdbc?.[1] ?? source.urlPrefix ?? "";
    const url = new URL(jdbc ? jdbc[2] : current);
    url.pathname = `/${targetName}`;
    const updated = `${source.urlVariable}=${prefix}${url.toString()}`;
    const index = values.findIndex((item) => item.startsWith(`${source.urlVariable}=`));
    if (index >= 0) values[index] = updated; else values.push(updated);
  }
  if (source.nameVariable) {
    const index = values.findIndex((item) => item.startsWith(`${source.nameVariable}=`));
    if (index >= 0) values[index] = `${source.nameVariable}=${targetName}`;
    else values.push(`${source.nameVariable}=${targetName}`);
  }
  if (!source.nameVariable && !source.urlVariable) throw new Error("No se pudo identificar qué variable de entorno apunta al recurso de datos");
  return values;
}

export async function cloneDataResource(values: string[] | undefined, targetName: string, onProgress?: (patch: DataCopyProgress) => void) {
  const source = detectDataSource(values);
  if (!source) throw new Error("No se encontró una conexión de datos compatible y completa en el contenedor origen");
  if (!validDataResourceName(source.engine, targetName)) throw new Error("El nombre del recurso de datos no es válido para el motor detectado");
  const result = await dataCopyAdapters[source.engine](source, targetName, onProgress);
  return { source, ...result };
}
