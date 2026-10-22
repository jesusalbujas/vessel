export type ServiceStatus = "unknown" | "starting" | "running" | "stopped" | "unhealthy";
export type ServiceCategory = "application" | "database" | "external";
export type RestartPolicy = "no" | "always" | "unless-stopped" | "on-failure";

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
  ready: boolean;
  image: string | null;
  imageVersion: string | null;
  networks: string[];
  environmentVariables: string[];
  restartPolicy: { name: RestartPolicy; maxRetries: number };
  composeProject?: string | null;
  composeService?: string | null;
};
