"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, ArrowRight, Boxes, CirclePause, CirclePlay, Container, Cpu, Database, HardDrive, Images, MemoryStick, Network, RefreshCw, Server } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type ContainerSummary = { name: string; status: string; composeProject: string | null };
type ProjectSummary = { name: string; containers: string[] };
type EngineInfo = { Name?: string; ServerVersion?: string; ComposeVersion?: string | null; OperatingSystem?: string; OSType?: string; Architecture?: string; NCPU?: number; MemTotal?: number; DockerRootDir?: string; Driver?: string; Swarm?: { LocalNodeState?: string; Nodes?: number } };
type Snapshot = { containers: ContainerSummary[]; projects: ProjectSummary[]; images: number | null; volumes: number | null; networks: number | null; host: string; engine: EngineInfo | null };
type HostMetrics = { cpu: { percent: number }; memory: { used: number; total: number }; disk: { used: number; total: number; source: string }; sampledAt: string };
const percent = (used: number, total: number) => total > 0 ? Math.min(100, Math.max(0, 100 * used / total)) : 0;
const formatSize = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function Trend({ values }: { values: number[] }) {
  const samples = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const points = samples.map((value, index) => `${index * 100 / (samples.length - 1)},${36 - value * .3}`).join(" ");
  return <svg className="overview-trend" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
}

function UsageGauge({ value, label }: { value: number | null; label: string }) {
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const safeValue = value == null ? 0 : Math.min(100, Math.max(0, value));
  return <svg className="usage-gauge" viewBox="0 0 112 112" role="img" aria-label={value == null ? `${label}: unavailable` : `${label}: ${value.toFixed(1)}%`}>
    <circle className="usage-gauge-track" cx="56" cy="56" r={radius} />
    <circle className="usage-gauge-value" cx="56" cy="56" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - safeValue / 100)} />
    <text className="usage-gauge-number" x="56" y="56">{value == null ? "—" : value.toFixed(1)}</text>
    {value == null ? null : <text className="usage-gauge-percent" x="56" y="76">%</text>}
  </svg>;
}

export default function OverviewPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(15);
  const [history, setHistory] = useState<{ cpu: number[]; memory: number[]; disk: number[] }>({ cpu: [], memory: [], disk: [] });

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (typeof payload?.data?.refreshIntervalSeconds === "number") setRefreshIntervalSeconds(payload.data.refreshIntervalSeconds); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadMetrics() {
      try {
        const response = await fetch("/api/metrics", { cache: "no-store" });
        if (!response.ok) throw new Error("Metrics unavailable");
        const next = await response.json() as HostMetrics;
        if (cancelled) return;
        setMetrics(next);
        setHistory((current) => ({
          cpu: [...current.cpu, next.cpu.percent].slice(-24),
          memory: [...current.memory, percent(next.memory.used, next.memory.total)].slice(-24),
          disk: [...current.disk, percent(next.disk.used, next.disk.total)].slice(-24),
        }));
      } catch { if (!cancelled) setMetrics(null); }
    }
    void loadMetrics();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadMetrics(); }, refreshIntervalSeconds * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refreshIntervalSeconds]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const paths = ["/api/services", "/api/compose", "/api/resources?type=images", "/api/resources?type=volumes", "/api/resources?type=networks", "/api/resources?type=engine"];
        const results = await Promise.all(paths.map(async (path) => {
          try {
            const response = await fetch(path, { cache: "no-store" });
            return response.ok ? await response.json() : null;
          } catch { return null; }
        }));
        if (cancelled) return;
        const [services, compose, images, volumes, networks, engine] = results;
        if (!services) { setSnapshot(null); setError(true); return; }
        setSnapshot({
          containers: services.data ?? [],
          projects: compose?.data ?? [],
          images: Array.isArray(images?.data) ? images.data.length : null,
          volumes: Array.isArray(volumes?.data) ? volumes.data.length : null,
          networks: Array.isArray(networks?.data) ? networks.data.length : null,
          host: services.meta?.host ?? "",
          engine: engine?.data ?? null,
        });
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [refreshIndex]);

  const running = snapshot?.containers.filter((container) => container.status === "running" || container.status === "unhealthy").length ?? 0;
  const stopped = snapshot?.containers.filter((container) => container.status === "stopped").length ?? 0;
  const paused = snapshot?.containers.filter((container) => container.status === "paused").length ?? 0;
  const unhealthy = snapshot?.containers.filter((container) => container.status === "unhealthy").length ?? 0;
  const standalone = snapshot?.containers.filter((container) => !container.composeProject).length ?? 0;
  const statusTotal = running + stopped + paused;
  const runningAngle = statusTotal ? 360 * running / statusTotal : 0;
  const usage = [
    { id: "cpu", icon: Cpu, label: "CPU", value: metrics?.cpu.percent ?? null, detail: es ? "Carga actual del host" : "Current host load", values: history.cpu },
    { id: "memory", icon: MemoryStick, label: es ? "Memoria" : "Memory", value: metrics ? percent(metrics.memory.used, metrics.memory.total) : null, detail: metrics ? `${formatSize(metrics.memory.used)} / ${formatSize(metrics.memory.total)}` : "—", values: history.memory },
    { id: "disk", icon: HardDrive, label: es ? "Almacenamiento" : "Storage", value: metrics ? percent(metrics.disk.used, metrics.disk.total) : null, detail: metrics ? `${formatSize(metrics.disk.used)} / ${formatSize(metrics.disk.total)}` : "—", values: history.disk },
  ];
  const counts = [
    { href: "/compose", icon: Boxes, label: es ? "Proyectos Compose" : "Compose projects", value: snapshot?.projects.length },
    { href: "/containers", icon: Container, label: es ? "Contenedores" : "Containers", value: snapshot?.containers.length },
    { href: "/images", icon: Images, label: es ? "Imágenes" : "Images", value: snapshot?.images },
    { href: "/volumes", icon: Database, label: es ? "Volúmenes" : "Volumes", value: snapshot?.volumes },
    { href: "/networks", icon: Network, label: es ? "Redes" : "Networks", value: snapshot?.networks },
  ];

  return <main className="module-main overview-page">
    <div className="overview-heading"><div><span className="overview-eyebrow">VESSEL / {es ? "RESUMEN" : "OVERVIEW"}</span><h1>{es ? "Tu espacio de trabajo" : "Your workspace"}</h1><p>{es ? "Una vista clara del estado de Docker. Entra a un proyecto o recurso cuando necesites operarlo." : "A clear view of Docker health. Open a project or resource when you need to manage it."}</p></div><button className="overview-refresh" type="button" disabled={loading} onClick={() => setRefreshIndex((value) => value + 1)}><RefreshCw size={16} className={loading ? "spinning" : ""} />{es ? "Actualizar" : "Refresh"}</button></div>
    {error ? <div className="overview-error" role="alert"><Server size={22} /><div><strong>{es ? "Docker no está disponible" : "Docker is unavailable"}</strong><p>{es ? "No se pudo leer el estado de los contenedores. Revisa la conexión del backend y vuelve a intentar." : "Could not read container state. Check the backend connection and try again."}</p></div></div> : null}
    <section className="overview-status" aria-label={es ? "Estado del entorno" : "Environment status"}><div className="overview-status-head"><span className="overview-status-icon"><Server size={20} /></span><div><strong>Docker Engine{snapshot?.engine?.ServerVersion ? ` · ${snapshot.engine.ServerVersion}` : ""}</strong><span>{snapshot?.engine?.Name || snapshot?.host ? `Host · ${snapshot.engine?.Name || snapshot.host}` : es ? "Host local" : "Local host"}</span></div><span className={`overview-health ${error ? "is-error" : ""}`}><i />{loading ? (es ? "Consultando" : "Checking") : error ? (es ? "Sin conexión" : "Disconnected") : (es ? "Conectado" : "Connected")}</span></div><div className="overview-status-body"><div className="overview-donut" style={{ background: `conic-gradient(var(--accent) 0deg ${runningAngle}deg, var(--overview-stop) ${runningAngle}deg 360deg)` }}><span>{loading ? "—" : snapshot?.containers.length ?? 0}<small>{es ? "total" : "total"}</small></span></div><div className="overview-health-grid"><div><CirclePlay size={19} /><strong>{loading ? "—" : running}</strong><span>{unhealthy ? `${unhealthy} ${es ? "con healthcheck fallido" : "unhealthy"}` : es ? "En ejecución" : "Running"}</span></div><div><CirclePause size={19} /><strong>{loading ? "—" : stopped + paused}</strong><span>{paused ? `${paused} ${es ? "pausados" : "paused"}` : es ? "Detenidos" : "Stopped"}</span></div><div><Boxes size={19} /><strong>{loading ? "—" : standalone}</strong><span>{es ? "Fuera de Compose" : "Standalone"}</span></div></div></div><div className="overview-engine-details"><div><span>{es ? "Versión Docker Engine" : "Docker Engine version"}</span><strong>{snapshot?.engine?.ServerVersion ? `v${snapshot.engine.ServerVersion.replace(/^v/, "")}` : "—"}</strong></div><div><span>{es ? "Docker Compose CLI · Vessel" : "Docker Compose CLI · Vessel"}</span><strong title={es ? "Versión de Compose disponible en el runtime de Vessel; Docker Engine no expone la versión del plugin instalado en el host." : "Compose version available in the Vessel runtime; Docker Engine does not expose the host's installed plugin version."}>{snapshot?.engine?.ComposeVersion ? `v${snapshot.engine.ComposeVersion.replace(/^v/, "")}` : es ? "No disponible en Vessel" : "Not available in Vessel"}</strong></div><div><span>{es ? "Plataforma" : "Platform"}</span><strong>{snapshot?.engine ? `${snapshot.engine.OperatingSystem ?? snapshot.engine.OSType ?? "Docker"} · ${snapshot.engine.Architecture ?? "—"}` : "—"}</strong></div><div><span>{es ? "CPU / memoria del Engine" : "Engine CPU / memory"}</span><strong>{snapshot?.engine ? `${snapshot.engine.NCPU ?? "—"} ${es ? "núcleos" : "cores"} · ${snapshot.engine.MemTotal ? formatSize(snapshot.engine.MemTotal) : "—"}` : "—"}</strong></div><div><span>{es ? "Driver de almacenamiento" : "Storage driver"}</span><strong>{snapshot?.engine?.Driver ?? "—"}</strong></div><div><span>{es ? "Directorio Docker" : "Docker root directory"}</span><strong title={snapshot?.engine?.DockerRootDir}>{snapshot?.engine?.DockerRootDir ?? "—"}</strong></div>{snapshot?.engine?.Swarm?.LocalNodeState && snapshot.engine.Swarm.LocalNodeState !== "inactive" ? <div><span>{es ? "Swarm" : "Swarm"}</span><strong>{snapshot.engine.Swarm.LocalNodeState}{typeof snapshot.engine.Swarm.Nodes === "number" ? ` · ${snapshot.engine.Swarm.Nodes} ${es ? "nodos" : "nodes"}` : ""}</strong></div> : null}</div></section>
    <div className="overview-section-title"><div><h2><Activity size={19} />{es ? "Uso del equipo" : "Host usage"}</h2><p>{es ? "CPU y memoria del host; almacenamiento del sistema de archivos donde Vessel guarda sus datos." : "Host CPU and memory; storage of the filesystem holding Vessel data."}</p></div></div>
    <section className="overview-usage-grid" aria-label={es ? "Métricas del equipo" : "Host metrics"}>{usage.map(({ id, icon: Icon, label, value, detail, values }) => <article className={`overview-usage-card usage-${id}`} key={id}><div className="overview-usage-head"><span><Icon size={18} />{label}</span><span className="usage-live-dot" title={es ? "Métrica en vivo" : "Live metric"} /></div><div className="overview-usage-content"><UsageGauge value={value} label={label} /><div className="overview-usage-meta"><strong>{detail}</strong><span>{id === "cpu" ? (es ? "Uso del procesador" : "Processor utilization") : id === "memory" ? (es ? "Memoria usada" : "Memory in use") : (es ? "Espacio ocupado" : "Space used")}</span><Trend values={values} /></div></div></article>)}</section>
    <div className="overview-section-title"><div><h2><Container size={19} />{es ? "Explorar recursos" : "Explore resources"}</h2><p>{es ? "Cada sección tiene su propio espacio de gestión." : "Each section has its own management workspace."}</p></div></div>
    <section className="overview-resource-grid" aria-label={es ? "Recursos Docker" : "Docker resources"}>{counts.map(({ href, icon: Icon, label, value }) => <Link className="overview-resource" href={href} key={href}><span className="overview-resource-icon"><Icon size={21} /></span><strong>{loading || value == null ? "—" : value}</strong><span>{label}</span><ArrowRight className="overview-resource-arrow" size={17} /></Link>)}</section>
    <div className="overview-section-title project-title"><div><h2><Boxes size={19} />{es ? "Proyectos Compose" : "Compose projects"}</h2><p>{es ? "Servicios agrupados por proyecto." : "Services grouped by project."}</p></div><Link href="/compose">{es ? "Ver proyectos" : "View projects"}<ArrowRight size={16} /></Link></div>
    <section className="overview-projects">{loading ? <p>{es ? "Cargando proyectos…" : "Loading projects…"}</p> : snapshot?.projects.length ? snapshot.projects.slice(0, 4).map((project) => <Link href="/compose" className="overview-project" key={project.name}><span className="overview-project-icon"><Boxes size={19} /></span><span><strong>{project.name}</strong><small>{project.containers.length} {es ? project.containers.length === 1 ? "contenedor" : "contenedores" : project.containers.length === 1 ? "container" : "containers"}</small></span><ArrowRight size={17} /></Link>) : <div className="overview-empty"><Boxes size={23} /><strong>{es ? "Todavía no hay proyectos Compose" : "No Compose projects yet"}</strong><span>{es ? "Puedes gestionar contenedores individuales o crear un proyecto nuevo." : "Manage standalone containers or create a new project."}</span><Link href="/compose">{es ? "Ir a Compose" : "Open Compose"}<ArrowRight size={15} /></Link></div>}</section>
  </main>;
}
