export type PublishedPort = { published?: string | number; target: string | number; protocol?: string; host_ip?: string; mode?: string };
export type ContainerNetwork = {
  name: string; project: string; service: string; running: boolean;
  bindings: Record<string, Array<{ HostIp: string; HostPort: string }> | null> | null;
  ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null> | null;
};

function overlaps(a = "", b = "") {
  return ["", "0.0.0.0", "::"].includes(a) || ["", "0.0.0.0", "::"].includes(b) || a === b;
}

export function portConflict(ports: PublishedPort[], containers: ContainerNetwork[], project: string): string | null {
  for (const port of ports) {
    if (!port.published || String(port.published) === "0") continue;
    const [first, last = first] = String(port.published).split("-").map(Number);
    for (const container of containers) {
      if (!container.running || container.project === project) continue;
      for (const [key, bindings] of Object.entries(container.ports ?? {})) {
        if (key.split("/")[1] !== (port.protocol ?? "tcp")) continue;
        if (bindings?.some((binding) => Number(binding.HostPort) >= first && Number(binding.HostPort) <= last && overlaps(port.host_ip, binding.HostIp))) {
          return `Host port ${port.published}/${port.protocol ?? "tcp"} is already used by container ${container.name.replace(/^\//, "")}.`;
        }
      }
    }
  }
  return null;
}

export function missingPublishedPort(container: ContainerNetwork): string | null {
  for (const [key, requested] of Object.entries(container.bindings ?? {})) {
    for (const binding of requested ?? []) {
      const actual = container.ports?.[key];
      if (!container.running || !actual?.some((port) => (!binding.HostPort || binding.HostPort === "0" || port.HostPort === binding.HostPort) && overlaps(binding.HostIp, port.HostIp))) {
        return `Container ${container.name.replace(/^\//, "")} did not publish port ${binding.HostPort || "dynamic"} (${key}).`;
      }
    }
  }
  return null;
}
