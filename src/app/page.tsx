"use client";

import Link from "next/link";
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Activity, ArrowDownToLine, ArrowRight, Boxes, CircleAlert, CircleCheck, CirclePause, CirclePlay, Container, Cpu, Database, FolderKanban, FolderOpen, HardDrive, Images, MemoryStick, Monitor, Network, RefreshCw, Server } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { OverviewLoadingSkeleton } from "@/app/components/LoadingSkeletons";
import VesselSelect from "@/app/components/VesselSelect";

type ContainerSummary = { name: string; status: string; composeProject: string | null };
type ProjectSummary = { name: string; containers: string[] };
type WorkspaceSummary = { id: string; name: string; serviceCount: number };
type EngineInfo = { Name?: string; ServerVersion?: string; ComposeVersion?: string | null; OperatingSystem?: string; OSType?: string; Architecture?: string; NCPU?: number; MemTotal?: number; DockerRootDir?: string; Driver?: string; Swarm?: { LocalNodeState?: string; Nodes?: number } };
type DockerUpdate = { currentVersion: string; latestVersion: string; updateAvailable: boolean; releaseUrl: string; publishedAt: string | null; checkedAt: string };
type Snapshot = { containers: ContainerSummary[]; projects: ProjectSummary[]; workspaces: WorkspaceSummary[]; images: number | null; volumes: number | null; networks: number | null; host: string; engine: EngineInfo | null };
type DockerDiskMetrics = { images: number; containers: number; volumes: number; buildCache: number; total: number };
type IoMetrics = { blockRead: number; blockWrite: number; networkIn: number; networkOut: number; containers: number; failedContainers: number };
type RemoteServerSummary = { id: string; name: string; host: string };
type RemoteMetric = { server: RemoteServerSummary; metrics: HostMetrics | null; error: boolean };
type HostMetrics = { cpu: { percent: number }; memory: { used: number; total: number }; disk: { used: number; total: number; source: string }; dockerDisk: DockerDiskMetrics | null; dockerDiskError: string | null; io: IoMetrics | null; ioError: string | null; sampledAt: string; remoteServers?: RemoteServerSummary[]; server?: RemoteServerSummary };
type MetricSample = { value: number; at: number };
type IoSample = IoMetrics & { at: number };
type HistoryRange = "15m" | "1h" | "6h" | "24h";
type MetricsHistory = { cpu: MetricSample[]; memory: MetricSample[]; io: IoSample[] };
const METRICS_HISTORY_KEY = "vessel-host-metrics-history-v1";
const METRICS_HISTORY_MAX_AGE = 24 * 60 * 60 * 1000;
const METRICS_HISTORY_MAX_SAMPLES = 1440;
const HISTORY_RANGE_MS: Record<HistoryRange, number> = { "15m": 15 * 60_000, "1h": 60 * 60_000, "6h": 6 * 60 * 60_000, "24h": 24 * 60 * 60_000 };
const percent = (used: number, total: number) => total > 0 ? Math.min(100, Math.max(0, 100 * used / total)) : 0;
const formatSize = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
const formatIoSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1000 && index < units.length - 1) { value /= 1000; index++; }
  return `${value.toFixed(index < 2 ? 0 : 2)} ${units[index]}`;
};

function sampleAge(at: number, es: boolean) {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 8) return es ? "Ahora" : "Now";
  if (seconds < 60) return es ? `Hace ${seconds} s` : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return es ? `Hace ${minutes} min` : `${minutes}m ago`;
  return new Intl.DateTimeFormat(es ? "es-VE" : "en-US", { hour: "2-digit", minute: "2-digit" }).format(at);
}

function Trend({ samples, label, es, range }: { samples: MetricSample[]; label: string; es: boolean; range: HistoryRange }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const chartWidth = 260;
  const plotLeft = 30;
  const plotRight = 256;
  const plotTop = 9;
  const plotBottom = 91;
  const now = Date.now();
  const rangeMs = HISTORY_RANGE_MS[range];
  const inRange = samples.filter((sample) => sample.at >= now - rangeMs);
  const visible = inRange.length <= 240 ? inRange : Array.from({ length: 240 }, (_, index) => inRange[Math.round(index * (inRange.length - 1) / 239)]);
  const points = visible.map((sample, index) => ({
    x: visible.length < 2 ? (plotLeft + plotRight) / 2 : plotLeft + (plotRight - plotLeft) * index / (visible.length - 1),
    y: plotBottom - Math.min(100, Math.max(0, sample.value)) * (plotBottom - plotTop) / 100,
  }));
  const activeIndex = selectedIndex == null ? Math.max(0, visible.length - 1) : Math.min(selectedIndex, Math.max(0, visible.length - 1));
  const activeSample = visible[activeIndex];
  const activePoint = points[activeIndex];
  const linePath = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const areaPath = points.length > 1 ? `${linePath} L${points.at(-1)?.x},${plotBottom} L${points[0].x},${plotBottom} Z` : "";
  const average = visible.length ? visible.reduce((sum, sample) => sum + sample.value, 0) / visible.length : null;
  const peak = visible.length ? Math.max(...visible.map((sample) => sample.value)) : null;

  function onChartPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (visible.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const chartRatio = (event.clientX - bounds.left) / bounds.width;
    const ratio = Math.min(1, Math.max(0, (chartRatio * chartWidth - plotLeft) / (plotRight - plotLeft)));
    setSelectedIndex(Math.round(ratio * (visible.length - 1)));
  }

  function onChartKeyDown(event: ReactKeyboardEvent<SVGSVGElement>) {
    if (!visible.length || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    setSelectedIndex((current) => Math.min(visible.length - 1, Math.max(0, (current ?? visible.length - 1) + direction)));
  }

  const rangeStart = visible.length ? new Date(visible[0].at) : new Date(now - rangeMs);
  const rangeEnd = visible.length ? new Date(visible.at(-1)!.at) : new Date(now);
  const timeLabel = (date: Date) => new Intl.DateTimeFormat(es ? "es-VE" : "en-US", range === "24h" ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" } : { hour: "2-digit", minute: "2-digit" }).format(date);
  return <div className="overview-trend-wrap" role="group" aria-label={`${label} ${es ? "en el tiempo" : "over time"}`}>
    <div className="overview-trend-readout" aria-live="polite"><span>{activeSample ? sampleAge(activeSample.at, es) : (es ? "Esperando muestras" : "Waiting for samples")}</span><strong>{activeSample ? `${activeSample.value.toFixed(1)}%` : "—"}</strong></div>
    <svg className="overview-trend" viewBox={`0 0 ${chartWidth} 104`} preserveAspectRatio="none" role="img" tabIndex={0} aria-label={activeSample ? `${label}: ${activeSample.value.toFixed(1)}% · ${sampleAge(activeSample.at, es)}. ${es ? "Usa las flechas para revisar" : "Use arrow keys to inspect"}.` : `${label}: ${es ? "sin muestras en este rango" : "no samples in this range"}`} onPointerMove={onChartPointer} onPointerDown={onChartPointer} onPointerLeave={() => setSelectedIndex(null)} onKeyDown={onChartKeyDown} onFocus={() => { if (visible.length) setSelectedIndex((current) => current ?? visible.length - 1); }} onBlur={() => setSelectedIndex(null)}>
      {[0, 50, 100].map((tick) => { const y = plotBottom - tick * (plotBottom - plotTop) / 100; return <g key={tick}><line className="overview-trend-gridline" x1={plotLeft} x2={plotRight} y1={y} y2={y} /><text className="overview-trend-y-label" x="0" y={y + 3}>{tick}%</text></g>; })}
      {areaPath ? <path className="overview-trend-area" d={areaPath} /> : null}
      {linePath ? <path className="overview-trend-line" d={linePath} /> : null}
      {activePoint ? <><line className="overview-trend-cursor" x1={activePoint.x} x2={activePoint.x} y1={plotTop} y2={plotBottom} /><circle className="overview-trend-active-point" cx={activePoint.x} cy={activePoint.y} r="4" /></> : null}
      {points.map((point, index) => <circle key={`${visible[index].at}-${index}`} className="overview-trend-point" cx={point.x} cy={point.y} r={index === activeIndex ? 3.3 : 1.7}><title>{`${visible[index].value.toFixed(1)}% · ${sampleAge(visible[index].at, es)}`}</title></circle>)}
    </svg>
    <div className="overview-trend-axis"><span>{timeLabel(rangeStart)}</span><span>{visible.length ? (es ? `${visible.length} muestras` : `${visible.length} samples`) : (es ? "Sin historial" : "No history")}</span><span>{timeLabel(rangeEnd)}</span></div>
    <div className="overview-trend-stats"><span>{es ? "Promedio" : "Average"}<strong>{average == null ? "—" : `${average.toFixed(1)}%`}</strong></span><span>{es ? "Máximo" : "Peak"}<strong>{peak == null ? "—" : `${peak.toFixed(1)}%`}</strong></span></div>
  </div>;
}

function appendSample(samples: MetricSample[], sample: MetricSample) {
  const last = samples.at(-1);
  const sameMinute = last && Math.floor(last.at / 60_000) === Math.floor(sample.at / 60_000);
  const next = sameMinute ? [...samples.slice(0, -1), sample] : [...samples, sample];
  return next.filter((item) => item.at >= sample.at - METRICS_HISTORY_MAX_AGE).slice(-METRICS_HISTORY_MAX_SAMPLES);
}

function appendIoSample(samples: IoSample[], sample: IoSample) {
  const last = samples.at(-1);
  const sameMinute = last && Math.floor(last.at / 60_000) === Math.floor(sample.at / 60_000);
  const next = sameMinute ? [...samples.slice(0, -1), sample] : [...samples, sample];
  return next.filter((item) => item.at >= sample.at - METRICS_HISTORY_MAX_AGE).slice(-METRICS_HISTORY_MAX_SAMPLES);
}

function IoHistoryChart({ samples, firstKey, secondKey, firstLabel, secondLabel, es, range }: { samples: IoSample[]; firstKey: "blockRead" | "networkIn"; secondKey: "blockWrite" | "networkOut"; firstLabel: string; secondLabel: string; es: boolean; range: HistoryRange }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const now = Date.now();
  const visible = samples.filter((sample) => sample.at >= now - HISTORY_RANGE_MS[range]);
  const plot = { left: 34, right: 316, top: 9, bottom: 88 };
  const firstBaseline = visible[0]?.[firstKey] ?? 0;
  const secondBaseline = visible[0]?.[secondKey] ?? 0;
  const periodValues = visible.flatMap((sample) => [Math.max(0, sample[firstKey] - firstBaseline), Math.max(0, sample[secondKey] - secondBaseline)]);
  const scaleMax = Math.max(1, ...periodValues);
  const pointsFor = (key: typeof firstKey | typeof secondKey) => visible.map((sample, index) => ({
    x: visible.length < 2 ? (plot.left + plot.right) / 2 : plot.left + (plot.right - plot.left) * index / (visible.length - 1),
    y: plot.bottom - Math.max(0, sample[key] - (visible[0]?.[key] ?? 0)) * (plot.bottom - plot.top) / scaleMax,
  }));
  const firstPoints = pointsFor(firstKey);
  const secondPoints = pointsFor(secondKey);
  const path = (points: Array<{ x: number; y: number }>) => points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const activeIndex = selectedIndex == null ? Math.max(0, visible.length - 1) : Math.min(selectedIndex, visible.length - 1);
  const active = visible[activeIndex];
  function selectPoint(event: ReactPointerEvent<SVGSVGElement>) {
    if (visible.length < 2) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    setSelectedIndex(Math.round(ratio * (visible.length - 1)));
  }
  const sinceStart = (key: typeof firstKey | typeof secondKey) => {
    if (!active) return 0;
    const baseline = visible[0]?.[key] ?? 0;
    return Math.max(0, active[key] - baseline);
  };
  return <div className="overview-io-chart" role="group" aria-label={`${firstLabel} / ${secondLabel}`}>
    <div className="overview-io-readout"><span>{active ? sampleAge(active.at, es) : es ? "Recopilando historial" : "Collecting history"}</span><strong><i className="io-color-read" />{formatIoSize(sinceStart(firstKey))}<i className="io-color-write" />{formatIoSize(sinceStart(secondKey))}</strong></div>
    <svg viewBox="0 0 330 102" preserveAspectRatio="none" role="img" tabIndex={0} aria-label={`${firstLabel} ${active ? formatIoSize(sinceStart(firstKey)) : "—"}; ${secondLabel} ${active ? formatIoSize(sinceStart(secondKey)) : "—"}`} onPointerMove={selectPoint} onPointerDown={selectPoint} onPointerLeave={() => setSelectedIndex(null)} onKeyDown={(event) => { if (!visible.length || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return; event.preventDefault(); setSelectedIndex((current) => Math.min(visible.length - 1, Math.max(0, (current ?? visible.length - 1) + (event.key === "ArrowLeft" ? -1 : 1)))); }}>
      {[0, .5, 1].map((tick) => { const y = plot.bottom - tick * (plot.bottom - plot.top); return <g key={tick}><line className="overview-trend-gridline" x1={plot.left} x2={plot.right} y1={y} y2={y} /><text className="overview-trend-y-label" x="0" y={y + 3}>{formatIoSize(scaleMax * tick)}</text></g>; })}
      {firstPoints.length > 1 ? <path className="overview-io-line overview-io-line-read" d={path(firstPoints)} /> : null}
      {secondPoints.length > 1 ? <path className="overview-io-line overview-io-line-write" d={path(secondPoints)} /> : null}
      {active && visible.length > 1 ? <line className="overview-trend-cursor" x1={firstPoints[activeIndex].x} x2={firstPoints[activeIndex].x} y1={plot.top} y2={plot.bottom} /> : null}
      {firstPoints.map((point, index) => <circle key={`read-${visible[index].at}`} className="overview-io-point overview-io-point-read" cx={point.x} cy={point.y} r={index === activeIndex ? 3.4 : 2}><title>{`${firstLabel}: ${formatIoSize(Math.max(0, visible[index][firstKey] - firstBaseline))}`}</title></circle>)}
      {secondPoints.map((point, index) => <circle key={`write-${visible[index].at}`} className="overview-io-point overview-io-point-write" cx={point.x} cy={point.y} r={index === activeIndex ? 3.4 : 2}><title>{`${secondLabel}: ${formatIoSize(Math.max(0, visible[index][secondKey] - secondBaseline))}`}</title></circle>)}
    </svg>
    <div className="overview-io-legend"><span><i className="io-color-read" />{firstLabel}</span><span><i className="io-color-write" />{secondLabel}</span><small>{visible.length ? `${visible.length} ${es ? "muestras" : "samples"}` : es ? "Sin historial" : "No history"}</small></div>
  </div>;
}

function DockerDiskUsage({ disk, error, es }: { disk: DockerDiskMetrics | null; error: string | null; es: boolean }) {
  const rows = disk ? [
    { key: "images", label: es ? "Imágenes" : "Images", value: disk.images, icon: Images },
    { key: "containers", label: es ? "Contenedores" : "Containers", value: disk.containers, icon: Container },
    { key: "volumes", label: es ? "Volúmenes" : "Volumes", value: disk.volumes, icon: Database },
    { key: "buildCache", label: es ? "Caché de compilación" : "Build cache", value: disk.buildCache, icon: Boxes },
  ] : [];
  return <article className="overview-io-card overview-docker-disk"><div className="overview-io-card-head"><span className="overview-io-icon"><HardDrive size={18} /></span><div><h3>{es ? "Uso de disco Docker" : "Docker disk usage"}</h3><p>{es ? "Espacio ocupado por recursos del Engine." : "Space used by Engine resources."}</p></div></div>{disk ? <><strong className="overview-docker-total">{formatSize(disk.total)}</strong><div className="overview-docker-stack" role="img" aria-label={es ? `Uso Docker total ${formatSize(disk.total)}` : `Docker total usage ${formatSize(disk.total)}`}>{rows.map((row) => <i key={row.key} className={`docker-disk-${row.key}`} style={{ width: `${disk.total ? 100 * row.value / disk.total : 0}%` }} />)}</div><div className="overview-docker-breakdown">{rows.map(({ key, label, value, icon: Icon }) => <div key={key}><span><Icon size={14} /><i className={`docker-disk-dot docker-disk-${key}`} />{label}</span><strong>{formatSize(value)}</strong></div>)}</div></> : <div className="overview-metrics-unavailable">{error ? `${es ? "No se pudo consultar el almacenamiento Docker:" : "Could not read Docker storage:"} ${error}` : es ? "El Engine no devolvió el detalle de almacenamiento Docker." : "Docker Engine did not return storage details."}</div>}</article>;
}

function StorageCapacity({ metrics, value, es }: { metrics: HostMetrics | null; value: number | null; es: boolean }) {
  const total = metrics?.disk.total ?? 0;
  const used = Math.min(total, metrics?.disk.used ?? 0);
  const free = Math.max(0, total - used);
  if (!metrics || total <= 0) return <div className="overview-storage-capacity is-unavailable"><p>{es ? "No se pudo leer la capacidad de almacenamiento." : "Storage capacity could not be read."}</p></div>;
  const state = value != null && value >= 95 ? "critical" : value != null && value >= 85 ? "warning" : "normal";
  return <div className={`overview-storage-capacity is-${state}`}>
    <div className="overview-storage-values"><span><small>{es ? "Usado" : "Used"}</small><strong>{formatSize(used)}</strong></span><span><small>{es ? "Disponible" : "Available"}</small><strong>{formatSize(free)}</strong></span></div>
    <div className="overview-storage-track" role="progressbar" aria-label={es ? "Almacenamiento usado" : "Storage used"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? 0}><span style={{ width: `${value ?? 0}%` }} /><i className="storage-mark storage-mark-80" /><i className="storage-mark storage-mark-90" /></div>
    <div className="overview-storage-scale"><span>0%</span><span>80%</span><span>90%</span><span>100%</span></div>
    <p>{state === "critical" ? (es ? "Espacio crítico: conviene liberar almacenamiento." : "Critical space: consider freeing storage.") : state === "warning" ? (es ? "El espacio disponible está bajando." : "Available space is getting low.") : (es ? "Capacidad del sistema de archivos de Vessel." : "Capacity of Vessel's data filesystem.")}</p>
  </div>;
}

export default function OverviewPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [dockerUpdate, setDockerUpdate] = useState<DockerUpdate | null>(null);
  const [dockerUpdateLoading, setDockerUpdateLoading] = useState(true);
  const [dockerUpdateError, setDockerUpdateError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [metrics, setMetrics] = useState<HostMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [dockerDetailsLoading, setDockerDetailsLoading] = useState(true);
  const [dockerDetailsRequestError, setDockerDetailsRequestError] = useState(false);
  const [dockerDetailsRetry, setDockerDetailsRetry] = useState(0);
  const [remoteServers, setRemoteServers] = useState<RemoteServerSummary[]>([]);
  const [remoteMetrics, setRemoteMetrics] = useState<RemoteMetric[]>([]);
  const [remoteMetricsLoading, setRemoteMetricsLoading] = useState(false);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(15);
  const [history, setHistory] = useState<MetricsHistory>({ cpu: [], memory: [], io: [] });
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyRange, setHistoryRange] = useState<HistoryRange>("1h");
  const [selectedEngineId, setSelectedEngineId] = useState("local");
  const [engineAvailability, setEngineAvailability] = useState<Record<string, "online" | "offline">>({});
  const [engineSelectionReady, setEngineSelectionReady] = useState(false);
  const [localEngineName, setLocalEngineName] = useState("Engine Local");

  useEffect(() => {
    const savedEngine = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-engine-id="))?.slice("vessel-engine-id=".length);
    try { setSelectedEngineId(savedEngine ? decodeURIComponent(savedEngine) : "local"); }
    catch { setSelectedEngineId("local"); }
    setEngineSelectionReady(true);
    fetch("/api/engines", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { data?: RemoteServerSummary[]; localEngineName?: string };
      if (Array.isArray(payload.data)) setRemoteServers(payload.data);
      if (payload.localEngineName) setLocalEngineName(payload.localEngineName);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleEngineChange = (event: Event) => {
      const nextEngineId = (event as CustomEvent<string>).detail;
      if (typeof nextEngineId !== "string" || !nextEngineId) return;
      setSelectedEngineId(nextEngineId);
      setSnapshot(null);
      setMetrics(null);
      setMetricsLoading(true);
      setDockerDetailsLoading(true);
      setDockerDetailsRequestError(false);
      setRemoteMetrics([]);
      setLoading(true);
      setError(false);
      setEngineError(null);
    };
    window.addEventListener("vessel-engine-changed", handleEngineChange);
    return () => window.removeEventListener("vessel-engine-changed", handleEngineChange);
  }, []);

  function selectEngine(engineId: string) {
    if (engineId === selectedEngineId) return;
    document.cookie = `vessel-engine-id=${encodeURIComponent(engineId)}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    window.dispatchEvent(new CustomEvent("vessel-engine-changed", { detail: engineId }));
  }

  async function checkDockerUpdate(force = false) {
    const startedAt = performance.now();
    setDockerUpdateLoading(true);
    setDockerUpdateError(false);
    try {
      const params = new URLSearchParams({ engineId: selectedEngineId });
      if (force) params.set("refresh", "1");
      const response = await fetch(`/api/docker-update?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload?.data) throw new Error("Docker update check failed");
      setDockerUpdate(payload.data as DockerUpdate);
    } catch {
      setDockerUpdateError(true);
    } finally {
      const remaining = 800 - (performance.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      setDockerUpdateLoading(false);
    }
  }

  useEffect(() => {
    if (!engineSelectionReady) return;
    setDockerUpdate(null);
    void checkDockerUpdate();
  }, [engineSelectionReady, selectedEngineId]);

  useEffect(() => {
    if (!engineSelectionReady) return;
    setHistoryLoaded(false);
    try {
      const historyKey = `${METRICS_HISTORY_KEY}:${selectedEngineId}`;
      const saved = JSON.parse(window.localStorage.getItem(historyKey) ?? "null") as Partial<MetricsHistory> | null;
      const cutoff = Date.now() - METRICS_HISTORY_MAX_AGE;
      const clean = (samples: unknown) => Array.isArray(samples) ? samples.filter((sample): sample is MetricSample => Boolean(sample && typeof sample === "object" && Number.isFinite((sample as MetricSample).value) && Number.isFinite((sample as MetricSample).at) && (sample as MetricSample).at >= cutoff && (sample as MetricSample).value >= 0 && (sample as MetricSample).value <= 100)).slice(-METRICS_HISTORY_MAX_SAMPLES) : [];
      const cleanIo = Array.isArray(saved?.io) ? saved.io.filter((sample): sample is IoSample => {
        if (!sample || typeof sample !== "object") return false;
        const io = sample as IoSample;
        return Number.isFinite(io.at) && io.at >= cutoff && [io.blockRead, io.blockWrite, io.networkIn, io.networkOut].every(Number.isFinite);
      }).slice(-METRICS_HISTORY_MAX_SAMPLES) : [];
      setHistory({ cpu: clean(saved?.cpu), memory: clean(saved?.memory), io: cleanIo });
    } catch { setHistory({ cpu: [], memory: [], io: [] }); }
    setHistoryLoaded(true);
  }, [engineSelectionReady, selectedEngineId]);

  useEffect(() => {
    if (!historyLoaded) return;
    try { window.localStorage.setItem(`${METRICS_HISTORY_KEY}:${selectedEngineId}`, JSON.stringify(history)); } catch { /* Keep live metrics available if browser storage is full or disabled. */ }
  }, [history, historyLoaded, selectedEngineId]);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (typeof payload?.data?.refreshIntervalSeconds === "number") setRefreshIntervalSeconds(payload.data.refreshIntervalSeconds); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!engineSelectionReady || !historyLoaded) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    setMetricsLoading(true);
    function scheduleNext() {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState === "visible") void loadMetrics();
        else scheduleNext();
      }, refreshIntervalSeconds * 1000);
    }
    async function loadMetrics() {
      try {
        const response = await fetch(`/api/metrics?engineId=${encodeURIComponent(selectedEngineId)}&hostOnly=1`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Metrics unavailable");
        const next = await response.json() as HostMetrics;
        if (cancelled) return;
        setMetrics((current) => ({ ...next, dockerDisk: current?.dockerDisk ?? next.dockerDisk, dockerDiskError: current?.dockerDiskError ?? next.dockerDiskError, io: current?.io ?? next.io, ioError: current?.ioError ?? next.ioError }));
        setRemoteServers((current) => JSON.stringify(current) === JSON.stringify(next.remoteServers ?? []) ? current : next.remoteServers ?? []);
        const sampledAt = Date.parse(next.sampledAt) || Date.now();
        setHistory((current) => ({
          cpu: appendSample(current.cpu, { value: next.cpu.percent, at: sampledAt }),
          memory: appendSample(current.memory, { value: percent(next.memory.used, next.memory.total), at: sampledAt }),
          io: current.io,
        }));
      } catch { if (!cancelled) setMetrics(null); }
      finally {
        if (!cancelled) {
          setMetricsLoading(false);
          scheduleNext();
        }
      }
    }
    void loadMetrics();
    return () => { cancelled = true; controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [engineSelectionReady, refreshIntervalSeconds, historyLoaded, selectedEngineId]);

  useEffect(() => {
    if (!engineSelectionReady || loading || !snapshot) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    setDockerDetailsLoading(true);
    setDockerDetailsRequestError(false);
    async function loadDockerDetails() {
      try {
        const response = await fetch(`/api/metrics?engineId=${encodeURIComponent(selectedEngineId)}&detailsOnly=1`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]) });
        if (!response.ok) throw new Error("Docker details unavailable");
        const details = await response.json() as Pick<HostMetrics, "dockerDisk" | "dockerDiskError" | "io" | "ioError" | "sampledAt">;
        if (cancelled) return;
        setMetrics((current) => current ? { ...current, ...details } : current);
        setDockerDetailsRequestError(Boolean(details.dockerDiskError || details.ioError));
        if (details.io) {
          const sampledAt = Date.parse(details.sampledAt) || Date.now();
          setHistory((current) => ({ ...current, io: appendIoSample(current.io, { ...details.io!, at: sampledAt }) }));
        }
      } catch {
        if (!cancelled) setDockerDetailsRequestError(true);
      } finally {
        if (!cancelled) {
          setDockerDetailsLoading(false);
          timer = window.setTimeout(() => { if (document.visibilityState === "visible") void loadDockerDetails(); else timer = window.setTimeout(() => void loadDockerDetails(), 5000); }, Math.max(60, refreshIntervalSeconds) * 1000);
        }
      }
    }
    timer = window.setTimeout(() => void loadDockerDetails(), dockerDetailsRetry ? 0 : 500);
    return () => { cancelled = true; controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [dockerDetailsRetry, engineSelectionReady, loading, refreshIntervalSeconds, selectedEngineId, snapshot]);

  useEffect(() => {
    if (!engineSelectionReady || loading) {
      setRemoteMetrics([]);
      setRemoteMetricsLoading(false);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();
    const serversToPoll = remoteServers.filter((server) => server.id !== selectedEngineId);
    setRemoteMetrics((current) => current.filter((item) => item.server.id !== selectedEngineId));
    if (!serversToPoll.length) {
      setRemoteMetrics([]);
      setRemoteMetricsLoading(false);
      return () => { cancelled = true; };
    }
    setRemoteMetricsLoading(true);
    function scheduleNext() {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        if (document.visibilityState === "visible") void loadRemoteMetrics();
        else scheduleNext();
      }, refreshIntervalSeconds * 1000);
    }
    async function loadRemoteMetrics() {
      const results = await Promise.all(serversToPoll.map(async (server): Promise<RemoteMetric> => {
        try {
          const response = await fetch(`/api/metrics?engineId=${encodeURIComponent(server.id)}&hostOnly=1`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("Remote metrics unavailable");
          return { server, metrics: await response.json() as HostMetrics, error: false };
        } catch {
          return { server, metrics: null, error: true };
        }
      }));
      if (!cancelled) {
        setRemoteMetrics(results);
        setRemoteMetricsLoading(false);
        scheduleNext();
      }
    }
    void loadRemoteMetrics();
    return () => { cancelled = true; controller.abort(); if (timer !== undefined) window.clearTimeout(timer); };
  }, [engineSelectionReady, loading, remoteServers, refreshIntervalSeconds, selectedEngineId]);

  useEffect(() => {
    if (!engineSelectionReady) return;
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(false);
      setEngineError(null);
      setSnapshot(null);
      try {
        const engineQuery = `engineId=${encodeURIComponent(selectedEngineId)}`;
        const response = await fetch(`/api/overview?${engineQuery}`, { cache: "no-store", signal: controller.signal });
        const overview = await response.json();
        if (cancelled) return;
        if (!response.ok || !overview?.data) {
          setEngineAvailability((current) => ({ ...current, [selectedEngineId]: "offline" }));
          window.dispatchEvent(new CustomEvent("vessel-engine-connectivity", { detail: { engineId: selectedEngineId, online: false } }));
          setSnapshot(null);
          setError(true);
          setEngineError(typeof overview?.error === "string" ? overview.error : null);
          return;
        }
        setEngineAvailability((current) => ({ ...current, [selectedEngineId]: "online" }));
        window.dispatchEvent(new CustomEvent("vessel-engine-connectivity", { detail: { engineId: selectedEngineId, online: true } }));
        setSnapshot(overview.data as Snapshot);
        if (!overview.data.engine?.ComposeVersion) {
          void fetch("/api/compose-version", { cache: "no-store", signal: controller.signal })
            .then((versionResponse) => versionResponse.ok ? versionResponse.json() : null)
            .then((versionData) => {
              if (!cancelled && versionData?.version) {
                setSnapshot((current) => current ? { ...current, engine: current.engine ? { ...current.engine, ComposeVersion: versionData.version } : current.engine } : current);
              }
            }).catch(() => undefined);
        }
      } catch (cause) {
        if (!cancelled) {
          setEngineAvailability((current) => ({ ...current, [selectedEngineId]: "offline" }));
          window.dispatchEvent(new CustomEvent("vessel-engine-connectivity", { detail: { engineId: selectedEngineId, online: false } }));
          setSnapshot(null);
          setError(true);
          setEngineError(cause instanceof Error ? cause.message : null);
        }
      } finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [engineSelectionReady, refreshIndex, selectedEngineId]);

  const running = snapshot?.containers.filter((container) => container.status === "running" || container.status === "unhealthy").length ?? 0;
  const stopped = snapshot?.containers.filter((container) => container.status === "stopped").length ?? 0;
  const paused = snapshot?.containers.filter((container) => container.status === "paused").length ?? 0;
  const unhealthy = snapshot?.containers.filter((container) => container.status === "unhealthy").length ?? 0;
  const standalone = snapshot?.containers.filter((container) => !container.composeProject).length ?? 0;
  const statusTotal = running + stopped + paused;
  const runningAngle = statusTotal ? 360 * running / statusTotal : 0;
  const initialLoading = loading && snapshot === null;
  const selectedRemoteServer = remoteServers.find((server) => server.id === selectedEngineId);
  const usage = [
    { id: "cpu", icon: Cpu, label: "CPU", value: metrics?.cpu.percent ?? null, detail: es ? "Uso del procesador" : "Processor utilization", samples: history.cpu },
    { id: "memory", icon: MemoryStick, label: es ? "Memoria" : "Memory", value: metrics ? percent(metrics.memory.used, metrics.memory.total) : null, detail: metrics ? `${formatSize(metrics.memory.used)} / ${formatSize(metrics.memory.total)}` : "—", samples: history.memory },
    { id: "disk", icon: HardDrive, label: es ? "Almacenamiento" : "Storage", value: metrics ? percent(metrics.disk.used, metrics.disk.total) : null, detail: metrics ? `${formatSize(metrics.disk.used)} / ${formatSize(metrics.disk.total)}` : "—", samples: [] as MetricSample[] },
  ];
  const counts = [
    { href: "/projects", icon: FolderKanban, label: es ? "Proyectos" : "Projects", value: snapshot?.workspaces.length },
    { href: "/compose", icon: Boxes, label: es ? "Proyectos Compose" : "Compose projects", value: snapshot?.projects.length },
    { href: "/containers", icon: Container, label: es ? "Contenedores" : "Containers", value: snapshot?.containers.length },
    { href: "/images", icon: Images, label: es ? "Imágenes" : "Images", value: snapshot?.images },
    { href: "/volumes", icon: Database, label: es ? "Volúmenes" : "Volumes", value: snapshot?.volumes },
    { href: "/networks", icon: Network, label: es ? "Redes" : "Networks", value: snapshot?.networks },
  ];
  const engineDetails = [
    { key: "engine-version", icon: <Container size={14} />, label: es ? "Versión Docker Engine" : "Docker Engine version", value: snapshot?.engine?.ServerVersion ? `v${snapshot.engine.ServerVersion.replace(/^v/, "")}` : "—" },
    { key: "compose-version", icon: <Boxes size={14} />, label: "Docker Compose CLI · Vessel", value: snapshot?.engine?.ComposeVersion ? `v${snapshot.engine.ComposeVersion.replace(/^v/, "")}` : es ? "No disponible en Vessel" : "Not available in Vessel", title: es ? "Versión de Compose disponible en el runtime de Vessel; Docker Engine no expone la versión del plugin instalado en el host." : "Compose version available in the Vessel runtime; Docker Engine does not expose the host's installed plugin version." },
    { key: "platform", icon: <Monitor size={14} />, label: es ? "Plataforma" : "Platform", value: snapshot?.engine ? `${snapshot.engine.OperatingSystem ?? snapshot.engine.OSType ?? "Docker"} · ${snapshot.engine.Architecture ?? "—"}` : "—" },
    { key: "resources", icon: <><Cpu size={17} /><MemoryStick size={17} /></>, label: es ? "CPU / memoria del Engine" : "Engine CPU / memory", value: snapshot?.engine ? `${snapshot.engine.NCPU ?? "—"} ${es ? "núcleos" : "cores"} · ${snapshot.engine.MemTotal ? formatSize(snapshot.engine.MemTotal) : "—"}` : "—" },
    { key: "storage-driver", icon: <HardDrive size={14} />, label: es ? "Driver de almacenamiento" : "Storage driver", value: snapshot?.engine?.Driver ?? "—" },
    { key: "docker-root", icon: <FolderOpen size={14} />, label: es ? "Directorio Docker" : "Docker root directory", value: snapshot?.engine?.DockerRootDir ?? "—", title: snapshot?.engine?.DockerRootDir },
  ];

  return <main className="module-main overview-page">
    <div className="overview-heading"><div><span className="overview-eyebrow">VESSEL / {es ? "RESUMEN" : "OVERVIEW"}</span><h1>{es ? "Tu espacio de trabajo" : "Your workspace"}</h1><p>{es ? "Una vista clara del estado de Docker. Entra a un proyecto o recurso cuando necesites manejarlo." : "A clear view of Docker health. Open a project or resource when you need to manage it."}</p></div><button className="overview-refresh" type="button" disabled={loading} onClick={() => setRefreshIndex((value) => value + 1)}><RefreshCw size={16} className={loading ? "spinning" : ""} />{es ? "Actualizar" : "Refresh"}</button></div>
    <div className="overview-engine-select"><Server size={17} /><strong>Engine</strong><VesselSelect aria-label={es ? "Engine Docker activo" : "Active Docker Engine"} value={selectedEngineId} onChange={(event) => selectEngine(event.target.value)}><option value="local" data-status={engineAvailability.local} data-status-label={es ? "Sin conexión" : "Unavailable"}>{localEngineName}</option>{remoteServers.map((server) => <option key={server.id} value={server.id} data-status={engineAvailability[server.id]} data-status-label={es ? "Sin conexión" : "Unavailable"}>{server.name} · {server.host}</option>)}</VesselSelect></div>
    {error ? <div className="overview-error" role="alert"><Server size={22} /><div><strong>{selectedRemoteServer ? (es ? `No se pudo conectar a ${selectedRemoteServer.name}` : `Could not connect to ${selectedRemoteServer.name}`) : es ? "Docker no está disponible" : "Docker is unavailable"}</strong><p>{engineError ?? (selectedRemoteServer ? (es ? `No se pudo leer el estado de Docker en ${selectedRemoteServer.host}. Verifica la conexión SSH y que el usuario tenga acceso al socket Docker.` : `Could not read Docker state from ${selectedRemoteServer.host}. Check SSH connectivity and the user's access to the Docker socket.`) : es ? "No se pudo leer el estado de los contenedores. Revisa la conexión del backend y vuelve a intentar." : "Could not read container state. Check the backend connection and try again.")}</p></div></div> : null}
    {initialLoading ? <OverviewLoadingSkeleton variant="status" label={es ? "Cargando estado de Docker" : "Loading Docker status"} /> : error ? null : <section className="overview-status" aria-label={es ? "Estado del entorno" : "Environment status"}>
      <div className="overview-status-head"><span className="overview-status-icon"><Server size={20} /></span><div><strong>Docker Engine{snapshot?.engine?.ServerVersion ? ` · ${snapshot.engine.ServerVersion}` : ""}</strong><span>{snapshot?.engine?.Name || snapshot?.host ? `Host · ${snapshot.engine?.Name || snapshot.host}` : selectedRemoteServer ? `Host · ${selectedRemoteServer.host}` : es ? "Host local" : "Local host"}</span></div><span className={`overview-health ${error ? "is-error" : ""}`}><i />{error ? (es ? "Sin conexión" : "Disconnected") : (es ? "Conectado" : "Connected")}</span></div>
      <div className={`docker-update-check ${dockerUpdateLoading ? "is-checking" : ""} ${dockerUpdateError ? "is-error" : dockerUpdate?.updateAvailable ? "has-update" : "is-current"}`}>
        <span className="docker-update-check-icon">{dockerUpdateLoading && !dockerUpdate ? <RefreshCw size={17} className="spinning" /> : dockerUpdateError ? <CircleAlert size={17} /> : dockerUpdate?.updateAvailable ? <ArrowDownToLine size={17} /> : <CircleCheck size={17} />}</span>
        <div className="docker-update-copy">
          <strong>{dockerUpdateLoading && !dockerUpdate ? (es ? "Comprobando actualizaciones de Docker…" : "Checking Docker updates…") : dockerUpdateError ? (es ? "No se pudo comprobar si hay actualizaciones" : "Could not check for Docker updates") : dockerUpdate?.updateAvailable ? (es ? `Docker Engine ${dockerUpdate.latestVersion} está disponible` : `Docker Engine ${dockerUpdate.latestVersion} is available`) : (es ? "Docker Engine está actualizado" : "Docker Engine is up to date")}</strong>
          {!dockerUpdateError && dockerUpdate ? <span>{es ? `Instalado: ${dockerUpdate.currentVersion} · Última versión estable: ${dockerUpdate.latestVersion}` : `Installed: ${dockerUpdate.currentVersion} · Latest stable: ${dockerUpdate.latestVersion}`}</span> : null}
        </div>
        <div className="docker-update-actions">
          {!dockerUpdateError && dockerUpdate?.updateAvailable ? <a href={dockerUpdate.releaseUrl} target="_blank" rel="noreferrer">{es ? "Ver versión" : "View release"}<ArrowRight size={14} /></a> : null}
          <button type="button" onClick={() => void checkDockerUpdate(true)} disabled={dockerUpdateLoading} aria-label={es ? "Volver a comprobar actualizaciones" : "Check for updates again"}><RefreshCw size={14} className={dockerUpdateLoading ? "spinning" : ""} />{dockerUpdateLoading ? (es ? "Comprobando…" : "Checking…") : es ? "Comprobar" : "Check"}</button>
        </div>
      </div>
      <div className="overview-status-body"><div className="overview-donut" style={{ background: `conic-gradient(var(--accent) 0deg ${runningAngle}deg, var(--overview-stop) ${runningAngle}deg 360deg)` }}><span>{snapshot?.containers.length ?? 0}<small>{es ? "total" : "total"}</small></span></div><div className="overview-health-grid"><div><CirclePlay size={19} /><strong>{running}</strong><span>{unhealthy ? `${unhealthy} ${es ? "con healthcheck fallido" : "unhealthy"}` : es ? "En ejecución" : "Running"}</span></div><div><CirclePause size={19} /><strong>{stopped + paused}</strong><span>{paused ? `${paused} ${es ? "pausados" : "paused"}` : es ? "Detenidos" : "Stopped"}</span></div><div><Boxes size={19} /><strong>{standalone}</strong><span>{es ? "Fuera de Compose" : "Standalone"}</span></div></div></div>
      <div className="overview-engine-details">
        {engineDetails.map(({ key, icon, label, value, title }) => <div key={key}><span className="overview-engine-label"><span className={`overview-engine-symbol ${key === "resources" ? "overview-engine-symbol--resources" : ""}`}>{icon}</span>{label}</span><strong title={title}>{value}</strong></div>)}
        {snapshot?.engine?.Swarm?.LocalNodeState && snapshot.engine.Swarm.LocalNodeState !== "inactive" ? <div><span className="overview-engine-label"><span className="overview-engine-symbol"><Network size={14} /></span>Swarm</span><strong>{snapshot.engine.Swarm.LocalNodeState}{typeof snapshot.engine.Swarm.Nodes === "number" ? ` · ${snapshot.engine.Swarm.Nodes} ${es ? "nodos" : "nodes"}` : ""}</strong></div> : null}
      </div>
    </section>}
    <div className="overview-section-title overview-metrics-heading"><div><h2><Activity size={19} />{es ? "Uso del equipo" : "Host usage"}</h2><p>{es ? "Tendencia de CPU y memoria. El almacenamiento muestra capacidad usada y disponible." : "CPU and memory trends. Storage shows used and available capacity."}<small>{es ? "El historial se recopila mientras el resumen está abierto y se conserva en este navegador por 24 horas." : "History is collected while Overview is open and kept in this browser for 24 hours."}</small></p></div><div className="overview-range-control" role="group" aria-label={es ? "Rango del historial" : "History range"}>{(["15m", "1h", "6h", "24h"] as HistoryRange[]).map((range) => <button type="button" key={range} className={historyRange === range ? "active" : ""} aria-pressed={historyRange === range} onClick={() => setHistoryRange(range)}>{range === "15m" ? (es ? "15 min" : "15 min") : range === "1h" ? "1 h" : range === "6h" ? "6 h" : "24 h"}</button>)}</div></div>
    {metricsLoading ? <OverviewLoadingSkeleton variant="usage" label={es ? "Cargando métricas del equipo" : "Loading host metrics"} /> : <section className="overview-usage-grid" aria-label={es ? "Métricas del equipo" : "Host metrics"}>{usage.map(({ id, icon: Icon, label, value, detail, samples }) => <article className={`overview-usage-card usage-${id}`} key={id}><div className="overview-usage-head"><span><Icon size={21} />{label}</span><span className="usage-live-status">{metrics ? <><i />{sampleAge(Date.parse(metrics.sampledAt) || Date.now(), es)}</> : (es ? "Sin dato" : "No data")}</span></div><div className="overview-metric-reading"><strong>{value == null ? "—" : value.toFixed(1)}<small>{value == null ? "" : "%"}</small></strong><span>{detail}</span></div>{id === "disk" ? <StorageCapacity metrics={metrics} value={value} es={es} /> : <Trend samples={samples} label={label} es={es} range={historyRange} />}</article>)}</section>}
    <div className="overview-section-title overview-io-heading"><div><h2><Activity size={19} />{es ? "Almacenamiento y actividad Docker" : "Docker storage & activity"}</h2><p>{es ? "Uso informado por Docker y contadores acumulados de los contenedores en ejecución." : "Usage reported by Docker and cumulative counters from running containers."}</p></div></div>
    {dockerDetailsLoading && !metrics?.dockerDisk && !metrics?.io ? <OverviewLoadingSkeleton variant="usage" label={es ? "Consultando almacenamiento y actividad Docker" : "Loading Docker storage and activity"} /> : <section className="overview-io-grid" aria-label={es ? "Almacenamiento y actividad Docker" : "Docker storage and activity"}>
      <DockerDiskUsage disk={metrics?.dockerDisk ?? null} error={metrics?.dockerDiskError ?? null} es={es} />
      <article className="overview-io-card"><div className="overview-io-card-head"><span className="overview-io-icon"><HardDrive size={18} /></span><div><h3>{es ? "Block I/O" : "Block I/O"}</h3><p>{es ? "Lectura y escritura acumuladas de contenedores activos." : "Cumulative reads and writes from running containers."}</p></div><span className="overview-io-live">{metrics?.io ? `${metrics.io.containers} ${es ? "activos" : "active"}` : "—"}</span></div>{metrics?.io ? <><div className="overview-io-total-row"><span>{es ? "Leído" : "Read"}<strong>{formatIoSize(metrics.io.blockRead)}</strong></span><span>{es ? "Escrito" : "Write"}<strong>{formatIoSize(metrics.io.blockWrite)}</strong></span></div>{metrics.io.failedContainers > 0 ? <div className="overview-metrics-unavailable">{es ? `${metrics.io.failedContainers} contenedor(es) no devolvieron estadísticas.` : `${metrics.io.failedContainers} container(s) did not return statistics.`}</div> : null}<IoHistoryChart samples={history.io} firstKey="blockRead" secondKey="blockWrite" firstLabel={es ? "Lectura" : "Read"} secondLabel={es ? "Escritura" : "Write"} es={es} range={historyRange} /></> : <div className="overview-metrics-unavailable">{metrics?.ioError ? `${es ? "No se pudo consultar Block I/O:" : "Could not read Block I/O:"} ${metrics.ioError}` : dockerDetailsLoading ? es ? "Consultando contadores del Engine…" : "Reading Engine counters…" : es ? "No se recibieron contadores Block I/O del Engine." : "No Block I/O counters were returned by the Engine."}</div>}</article>
      <article className="overview-io-card"><div className="overview-io-card-head"><span className="overview-io-icon"><Network size={18} /></span><div><h3>{es ? "Network I/O" : "Network I/O"}</h3><p>{es ? "Tráfico acumulado de contenedores activos." : "Cumulative traffic from running containers."}</p></div><span className="overview-io-live">{metrics?.io ? `${metrics.io.containers} ${es ? "activos" : "active"}` : "—"}</span></div>{metrics?.io ? <><div className="overview-io-total-row"><span>{es ? "Entrada" : "In"}<strong>{formatIoSize(metrics.io.networkIn)}</strong></span><span>{es ? "Salida" : "Out"}<strong>{formatIoSize(metrics.io.networkOut)}</strong></span></div>{metrics.io.failedContainers > 0 ? <div className="overview-metrics-unavailable">{es ? `${metrics.io.failedContainers} contenedor(es) no devolvieron estadísticas.` : `${metrics.io.failedContainers} container(s) did not return statistics.`}</div> : null}<IoHistoryChart samples={history.io} firstKey="networkIn" secondKey="networkOut" firstLabel={es ? "Entrada" : "In"} secondLabel={es ? "Salida" : "Out"} es={es} range={historyRange} /></> : <div className="overview-metrics-unavailable">{metrics?.ioError ? `${es ? "No se pudo consultar Network I/O:" : "Could not read Network I/O:"} ${metrics.ioError}` : dockerDetailsLoading ? es ? "Consultando contadores del Engine…" : "Reading Engine counters…" : es ? "No se recibieron contadores de red del Engine." : "No network counters were returned by the Engine."}</div>}</article>
    </section>}
    {dockerDetailsRequestError && !dockerDetailsLoading ? <div className="overview-metrics-retry" role="status"><span>{es ? "No fue posible completar la consulta de actividad Docker." : "Could not finish loading Docker activity."}</span><button type="button" onClick={() => { setDockerDetailsLoading(true); setDockerDetailsRetry((value) => value + 1); }}>{es ? "Reintentar" : "Retry"}<RefreshCw size={14} /></button></div> : null}
    {remoteServers.length ? <>
      <div className="overview-section-title overview-remote-heading"><div><h2><Server size={19} />{es ? "Servidores registrados" : "Registered servers"}</h2><p>{es ? "Métricas recientes de los Engines conectados por SSH." : "Recent metrics from Engines connected over SSH."}</p></div><Link href="/servers">{es ? "Administrar servidores" : "Manage servers"}<ArrowRight size={16} /></Link></div>
      <section className="overview-remote-host-grid" aria-label={es ? "Métricas de servidores registrados" : "Registered server metrics"}>
        {remoteServers.map((server) => {
          const result = remoteMetrics.find((item) => item.server.id === server.id);
          const remote = server.id === selectedEngineId ? metrics : result?.metrics;
          const unavailable = server.id === selectedEngineId ? !metrics && !metricsLoading : result?.error;
          const checking = server.id === selectedEngineId ? metricsLoading : remoteMetricsLoading && !result;
          const values = [
            { label: "CPU", value: remote?.cpu.percent ?? null, detail: remote ? `${remote.cpu.percent.toFixed(1)}%` : "—" },
            { label: es ? "Memoria" : "Memory", value: remote ? percent(remote.memory.used, remote.memory.total) : null, detail: remote ? `${formatSize(remote.memory.used)} / ${formatSize(remote.memory.total)}` : "—" },
            { label: es ? "Disco raíz" : "Root disk", value: remote ? percent(remote.disk.used, remote.disk.total) : null, detail: remote ? `${formatSize(remote.disk.used)} / ${formatSize(remote.disk.total)}` : "—" },
          ];
          return <article className="overview-remote-host-card" key={server.id}>
            <header><span className="overview-remote-host-icon"><Server size={18} /></span><div><strong>{server.name}</strong><small>{server.host}</small></div><span className={`overview-remote-host-status${unavailable ? " is-error" : remote ? " is-connected" : ""}`}><i />{checking ? (es ? "Consultando…" : "Checking…") : unavailable ? (es ? "Métricas no disponibles" : "Metrics unavailable") : remote ? sampleAge(Date.parse(remote.sampledAt) || Date.now(), es) : (es ? "Esperando métricas" : "Waiting for metrics")}</span></header>
            {unavailable ? <p className="overview-remote-host-error">{es ? "No se pudieron leer las métricas del host. La conexión Docker puede seguir activa." : "Host metrics could not be read. The Docker connection may still be active."}</p> : checking && !remote ? <div className="overview-remote-metric-skeleton" aria-label={es ? "Cargando métricas" : "Loading metrics"}><i /><i /><i /></div> : <div className="overview-remote-metric-grid">{values.map(({ label, value, detail }) => <div key={label}><span>{label}</span><strong>{detail}</strong><i><b style={{ width: `${value ?? 0}%` }} /></i></div>)}</div>}
          </article>;
        })}
      </section>
    </> : null}
    <div className="overview-section-title"><div><h2><Container size={19} />{es ? "Explorar recursos" : "Explore resources"}</h2><p>{es ? "Cada sección tiene su propio espacio de gestión." : "Each section has its own management workspace."}</p></div></div>
    {initialLoading ? <OverviewLoadingSkeleton variant="resources" label={es ? "Cargando recursos" : "Loading resources"} /> : <section className="overview-resource-grid" aria-label={es ? "Recursos Docker" : "Docker resources"}>{counts.map(({ href, icon: Icon, label, value }) => <Link className="overview-resource" href={href} key={href}><span className="overview-resource-icon"><Icon size={21} /></span><strong>{value == null ? "—" : value}</strong><span>{label}</span><ArrowRight className="overview-resource-arrow" size={17} /></Link>)}</section>}
    <div className="overview-section-title project-title"><div><h2><FolderKanban size={19} />{es ? "Proyectos" : "Projects"}</h2><p>{es ? "Espacios de trabajo para organizar servicios relacionados." : "Workspaces for organizing related services."}</p></div><Link href="/projects">{es ? "Ver proyectos" : "View projects"}<ArrowRight size={16} /></Link></div>
    {initialLoading ? <OverviewLoadingSkeleton variant="projects" label={es ? "Cargando proyectos" : "Loading projects"} /> : <section className="overview-projects">{snapshot?.workspaces.length ? snapshot.workspaces.slice(0, 4).map((project) => <Link href={`/projects/${encodeURIComponent(project.id)}`} className="overview-project" key={project.id}><span className="overview-project-icon"><FolderKanban size={19} /></span><span><strong>{project.name}</strong><small>{project.serviceCount} {es ? project.serviceCount === 1 ? "servicio" : "servicios" : project.serviceCount === 1 ? "service" : "services"}</small></span><ArrowRight size={17} /></Link>) : <div className="overview-empty"><FolderKanban size={23} /><strong>{es ? "Todavía no hay proyectos" : "No projects yet"}</strong><span>{es ? "Crea un espacio de trabajo y agrupa sus servicios." : "Create a workspace and group its services."}</span><Link href="/projects">{es ? "Crear proyecto" : "Create project"}<ArrowRight size={15} /></Link></div>}</section>}
    <div className="overview-section-title project-title"><div><h2><Boxes size={19} />{es ? "Proyectos Compose" : "Compose projects"}</h2><p>{es ? "Servicios agrupados por proyecto." : "Services grouped by project."}</p></div><Link href="/compose">{es ? "Ver proyectos" : "View projects"}<ArrowRight size={16} /></Link></div>
    {initialLoading ? <OverviewLoadingSkeleton variant="compose" label={es ? "Cargando proyectos Compose" : "Loading Compose projects"} /> : <section className="overview-projects">{snapshot?.projects.length ? snapshot.projects.slice(0, 4).map((project) => <Link href="/compose" className="overview-project" key={project.name}><span className="overview-project-icon"><Boxes size={19} /></span><span><strong>{project.name}</strong><small>{project.containers.length} {es ? project.containers.length === 1 ? "contenedor" : "contenedores" : project.containers.length === 1 ? "container" : "containers"}</small></span><ArrowRight size={17} /></Link>) : <div className="overview-empty"><Boxes size={23} /><strong>{es ? "Todavía no hay proyectos Compose" : "No Compose projects yet"}</strong><span>{es ? "Puedes gestionar contenedores individuales o crear un proyecto nuevo." : "Manage standalone containers or create a new project."}</span><Link href="/compose">{es ? "Ir a Compose" : "Open Compose"}<ArrowRight size={15} /></Link></div>}</section>}
  </main>;
}
