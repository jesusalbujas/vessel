import { AsyncLocalStorage } from "node:async_hooks";

type DockerRequestContext = { engineId: string | null; cliEnvironment?: Partial<NodeJS.ProcessEnv>; signal?: AbortSignal };
const context = new AsyncLocalStorage<DockerRequestContext>();

export function currentDockerEngineId(): string | null {
  return context.getStore()?.engineId ?? null;
}

export function currentDockerRequestSignal(): AbortSignal | undefined {
  return context.getStore()?.signal;
}

export function dockerCliEnvironment(): Partial<NodeJS.ProcessEnv> {
  return context.getStore()?.cliEnvironment ?? {};
}

export function runWithDockerEngine<T>(engineId: string | null, operation: () => T, signal?: AbortSignal): T {
  return context.run({ engineId, signal }, operation);
}

export function runWithDockerCliEnvironment<T>(engineId: string, cliEnvironment: Partial<NodeJS.ProcessEnv>, operation: () => T): T {
  return context.run({ engineId, cliEnvironment, signal: context.getStore()?.signal }, operation);
}
