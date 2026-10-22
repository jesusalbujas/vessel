export type ServiceStatus = "unknown" | "starting" | "running" | "stopped" | "unhealthy" | "paused";
export type ServiceCategory = "application" | "database" | "external";
export type RestartPolicy = "no" | "always" | "unless-stopped" | "on-failure";
export type DataCloneEngine = "postgresql" | "mysql" | "mariadb";

/** Runtime settings exposed by Vessel for a Docker container. */
export type ContainerRuntimeSettings = {
  command: string[];
  entrypoint: string[];
  workingDir: string;
  user: string;
  tty: boolean;
  openStdin: boolean;
  logDriver: string;
  logOptions: Record<string, string>;
  memoryLimitMiB: number | null;
  cpuLimit: number | null;
};

export type Service = {
  id: string;
  name: string;
  port: number;
  host: string;
  url: string | null;
  environment: "latest" | "test" | "candidate" | "full";
  status: ServiceStatus;
  owner: string;
  source: "catalog" | "vessel";
  category: ServiceCategory;
  statusSince: string | null;
  databaseTarget: string | null;
  dataCloneEngine: DataCloneEngine | null;
  ready: boolean;
  image: string | null;
  imageVersion: string | null;
  networks: string[];
  environmentVariables: string[];
  restartPolicy: { name: RestartPolicy; maxRetries: number };
  runtimeSettings?: ContainerRuntimeSettings;
  composeProject?: string | null;
  composeService?: string | null;
  createdAt?: number | null;
  ipAddresses?: string[];
  publishedPorts?: string[];
  managedBy?: string;
};
