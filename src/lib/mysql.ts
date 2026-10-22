import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { DataCopyProgress, DataSource } from "@/lib/data-copy";

async function runMysql(command: string, args: string[], source: DataSource, inputFile?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, MYSQL_PWD: source.password },
      stdio: [inputFile ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let output = "";
    let errorOutput = "";
    child.stdout?.on("data", (chunk: Buffer) => { output = (output + chunk.toString()).slice(-12000); });
    child.stderr?.on("data", (chunk: Buffer) => { errorOutput = (errorOutput + chunk.toString()).slice(-12000); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`${command} no pudo completar la copia de datos${errorOutput.trim() ? `: ${errorOutput.trim().slice(-500)}` : ""}`));
      else resolve(output);
    });
    if (inputFile && child.stdin) createReadStream(inputFile).pipe(child.stdin);
  });
}

export async function cloneMysqlData(source: DataSource, targetName: string, onProgress?: (patch: DataCopyProgress) => void): Promise<{ sourceName: string; errors: number }> {
  const connectionArgs = ["--protocol=tcp", "--host", source.host, "--port", String(source.port), "--user", source.user];
  const exists = await runMysql("mariadb", [...connectionArgs, "--batch", "--skip-column-names", "--execute", `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${targetName.replaceAll("'", "''")}'`], source);
  if (exists.trim()) throw new Error(`El recurso de datos ${targetName} ya existe`);
  const workDir = await mkdtemp(`${tmpdir()}/vessel-data-copy-`);
  const dumpFile = `${workDir}/data.sql`;
  try {
    onProgress?.({ step: "dumping", message: `Generando copia desde ${source.resourceName}`, percent: 10 });
    await runMysql("mariadb-dump", [...connectionArgs, "--single-transaction", "--routines", "--events", "--triggers", "--hex-blob", "--skip-lock-tables", "--result-file", dumpFile, source.resourceName], source);
    onProgress?.({ step: "creating_resource", message: `Preparando el recurso ${targetName}`, percent: 34 });
    const quotedName = `\`${targetName.replaceAll("`", "``")}\``;
    await runMysql("mariadb", [...connectionArgs, "--execute", `CREATE DATABASE ${quotedName}`], source);
    onProgress?.({ step: "restoring", message: "Copiando estructura y registros", percent: 55 });
    await runMysql("mariadb", [...connectionArgs, targetName], source, dumpFile);
    onProgress?.({ step: "restoring", message: "Copia de datos terminada", percent: 90, currentItem: null, errors: 0 });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  return { sourceName: source.resourceName, errors: 0 };
}
