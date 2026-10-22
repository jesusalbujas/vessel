"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, ArrowRight, Boxes, CirclePause, CirclePlay, Container, Cpu, Database, HardDrive, Images, MemoryStick, Network, RefreshCw, Server } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type ContainerSummary = { name: string; status: string; composeProject: string | null };
type ProjectSummary = { name: string; containers: string[] };
type Snapshot = { containers: ContainerSummary[]; projects: ProjectSummary[]; images: number | null; volumes: number | null; networks: number | null; host: string };
type HostMetrics = { cpu: { percent: number }; memory: { used: number; total: number }; disk: { used: number; total: number; source: string }; sampledAt: string };
const percent = (used: number, total: number) => total > 0 ? Math.min(100, Math.max(0, 100 * used / total)) : 0;
const formatSize = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function Trend({ values }: { values: number[] }) {
  const samples = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const points = samples.map((value, index) => `${index * 100 / (samples.length - 1)},${36 - value * .3}`).join(" ");
  return <svg className="overview-trend" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
}

export default function OverviewPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);
  const [history, setHistory] = useState<{ cpu: number[]; memory: number[]; disk: number[] }>({ cpu: [], memory: [], disk: [] });

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
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void loadMetrics(); }, 12000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(false);
      try {
        const paths = ["/api/services", "/api/compose", "/api/resources?type=images", "/api/resources?type=volumes", "/api/resources?type=networks"];
        const results = await Promise.all(paths.map(async (path) => {
          try {
            const response = await fetch(path, { cache: "no-store" });
            return response.ok ? await response.json() : null;
          } catch { return null; }
        }));
        if (cancelled) return;
        const [services, compose, images, volumes, networks] = results;
        if (!services) { setSnapshot(null); setError(true); return; }
        setSnapshot({
          containers: services.data ?? [],
          projects: compose?.data ?? [],
          images: Array.isArray(images?.data) ? images.data.length : null,
          volumes: Array.isArray(volumes?.data) ? volumes.data.length : null,
          networks: Array.isArray(networks?.data) ? networks.data.length : null,
          host: services.meta?.host ?? "",
        });
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [refreshIndex]);

  const running = snapshot?.containers.filter((container) => container.status === "running").length ?? 0;
  const stopped = snapshot?.containers.filter((container) => container.status === "stopped").length ?? 0;
  const standalone = snapshot?.containers.filter((container) => !container.composeProject).length ?? 0;
  const statusTotal = running + stopped;
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
    <section className="overview-status" aria-label={es ? "Estado del entorno" : "Environment status"}><div className="overview-status-head"><span className="overview-status-icon"><Server size={20} /></span><div><strong>Docker Engine</strong><span>{snapshot?.host ? `Host · ${snapshot.host}` : es ? "Host local" : "Local host"}</span></div><span className={`overview-health ${error ? "is-error" : ""}`}><i />{loading ? (es ? "Consultando" : "Checking") : error ? (es ? "Sin conexión" : "Disconnected") : (es ? "Conectado" : "Connected")}</span></div><div className="overview-status-body"><div className="overview-donut" style={{ background: `conic-gradient(var(--accent) 0deg ${runningAngle}deg, var(--overview-stop) ${runningAngle}deg 360deg)` }}><span>{loading ? "—" : snapshot?.containers.length ?? 0}<small>{es ? "total" : "total"}</small></span></div><div className="overview-health-grid"><div><CirclePlay size={19} /><strong>{loading ? "—" : running}</strong><span>{es ? "En ejecución" : "Running"}</span></div><div><CirclePause size={19} /><strong>{loading ? "—" : stopped}</strong><span>{es ? "Detenidos" : "Stopped"}</span></div><div><Boxes size={19} /><strong>{loading ? "—" : standalone}</strong><span>{es ? "Fuera de Compose" : "Standalone"}</span></div></div></div></section>
    <div className="overview-section-title"><div><h2><Activity size={19} />{es ? "Uso del equipo" : "Host usage"}</h2><p>{es ? "CPU y memoria del host; almacenamiento del sistema de archivos donde Vessel guarda sus datos." : "Host CPU and memory; storage of the filesystem holding Vessel data."}</p></div></div>
    <section className="overview-usage-grid" aria-label={es ? "Métricas del equipo" : "Host metrics"}>{usage.map(({ id, icon: Icon, label, value, detail, values }) => <article className="overview-usage-card" key={id}><div className="overview-usage-head"><span><Icon size={19} />{label}</span><strong>{value == null ? "—" : `${value.toFixed(1)}%`}</strong></div><div className="overview-usage-track"><span style={{ width: `${value ?? 0}%` }} /></div><Trend values={values} /><small>{detail}</small></article>)}</section>
    <div className="overview-section-title"><div><h2><Container size={19} />{es ? "Explorar recursos" : "Explore resources"}</h2><p>{es ? "Cada sección tiene su propio espacio de gestión." : "Each section has its own management workspace."}</p></div></div>
    <section className="overview-resource-grid" aria-label={es ? "Recursos Docker" : "Docker resources"}>{counts.map(({ href, icon: Icon, label, value }) => <Link className="overview-resource" href={href} key={href}><span className="overview-resource-icon"><Icon size={21} /></span><strong>{loading || value == null ? "—" : value}</strong><span>{label}</span><ArrowRight className="overview-resource-arrow" size={17} /></Link>)}</section>
    <div className="overview-section-title project-title"><div><h2><Boxes size={19} />{es ? "Proyectos Compose" : "Compose projects"}</h2><p>{es ? "Servicios agrupados por proyecto." : "Services grouped by project."}</p></div><Link href="/compose">{es ? "Ver proyectos" : "View projects"}<ArrowRight size={16} /></Link></div>
    <section className="overview-projects">{loading ? <p>{es ? "Cargando proyectos…" : "Loading projects…"}</p> : snapshot?.projects.length ? snapshot.projects.slice(0, 4).map((project) => <Link href="/compose" className="overview-project" key={project.name}><span className="overview-project-icon"><Boxes size={19} /></span><span><strong>{project.name}</strong><small>{project.containers.length} {es ? project.containers.length === 1 ? "contenedor" : "contenedores" : project.containers.length === 1 ? "container" : "containers"}</small></span><ArrowRight size={17} /></Link>) : <div className="overview-empty"><Boxes size={23} /><strong>{es ? "Todavía no hay proyectos Compose" : "No Compose projects yet"}</strong><span>{es ? "Puedes gestionar contenedores individuales o crear un proyecto nuevo." : "Manage standalone containers or create a new project."}</span><Link href="/compose">{es ? "Ir a Compose" : "Open Compose"}<ArrowRight size={15} /></Link></div>}</section>
  </main>;
}
