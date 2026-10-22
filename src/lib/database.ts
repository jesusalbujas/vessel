import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

type DatabaseEnv = Record<string, string>;

function envMap(values: string[] | undefined): DatabaseEnv {
  return Object.fromEntries((values ?? []).map((item) => {
    const separator = item.indexOf("=");
    return separator < 0 ? [item, ""] : [item.slice(0, separator), item.slice(separator + 1)];
  }));
}

function validIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(value);
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function connectionFromContainer(env: DatabaseEnv) {
  const host = process.env.VESSEL_DATABASE_HOST?.trim() || env.DB_HOST || env.POSTGRES_HOST || env.ADEMPIERE_DB_SERVER;
  const port = Number(process.env.VESSEL_DATABASE_PORT || env.DB_PORT || env.POSTGRES_PORT || env.ADEMPIERE_DB_PORT || 5432);
  if (!host) throw new Error("No se encontró el host PostgreSQL; configura VESSEL_DATABASE_HOST o DB_HOST en el contenedor origen");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("El puerto PostgreSQL no es válido");
  const user = env.DB_USER || env.POSTGRES_USER || env.ADEMPIERE_DB_USER;
  const password = env.DB_PASSWORD || env.POSTGRES_PASSWORD || env.ADEMPIERE_DB_PASSWORD || "";
  const sourceDatabase = env.ADEMPIERE_DB_NAME || env.DB_NAME || env.POSTGRES_DB;
  if (!sourceDatabase || !user || !password) throw new Error("El contenedor origen no tiene completas las credenciales de PostgreSQL");
  return { host, port, user, password, sourceDatabase };
}

async function runPostgres(command: string, args: string[], connection: { host: string; port: number; user: string; password: string }, onLine?: (line: string) => void, continueOnError = false) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, PGPASSWORD: connection.password } });
    let stdout = "";
    let stderr = "";
    const consume = (chunk: Buffer, target: "stdout" | "stderr") => {
      const text = chunk.toString();
      if (target === "stdout") stdout += text; else stderr += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) onLine?.(line);
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !continueOnError) return reject(new Error(`${command} no pudo completar la operación${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`));
      resolve({ stdout, stderr, code: exitCode });
    });
  });
}

export async function clonePostgresDatabase(containerEnv: string[] | undefined, targetDatabase: string, onProgress?: (patch: { step: "dumping" | "creating_database" | "restoring"; message: string; percent: number; currentTable?: string | null; errors?: number }) => void): Promise<{ sourceDatabase: string; port: number; errors: number }> {
  if (!validIdentifier(targetDatabase)) throw new Error("El nombre de la base destino no es válido");
  const connection = connectionFromContainer(envMap(containerEnv));
  const baseArgs = ["-h", connection.host, "-p", String(connection.port), "-U", connection.user];
  const targetExists = await runPostgres("psql", [...baseArgs, "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${targetDatabase.replaceAll("'", "''")}'`], connection);
  if (targetExists.stdout.trim() === "1") throw new Error(`La base de datos ${targetDatabase} ya existe`);

  const workDir = await mkdtemp(`${tmpdir()}/vessel-clone-`);
  const dumpFile = `${workDir}/database.dump`;
  let errors = 0;
  try {
    onProgress?.({ step: "dumping", message: "Generando respaldo de la base origen", percent: 10 });
    await runPostgres("pg_dump", [...baseArgs, "-d", connection.sourceDatabase, "--format=custom", "--no-owner", "--no-privileges", "--file", dumpFile], connection);
    onProgress?.({ step: "creating_database", message: `Creando BD ${targetDatabase}`, percent: 34 });
    await runPostgres("psql", [...baseArgs, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${quoteIdentifier(targetDatabase)} OWNER ${quoteIdentifier(connection.user)}`], connection);
    onProgress?.({ step: "restoring", message: "Restaurando datos y estructura", percent: 42, errors });
    await runPostgres("pg_restore", [...baseArgs, "-d", targetDatabase, "--no-owner", "--no-privileges", "--verbose", dumpFile], connection, (line) => {
      const table = line.match(/processing data for table ["']?([^"']+)["']?/i)?.[1];
      if (table) onProgress?.({ step: "restoring", message: `Restaurando tabla ${table}`, percent: 55, currentTable: table, errors });
      if (/pg_restore:\s*error:/i.test(line)) {
        errors += 1;
        onProgress?.({ step: "restoring", message: `Restaurando con ${errors} errores reportados`, percent: 55, currentTable: table ?? null, errors });
      }
    }, true);
    onProgress?.({ step: "restoring", message: errors ? `Restauración terminada con ${errors} errores reportados` : "Restauración terminada", percent: 90, currentTable: null, errors });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  return { sourceDatabase: connection.sourceDatabase, port: connection.port, errors };
}
