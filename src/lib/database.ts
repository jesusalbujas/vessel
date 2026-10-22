import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { DataCopyProgress, DataSource } from "@/lib/data-copy";

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

async function runPostgres(command: string, args: string[], connection: DataSource, onLine?: (line: string) => void, continueOnError = false) {
  return new Promise<{ stdout: string; stderr: string; code: number }>((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, PGPASSWORD: connection.password } });
    let stdout = "";
    let stderr = "";
    const consume = (chunk: Buffer, target: "stdout" | "stderr") => {
      const text = chunk.toString();
      if (target === "stdout") stdout += text.slice(-16000); else stderr = (stderr + text).slice(-16000);
      for (const line of text.split(/\r?\n/).filter(Boolean)) onLine?.(line);
    };
    child.stdout.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
    child.on("error", reject);
    child.on("close", (code) => {
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !continueOnError) return reject(new Error(`${command} no pudo completar la copia de datos${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`));
      resolve({ stdout, stderr, code: exitCode });
    });
  });
}

export async function clonePostgresData(source: DataSource, targetName: string, onProgress?: (patch: DataCopyProgress) => void): Promise<{ sourceName: string; errors: number }> {
  const baseArgs = ["-h", source.host, "-p", String(source.port), "-U", source.user];
  const targetExists = await runPostgres("psql", [...baseArgs, "-d", "postgres", "-tAc", `SELECT 1 FROM pg_database WHERE datname = '${targetName.replaceAll("'", "''")}'`], source);
  if (targetExists.stdout.trim() === "1") throw new Error(`El recurso de datos ${targetName} ya existe`);
  const workDir = await mkdtemp(`${tmpdir()}/vessel-data-copy-`);
  const dumpFile = `${workDir}/data.dump`;
  let errors = 0;
  try {
    onProgress?.({ step: "dumping", message: `Generando copia desde ${source.resourceName}`, percent: 10 });
    await runPostgres("pg_dump", [...baseArgs, "-d", source.resourceName, "--format=custom", "--no-owner", "--no-privileges", "--file", dumpFile], source);
    onProgress?.({ step: "creating_resource", message: `Preparando el recurso ${targetName}`, percent: 34 });
    await runPostgres("psql", [...baseArgs, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE ${quoteIdentifier(targetName)} OWNER ${quoteIdentifier(source.user)}`], source);
    onProgress?.({ step: "restoring", message: "Copiando estructura y registros", percent: 42, currentItem: null, errors });
    await runPostgres("pg_restore", [...baseArgs, "-d", targetName, "--no-owner", "--no-privileges", "--verbose", dumpFile], source, (line) => {
      const currentItem = line.match(/processing data for table ["']?([^"']+)["']?/i)?.[1];
      if (currentItem) onProgress?.({ step: "restoring", message: `Copiando ${currentItem}`, percent: 55, currentItem, errors });
      if (/pg_restore:\s*error:/i.test(line)) {
        errors += 1;
        onProgress?.({ step: "restoring", message: `La copia continúa con ${errors} avisos`, percent: 55, currentItem: currentItem ?? null, errors });
      }
    }, true);
    onProgress?.({ step: "restoring", message: errors ? `Copia terminada con ${errors} avisos` : "Copia de datos terminada", percent: 90, currentItem: null, errors });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  return { sourceName: source.resourceName, errors };
}
