import type { ContainerRuntimeSettings, RestartPolicy } from "../services";

export type RestartPolicyConfig = { name: RestartPolicy; maxRetries?: number };

export type DockerContainer = {
  Id: string;
  Names?: string[];
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
  Image?: string;
  ImageID?: string;
  Ports?: Array<{ IP?: string; PublicPort?: number; PrivatePort?: number; Type?: string }>;
  Created?: number;
  Mounts?: Array<{ Type?: string; Name?: string }>;
};

export type DockerContainerDetails = {
  Name?: string;
  Config?: Record<string, unknown> & { Env?: string[]; Image?: string; Cmd?: string[] | null; Entrypoint?: string[] | null; WorkingDir?: string; User?: string; Tty?: boolean; OpenStdin?: boolean };
  HostConfig?: Record<string, unknown> & { PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }>>; RestartPolicy?: { Name?: string; MaximumRetryCount?: number }; LogConfig?: { Type?: string; Config?: Record<string, string> }; Memory?: number; NanoCpus?: number; CpuQuota?: number; CpuPeriod?: number };
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string; GlobalIPv6Address?: string; [key: string]: unknown }> };
  State?: { Running?: boolean };
  Mounts?: Array<{ Type?: string; Name?: string }>;
};

export type DockerImage = {
  Id: string;
  RepoTags?: string[] | null;
  RepoDigests?: string[] | null;
  Created?: number;
  Size?: number;
};

export type DockerVolume = {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
  CreatedAt?: string;
  Labels?: Record<string, string>;
};

export type DockerNetwork = {
  Id: string;
  Name: string;
  Driver?: string;
  Scope?: string;
  Attachable?: boolean;
  Created?: string;
  Labels?: Record<string, string>;
  EnableIPv6?: boolean;
  IPAM?: { Driver?: string; Config?: Array<{ Subnet?: string; Gateway?: string; IPRange?: string }> };
  Containers?: Record<string, { Name?: string; IPv4Address?: string; IPv6Address?: string; MacAddress?: string }>;
};

export type DockerAction = "start" | "stop" | "restart" | "kill" | "pause" | "unpause";

export type DockerEngineInfo = {
  Name?: string;
  ServerVersion?: string;
  ComposeVersion?: string | null;
  OperatingSystem?: string;
  OSType?: string;
  Architecture?: string;
  NCPU?: number;
  MemTotal?: number;
  DockerRootDir?: string;
  Driver?: string;
  Containers?: number;
  ContainersRunning?: number;
  ContainersPaused?: number;
  ContainersStopped?: number;
  Images?: number;
  Swarm?: { LocalNodeState?: string; ControlAvailable?: boolean; Nodes?: number; NodeID?: string };
};

export type { ContainerRuntimeSettings, RestartPolicy };
