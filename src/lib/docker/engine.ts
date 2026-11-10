import { spawn } from "node:child_process";
import { dockerGet } from "./client";
import type { DockerEngineInfo } from "./types";

let composeVersionPromise: Promise<string | null> | null = null;

export function getDockerEngineInfo(): Promise<DockerEngineInfo> {
  return dockerGet<DockerEngineInfo>("info");
}

export async function getDockerComposeVersion(): Promise<string | null> {
	if (composeVersionPromise) return composeVersionPromise;
	composeVersionPromise = new Promise((resolve) => {
    const child = spawn("docker", ["compose", "version", "--short"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 3000);
    child.stdout.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(0, 256); });
    child.once("error", () => { clearTimeout(timeout); resolve(null); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return resolve(null);
      const version = output.trim().match(/v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?/i)?.[0];
      resolve(version ?? null);
    });
  });
	return composeVersionPromise;
}
