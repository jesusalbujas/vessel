"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutGrid, List, MoreHorizontal } from "lucide-react";
import type { RestartPolicy, Service, ServiceCategory, ServiceStatus } from "@/lib/services";
import { useI18n, type TranslationKey } from "@/lib/i18n";

const initialCatalog: Service[] = [];

function nextAvailablePort(ports: number[]): number {
  const used = new Set(ports.filter((port) => port > 0));
  return Math.max(50000, ...used) + 1;
}

function statusLabel(status: ServiceStatus, t: (key: TranslationKey) => string): string {
  return { unknown: t("unknown"), starting: t("checking"), running: t("running"), stopped: t("stopped"), unhealthy: t("unhealthy") }[status];
}

function localizedStatusSince(value: string | null, language: "es" | "en"): string {
  if (!value || language === "es") return value ?? "";
  return value.replace(/^Activo desde hace /, "Running for ").replace(/^Detenido desde hace /, "Stopped for ").replace(/^Activo$/, "Running").replace(/^Detenido$/, "Stopped").replace(/^Creado, aún no iniciado$/, "Created, not started yet").replace(/^aproximadamente /, "about ").replace(/^menos de /, "less than ").replace(/un segundo$/, "one second").replace(/un minuto$/, "one minute").replace(/una hora$/, "one hour").replace(/un día$/, "one day").replace(/segundos?$/, "seconds").replace(/minutos?$/, "minutes").replace(/horas?$/, "hours").replace(/días?$/, "days");
}

type ImageResource = { Id: string; RepoTags?: string[] | null; RepoDigests?: string[] | null; Size?: number; used?: boolean };
type VolumeResource = { Name: string; Driver?: string; Mountpoint?: string; CreatedAt?: string; Labels?: Record<string, string>; usedBy?: string[] };
type NetworkResource = { Id: string; Name: string; Driver?: string; Scope?: string; Containers?: Record<string, { Name?: string }> };
type ContainerOption = { id: string; name: string };
type CloneJob = { id: string; kind: "duplicate" | "image"; status: "running" | "completed" | "failed"; step: string; message: string; percent: number; currentTable: string | null; errors: number; startedAt: string; finishedAt: string | null; sharedDatabase?: boolean; result?: { name: string; port: number; database: string; databaseCloned: boolean } };

function Icon({ name, size = 17 }: { name: "box" | "docker" | "vessel" | "sun" | "moon" | "plus" | "play" | "stop" | "refresh" | "external" | "loader" | "check" | "alert" | "copy" | "image" | "database" | "layers" | "port" | "tag" | "terminal" | "pencil" | "chevron" | "x"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths = {
    box: <><path d="m21 8-9 5-9-5 9-5 9 5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>,
    docker: <><path d="M3 15.5h18" /><path d="M5 15.5V11h3v4.5" /><path d="M8 15.5V9h3v6.5" /><path d="M11 15.5V11h3v4.5" /><path d="M14 15.5V9h3v6.5" /><path d="M17 15.5V12h3v3.5" /><path d="M2.5 16c.7 3.3 3.1 5 7.4 5h3.2c3.7 0 6.5-1.8 8.4-5" /></>,
    vessel: <><path d="M4 17h16" /><path d="m6 17 2.2-5h7.6l2.2 5" /><path d="M8.2 12 12 5l3.8 7" /><path d="M12 5v-2" /><path d="M12 8h4" /><path d="M4 20c2 1.3 4 1.3 6 0 2 1.3 4 1.3 6 0 1.3.8 2.7 1.1 4 .7" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></>,
    moon: <><path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    play: <><path d="m8 5 11 7-11 7V5Z" /></>,
    stop: <><rect x="5" y="5" width="14" height="14" rx="2" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 0 0-14.9-3L3 11" /><path d="M3 5v6h6" /><path d="M4 13a8.1 8.1 0 0 0 14.9 3L21 13" /><path d="M21 19v-6h-6" /></>,
    external: <><path d="M14 5h5v5" /><path d="m19 5-8 8" /><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" /></>,
    loader: <><path d="M12 3v3" /><path d="M12 18v3" /><path d="m3 12 3 0" /><path d="m18 12 3 0" /><path d="m5.6 5.6 2.1 2.1" /><path d="m16.3 16.3 2.1 2.1" /><path d="m5.6 18.4 2.1-2.1" /><path d="m16.3 7.7 2.1-2.1" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    alert: <><path d="M10.3 3.4 2.1 18a2 2 0 0 0 1.7 3h16.4a2 2 0 0 0 1.7-3L13.7 3.4a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m21 15-5-5L5 20" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></>,
    port: <><path d="M8 3v6" /><path d="M16 3v6" /><path d="M5 9h14v3a7 7 0 0 1-14 0V9Z" /><path d="M12 19v2" /></>,
    tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.4V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.4 7a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1" /></>,
    terminal: <><path d="m4 17 6-5-6-5" /><path d="M12 19h8" /></>,
    pencil: <><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" /><path d="m14.5 7.5 2 2" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
    x: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
  };
  return <svg {...common} className={name === "loader" ? "icon-loader" : undefined}>{paths[name]}</svg>;
}

type FilterOption = { value: string; label: string };

function CustomSelect({ label, value, options, onChange, icon }: { label: string; value: string; options: FilterOption[]; onChange: (value: string) => void; icon?: "box" | "database" | "layers" | "image" | "port" | "tag" | "terminal" | "refresh" }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return <div className="custom-select-field"><span>{icon ? <Icon name={icon} size={14} /> : null}{label}</span><div className={`custom-select${open ? " is-open" : ""}`} ref={containerRef}><button type="button" className="custom-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)} onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }}><span>{selected?.label}</span><Icon name="chevron" size={15} /></button>{open ? <div className="custom-select-menu" role="listbox" aria-label={label}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={`custom-select-option${option.value === value ? " selected" : ""}`} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}{option.value === value ? <Icon name="check" size={14} /> : null}</button>)}</div> : null}</div></div>;
}

function EnvironmentVariablesEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"fields" | "text">("fields");
  const parseRows = (raw: string) => raw.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#")).map((line) => {
    const separator = line.indexOf("=");
    return { key: separator >= 0 ? line.slice(0, separator) : line, value: separator >= 0 ? line.slice(separator + 1) : "" };
  }).filter((row) => row.key.trim());
  const [rows, setRows] = useState<Array<{ key: string; value: string }>>(() => parseRows(value));
  useEffect(() => setRows(parseRows(value)), [value]);
  const updateRows = (nextRows: Array<{ key: string; value: string }>) => { setRows(nextRows); onChange(nextRows.filter((row) => row.key.trim()).map((row) => `${row.key.trim()}=${row.value}`).join("\n")); };
  return <div className="environment-editor"><div className="variables-heading"><div><strong><Icon name="terminal" size={15} />{t("environment_variables")}</strong><span>{t("optional_key_value")}</span></div><div className="variables-mode"><button type="button" className={mode === "fields" ? "active" : ""} onClick={() => setMode("fields")}>{t("fields")}</button><button type="button" className={mode === "text" ? "active" : ""} onClick={() => setMode("text")}>{t("paste_text")}</button></div></div>{mode === "text" ? <textarea className="variables-textarea" value={value} onChange={(event) => onChange(event.target.value)} spellCheck={false} placeholder="DB_NAME=my_database\nDB_HOST=postgres\nDB_PORT=5432" rows={8} /> : rows.length ? <div className="variable-list">{rows.map((row, index) => <div className="variable-row" key={`${index}-${row.key}`}><input aria-label={`Key ${index + 1}`} value={row.key} onChange={(event) => { const next = [...rows]; next[index] = { ...next[index], key: event.target.value }; updateRows(next); }} placeholder="KEY" /><span>=</span><input aria-label={`Value ${index + 1}`} value={row.value} onChange={(event) => { const next = [...rows]; next[index] = { ...next[index], value: event.target.value }; updateRows(next); }} placeholder="value" /><button type="button" className="variable-remove" onClick={() => updateRows(rows.filter((_, rowIndex) => rowIndex !== index))} aria-label={`Remove variable ${index + 1}`}>×</button></div>)}</div> : <div className="variables-empty"><Icon name="terminal" size={18} />{t("no_variables")}<button type="button" onClick={() => updateRows([...rows, { key: "", value: "" }])}>{t("add_first_variable")}</button></div>}{mode === "fields" ? <button type="button" className="small-add-button variable-add" onClick={() => updateRows([...rows, { key: "", value: "" }])}><Icon name="plus" size={14} />{t("add_variable")}</button> : null}</div>;
}

function environmentLabel(value: Service["environment"]): string {
  return { latest: "Latest", test: "Prueba", candidate: "Candidato", full: "Full" }[value];
}

const categoryIcon: Record<ServiceCategory, "box" | "database" | "layers"> = { application: "box", database: "database", external: "box" };
const restartPolicyOptions: FilterOption[] = [{ value: "no", label: "no" }, { value: "always", label: "always" }, { value: "unless-stopped", label: "unless-stopped" }, { value: "on-failure", label: "on-failure" }];
const formatBytes = (value?: number) => value === undefined ? "—" : value < 1024 * 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;

export default function InventoryWorkspace({ initialView }: { initialView: "containers" | "images" | "volumes" | "networks" }) {
  const router = useRouter();
  const { language, t } = useI18n();
  const [authReady, setAuthReady] = useState(false);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [serviceHost, setServiceHost] = useState("");
  const [syncState, setSyncState] = useState("not-configured");
  const [discoveredCount, setDiscoveredCount] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [view, setView] = useState<"containers" | "images" | "volumes" | "networks">(initialView);
  const [containerLayout, setContainerLayout] = useState<"cards" | "table">("cards");
  const [openTableMenu, setOpenTableMenu] = useState<string | null>(null);
  const [images, setImages] = useState<ImageResource[]>([]);
  const [imageQuery, setImageQuery] = useState("");
  const [imageFilter, setImageFilter] = useState("all");
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [imageDeleteConfirm, setImageDeleteConfirm] = useState(false);
  const [imageDeleting, setImageDeleting] = useState(false);
  const [imagePullName, setImagePullName] = useState("");
  const [volumes, setVolumes] = useState<VolumeResource[]>([]);
  const [createVolumeOpen, setCreateVolumeOpen] = useState(false);
  const [createVolumeName, setCreateVolumeName] = useState("");
  const [volumeCreating, setVolumeCreating] = useState(false);
  const [volumeDetails, setVolumeDetails] = useState<VolumeResource | null>(null);
  const [deleteVolume, setDeleteVolume] = useState<VolumeResource | null>(null);
  const [volumeConfirmName, setVolumeConfirmName] = useState("");
  const [volumeDeleting, setVolumeDeleting] = useState(false);
  const [networks, setNetworks] = useState<NetworkResource[]>([]);
  const [networkContainers, setNetworkContainers] = useState<ContainerOption[]>([]);
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [selectedNetworkContainerId, setSelectedNetworkContainerId] = useState("");
  const [networkAction, setNetworkAction] = useState<string | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [logService, setLogService] = useState<{ name: string; logs: string } | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [logsLoading, setLogsLoading] = useState<string | null>(null);
  const [logsPosition, setLogsPosition] = useState({ x: 0, y: 0 });
  const [draggingLogs, setDraggingLogs] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dismissedJobs = useRef<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; message: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ service: Service; action: "start" | "stop" | "restart" | "recreate" } | null>(null);
  const [deleteService, setDeleteService] = useState<Service | null>(null);
  const [editService, setEditService] = useState<Service | null>(null);
  const [editName, setEditName] = useState("");
  const [editPort, setEditPort] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editRegistry, setEditRegistry] = useState("");
  const [editVariables, setEditVariables] = useState("");
  const [editTab, setEditTab] = useState<"container" | "variables">("container");
  const [editNetworkId, setEditNetworkId] = useState("preserve");
  const [editRestartPolicy, setEditRestartPolicy] = useState("preserve");
  const [editMaxRetries, setEditMaxRetries] = useState("0");
  const [duplicateService, setDuplicateService] = useState<Service | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicatePort, setDuplicatePort] = useState("");
  const [duplicateDatabase, setDuplicateDatabase] = useState("");
  const [duplicateImage, setDuplicateImage] = useState("");
  const [duplicateVariables, setDuplicateVariables] = useState("");
  const [duplicateTab, setDuplicateTab] = useState<"container" | "variables">("container");
  const [duplicateMode, setDuplicateMode] = useState<"database" | "application">("database");
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const [duplicateNetworkId, setDuplicateNetworkId] = useState("preserve");
  const [duplicateRestartPolicy, setDuplicateRestartPolicy] = useState("preserve");
  const [duplicateMaxRetries, setDuplicateMaxRetries] = useState("0");
  const [cloneJob, setCloneJob] = useState<CloneJob | null>(null);
  const [cloneJobMinimized, setCloneJobMinimized] = useState(false);
  const [newServiceOpen, setNewServiceOpen] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceImage, setNewServiceImage] = useState("");
  const [newServiceInternalPort, setNewServiceInternalPort] = useState("8080");
  const [newServicePublicPort, setNewServicePublicPort] = useState("");
  const [newServiceVariables, setNewServiceVariables] = useState("");
  const [newServiceTab, setNewServiceTab] = useState<"container" | "variables">("container");
  const [newServiceRestartPolicy, setNewServiceRestartPolicy] = useState<RestartPolicy>("no");
  const [newServiceMaxRetries, setNewServiceMaxRetries] = useState("0");
  const [labelsByContainer, setLabelsByContainer] = useState<Record<string, string[]>>({});
  const [labelService, setLabelService] = useState<Service | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [labelSaving, setLabelSaving] = useState(false);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (data.user) setAuthReady(true);
      else router.replace("/login");
    }).catch(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    const stored = window.localStorage.getItem("vessel-container-layout");
    if (stored === "table" || stored === "cards") setContainerLayout(stored);
  }, []);

  function changeContainerLayout(layout: "cards" | "table") {
    setContainerLayout(layout);
    window.localStorage.setItem("vessel-container-layout", layout);
  }

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), toast.kind === "info" ? 5000 : 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function copyImage(image: string | null) {
    if (!image) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(image);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = image;
        textArea.setAttribute("readonly", "");
        textArea.style.position = "fixed";
        textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.select();
        if (!document.execCommand("copy")) throw new Error("copy-failed");
        textArea.remove();
      }
      setToast({ kind: "success", message: "Imagen copiada al portapapeles." });
    } catch {
      setToast({ kind: "error", message: "No fue posible copiar la imagen." });
    }
  }

  function toggleImage(imageId: string) {
    setSelectedImages((current) => {
      const next = new Set(current);
      if (next.has(imageId)) next.delete(imageId); else next.add(imageId);
      return next;
    });
  }

  async function deleteSelectedImages() {
    setImageDeleting(true);
    try {
      const response = await fetch("/api/resources", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageIds: [...selectedImages] }) });
      const payload = await response.json();
      if (!response.ok) {
        const used = (payload.used ?? []).map((item: { container?: string }) => item.container).filter(Boolean).join(", ");
        throw new Error(used ? `${payload.error}: ${used}` : (payload.error ?? "No fue posible borrar las imágenes"));
      }
      setImageDeleteConfirm(false);
      setSelectedImages(new Set());
      const refresh = await fetch("/api/resources?type=images", { cache: "no-store" });
      const refreshed = await refresh.json();
      setImages(refreshed.data ?? []);
      setToast({ kind: "success", message: `${payload.deleted?.length ?? 0} imagen(es) eliminada(s).` });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible borrar las imágenes" });
    } finally {
      setImageDeleting(false);
    }
  }

  async function deleteSelectedVolume() {
    if (!deleteVolume || volumeConfirmName !== deleteVolume.Name || deleteVolume.usedBy?.length || volumeDeleting) return;
    setVolumeDeleting(true);
    try {
      const response = await fetch("/api/resources", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ volumeName: deleteVolume.Name }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.usedBy?.length ? `${payload.error}: ${payload.usedBy.join(", ")}` : payload.error ?? "No se pudo borrar el volumen");
      setVolumes((current) => current.filter((volume) => volume.Name !== deleteVolume.Name));
      setToast({ kind: "success", message: language === "es" ? `Volumen ${deleteVolume.Name} eliminado.` : `Volume ${deleteVolume.Name} removed.` });
      setDeleteVolume(null);
      setVolumeConfirmName("");
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No se pudo borrar el volumen" });
    } finally { setVolumeDeleting(false); }
  }

  async function createVolume() {
    if (!createVolumeName.trim() || volumeCreating) return;
    setVolumeCreating(true);
    try {
      const response = await fetch("/api/resources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create_volume", volumeName: createVolumeName.trim() }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No se pudo crear el volumen");
      setVolumes((current) => [...current, { ...payload.data, usedBy: [] }].sort((a, b) => a.Name.localeCompare(b.Name)));
      setCreateVolumeOpen(false);
      setCreateVolumeName("");
      setToast({ kind: "success", message: language === "es" ? "Volumen creado correctamente." : "Volume created successfully." });
    } catch (error) { setToast({ kind: "error", message: error instanceof Error ? error.message : "No se pudo crear el volumen" }); }
    finally { setVolumeCreating(false); }
  }

  async function pullImage() {
    const image = imagePullName.trim();
    if (!image) return;
    try {
      const response = await fetch("/api/resources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pull", image }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible descargar la imagen");
      setImagePullName("");
      setCloneJobMinimized(false);
      const jobResponse = await fetch(`/api/jobs?id=${encodeURIComponent(payload.jobId)}`, { cache: "no-store" });
      const jobPayload = await jobResponse.json();
      setCloneJob(jobPayload.data ?? null);
      setToast({ kind: "info", message: `Descarga iniciada: ${image}` });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible descargar la imagen" });
    }
  }

  async function openLogs(service: Service) {
    setLogsLoading(service.id);
    try {
      const response = await fetch(`/api/logs?serviceId=${encodeURIComponent(service.id)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible leer los logs");
      setLogService({ name: payload.name ?? service.name, logs: payload.data ?? "Sin logs" });
      setLogsExpanded(false);
      setLogsPosition({ x: 0, y: 0 });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible leer los logs" });
    } finally {
      setLogsLoading(null);
    }
  }

  function startDraggingLogs(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    dragOffset.current = { x: event.clientX - logsPosition.x, y: event.clientY - logsPosition.y };
    setDraggingLogs(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  useEffect(() => {
    if (!draggingLogs) return;
    const move = (event: PointerEvent) => setLogsPosition({ x: event.clientX - dragOffset.current.x, y: event.clientY - dragOffset.current.y });
    const stop = () => setDraggingLogs(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
  }, [draggingLogs]);

  useEffect(() => {
    if (view === "containers") return;
    const type = view;
    setResourceLoading(true);
    fetch(`/api/resources?type=${type}`, { cache: "no-store" }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible leer Docker");
      if (type === "images") setImages(payload.data ?? []);
      else if (type === "volumes") setVolumes(payload.data ?? []);
      else { setNetworks(payload.data ?? []); setNetworkContainers(payload.containers ?? []); setSelectedNetworkId((current) => current || payload.data?.[0]?.Id || ""); setSelectedNetworkContainerId((current) => current || payload.containers?.[0]?.id || ""); }
    }).catch((error) => setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible leer Docker" })).finally(() => setResourceLoading(false));
  }, [view]);

  async function changeNetworkConnection(networkId: string, containerId: string, action: "connect" | "disconnect") {
    const key = `${action}:${networkId}:${containerId}`;
    setNetworkAction(key);
    try {
      const response = await fetch("/api/resources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, networkId, containerId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible modificar la red");
      setToast({ kind: "success", message: action === "connect" ? "Contenedor conectado a la red." : "Contenedor desconectado de la red." });
      setView("networks");
      const refresh = await fetch("/api/resources?type=networks", { cache: "no-store" });
      const refreshed = await refresh.json();
      setNetworks(refreshed.data ?? []);
      setNetworkContainers(refreshed.containers ?? []);
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible modificar la red" });
    } finally {
      setNetworkAction(null);
    }
  }

  async function refreshServices() {
    const response = await fetch("/api/services", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "El backend Docker no respondió al actualizar el estado");
    setCatalog(payload.data ?? []);
    setServiceHost(payload.meta?.host ?? window.location.hostname);
    setSyncState(payload.meta?.dockerSync ?? "unknown");
    setDiscoveredCount(typeof payload.meta?.discovered === "number" ? payload.meta.discovered : null);
  }

  async function refreshLabels() {
    try {
      const response = await fetch("/api/labels", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) setLabelsByContainer(payload.data ?? {});
    } catch {
      // Las etiquetas son metadatos opcionales; no bloquean el catálogo de Docker.
    }
  }

  function openLabelManager(service: Service) {
    setLabelService(service);
    setLabelDraft("");
  }

  async function saveLabel() {
    if (!labelService || !labelDraft.trim()) return;
    setLabelSaving(true);
    try {
      const response = await fetch("/api/labels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ containerId: labelService.id, label: labelDraft }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible guardar la etiqueta");
      setLabelsByContainer((current) => ({ ...current, [labelService.id]: [...new Set([...(current[labelService.id] ?? []), payload.label])] }));
      setLabelDraft("");
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible guardar la etiqueta" });
    } finally {
      setLabelSaving(false);
    }
  }

  async function deleteLabel(label: string) {
    if (!labelService) return;
    try {
      const response = await fetch("/api/labels", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ containerId: labelService.id, label }) });
      if (!response.ok) throw new Error("No fue posible eliminar la etiqueta");
      setLabelsByContainer((current) => ({ ...current, [labelService.id]: (current[labelService.id] ?? []).filter((item) => item !== label) }));
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible eliminar la etiqueta" });
    }
  }

  async function refreshWithRetry(attempts = 4) {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await refreshServices();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No fue posible actualizar el estado");
  }

  async function executeServiceAction(service: Service, action: "start" | "stop" | "restart" | "recreate") {
    const labels = { start: "iniciar", stop: "detener", restart: "reiniciar", recreate: "recrear" };
    const completedLabels = { start: "iniciado", stop: "detenido", restart: "reiniciado", recreate: "recreado" };
    setPendingAction(`${service.id}:${action}`);
    setConfirmation(null);
    setToast({ kind: "info", message: `Solicitando ${labels[action]} ${service.name}…` });
    try {
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: service.id, action }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible ejecutar la acción");
      setToast({ kind: "info", message: `${service.name} fue ${completedLabels[action]}. Actualizando estado…` });
      await refreshWithRetry();
      setToast({ kind: "success", message: `${service.name} fue ${completedLabels[action]} correctamente.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No fue posible ejecutar la acción";
      setToast({ kind: "error", message: message === "Failed to fetch" ? `${service.name} pudo cambiar, pero no se pudo actualizar la pantalla.` : message });
    } finally {
      setPendingAction(null);
    }
  }

  function requestServiceAction(service: Service, action: "start" | "stop" | "restart" | "recreate") {
    setConfirmation({ service, action });
  }

  async function executeDeleteService() {
    if (!deleteService) return;
    const service = deleteService;
    setPendingAction(`${service.id}:delete`);
    setDeleteService(null);
    setToast({ kind: "info", message: `Borrando ${service.name}…` });
    try {
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: service.id, action: "delete" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible borrar el contenedor");
      await refreshWithRetry();
      setToast({ kind: "success", message: `${service.name} fue borrado correctamente.` });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible borrar el contenedor" });
    } finally {
      setPendingAction(null);
    }
  }

  function openEdit(service: Service) {
    setEditService(service);
    setEditName(service.name);
    setEditPort(service.port ? String(service.port) : "");
    const image = service.image ?? "";
    const imageParts = image.split("/");
    const registry = imageParts.length > 1 && (imageParts[0].includes(".") || imageParts[0].includes(":")) ? imageParts.shift() ?? "" : "docker.io";
    setEditRegistry(registry);
    setEditImage(imageParts.join("/") || image);
    setEditVariables((service.environmentVariables ?? []).join("\n"));
    setEditTab("container");
    setEditNetworkId("preserve");
    setEditRestartPolicy(service.restartPolicy?.name ?? "no");
    setEditMaxRetries(String(service.restartPolicy?.maxRetries ?? 0));
    void loadNetworksForEdit();
  }

  async function loadNetworksForEdit() {
    try {
      const response = await fetch("/api/resources?type=networks", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) setNetworks(payload.data ?? []);
    } catch {
      // El selector conserva la opción segura aunque el backend Docker no responda.
    }
  }

  function openDuplicate(service: Service) {
    const suggestedPort = nextAvailablePort(catalog.map((item) => item.port));
    setDuplicateService(service);
    setDuplicateName(`${service.name}_2`);
    setDuplicatePort(service.port ? String(suggestedPort) : "");
    setDuplicateDatabase(service.databaseTarget ? `${service.databaseTarget}_2` : "");
    setDuplicateImage(service.image || "");
    setDuplicateVariables((service.environmentVariables ?? []).join("\n"));
    setDuplicateTab("container");
    setDuplicateMode(service.databaseTarget ? "database" : "application");
    setDuplicateAcknowledged(!service.databaseTarget);
    setDuplicateNetworkId("preserve");
    setDuplicateRestartPolicy("preserve");
    setDuplicateMaxRetries(String(service.restartPolicy?.maxRetries ?? 0));
    void loadNetworksForEdit();
  }

  function openCreateService() {
    const suggestedPort = nextAvailablePort(catalog.map((item) => item.port));
    setNewServiceName("");
    setNewServiceImage("");
    setNewServiceInternalPort("8080");
    setNewServicePublicPort(String(suggestedPort));
    setNewServiceVariables("");
    setNewServiceTab("container");
    setNewServiceRestartPolicy("no");
    setNewServiceMaxRetries("0");
    setNewServiceOpen(true);
  }

  async function saveNewService() {
    const name = newServiceName.trim();
    const image = newServiceImage.trim();
    const publicPort = Number(newServicePublicPort);
    const internalPort = Number(newServiceInternalPort);
    if (!name || !image || !publicPort || !internalPort) return;
    setPendingAction("new:create");
    setToast({ kind: "info", message: `Preparando el nuevo servicio ${name}…` });
    try {
      const environmentVariables = newServiceVariables.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line.includes("=") && !line.startsWith("#"));
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", newName: name, newImage: image, newPort: publicPort, internalPort, environmentVariables, restartPolicy: { name: newServiceRestartPolicy, maxRetries: Number(newServiceMaxRetries) || 0 } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible crear el servicio");
      setNewServiceOpen(false);
      setCloneJobMinimized(false);
      const jobResponse = await fetch(`/api/jobs?id=${encodeURIComponent(payload.jobId)}`, { cache: "no-store" });
      const jobPayload = await jobResponse.json();
      setCloneJob(jobPayload.data ?? null);
      setToast({ kind: "info", message: "Creación iniciada. Puedes seguir usando el portal." });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible crear el servicio" });
    } finally {
      setPendingAction(null);
    }
  }

  async function saveDuplicate() {
    if (!duplicateService) return;
    const name = duplicateName.trim();
    const cloneDatabase = duplicateMode === "database";
    const database = duplicateDatabase.trim();
    const port = Number(duplicatePort);
    setPendingAction(`${duplicateService.id}:duplicate`);
    setToast({ kind: "info", message: cloneDatabase ? `Clonando la base y preparando ${name}…` : `Duplicando ${name}…` });
    try {
      const environmentVariables = duplicateVariables.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line.includes("=") && !line.startsWith("#"));
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: duplicateService.id, action: "duplicate", newName: name, newPort: port, targetDatabase: database, cloneDatabase, newImage: duplicateImage.trim(), environmentVariables, networkId: duplicateNetworkId === "preserve" ? undefined : duplicateNetworkId, restartPolicy: duplicateRestartPolicy === "preserve" ? undefined : { name: duplicateRestartPolicy, maxRetries: Number(duplicateMaxRetries) || 0 } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible duplicar el servicio");
      setDuplicateService(null);
      setCloneJobMinimized(false);
      const jobResponse = await fetch(`/api/jobs?id=${encodeURIComponent(payload.jobId)}`, { cache: "no-store" });
      const jobPayload = await jobResponse.json();
      setCloneJob(jobPayload.data ?? null);
      setToast({ kind: "info", message: "Trabajo iniciado. Puedes seguir usando el portal." });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible duplicar el servicio" });
    } finally {
      setPendingAction(null);
    }
  }

  async function saveEdit() {
    if (!editService) return;
    const name = editName.trim();
    const port = Number(editPort);
    setPendingAction(`${editService.id}:edit`);
    setToast({ kind: "info", message: `Deteniendo y recreando ${editService.name}…` });
    try {
      const image = `${editRegistry}/${editImage.trim()}`;
      const environmentVariables = editVariables.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line.includes("=") && !line.startsWith("#"));
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: editService.id, action: "edit", newName: name, newPort: port, newImage: image, environmentVariables, networkId: editNetworkId === "preserve" ? undefined : editNetworkId, restartPolicy: { name: editRestartPolicy, maxRetries: Number(editMaxRetries) || 0 } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible editar el contenedor");
      setEditService(null);
      if (payload.jobId) {
        const jobResponse = await fetch(`/api/jobs?id=${encodeURIComponent(payload.jobId)}`, { cache: "no-store" });
        const jobPayload = await jobResponse.json();
        setCloneJobMinimized(false);
        setCloneJob(jobPayload.data ?? null);
        setToast({ kind: "info", message: "Descarga de imagen iniciada. Puedes seguir usando el portal." });
        return;
      }
      await refreshWithRetry();
      setToast({ kind: "success", message: `Servicio actualizado: ${name} · puerto ${port}.` });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible editar el contenedor" });
    } finally {
      setPendingAction(null);
    }
  }

  async function retryCloneJob() {
    if (!cloneJob) return;
    try {
      const response = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: cloneJob.id, action: "retry" }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible reintentar la descarga");
      setCloneJob(payload.data ?? null);
      setCloneJobMinimized(false);
      setToast({ kind: "info", message: "Reintento iniciado. La imagen se está descargando nuevamente." });
    } catch (error) {
      setToast({ kind: "error", message: error instanceof Error ? error.message : "No fue posible reintentar la descarga" });
    }
  }

  function dismissCloneJob() {
    if (!cloneJob) return;
    const dismissed = new Set(dismissedJobs.current);
    dismissed.add(cloneJob.id);
    dismissedJobs.current = dismissed;
    window.sessionStorage.setItem("dockpilot-dismissed-jobs", JSON.stringify([...dismissed]));
    setCloneJob(null);
  }

  useEffect(() => {
    refreshServices().catch(() => {
      setCatalog([]);
      setDiscoveredCount(0);
      setSyncState("error");
    });
    void refreshLabels();
  }, []);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem("dockpilot-dismissed-jobs") ?? "[]");
      if (Array.isArray(saved)) dismissedJobs.current = new Set(saved.filter((id): id is string => typeof id === "string"));
    } catch {
      dismissedJobs.current = new Set();
    }
    let previousJob: CloneJob | null = null;
    const syncJobs = async () => {
      try {
        const response = await fetch("/api/jobs", { cache: "no-store" });
        const payload = await response.json() as { data?: CloneJob[] };
        const latest = payload.data?.[0] as CloneJob | undefined;
        if (!latest) return;
        if (latest.status !== "running" && dismissedJobs.current.has(latest.id)) {
          setCloneJob(null);
          return;
        }
        setCloneJob(latest);
        if (previousJob?.id === latest.id && previousJob.status === "running" && latest.status === "completed") {
          refreshWithRetry().catch(() => undefined);
          setToast({ kind: "success", message: latest.message });
        } else if (previousJob?.id === latest.id && previousJob.status === "running" && latest.status === "failed") {
          setToast({ kind: "error", message: latest.message });
        }
        previousJob = latest;
      } catch {
        // La próxima sincronización recupera el estado compartido.
      }
    };
    void syncJobs();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void syncJobs(); }, 2000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refreshServices().catch(() => undefined); }, 15000);
    return () => window.clearInterval(timer);
  }, []);
  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return catalog.filter((service) => {
      const matchesQuery = !normalizedQuery || `${service.name} ${service.port} ${service.image ?? ""} ${(labelsByContainer[service.id] ?? []).join(" ")}`.toLowerCase().includes(normalizedQuery);
      const matchesEnvironment = environment === "all" || service.environment === environment;
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? service.status === "running" : service.status !== "running");
      return matchesQuery && matchesEnvironment && matchesStatus;
    }).sort((left, right) => Number(right.status === "running") - Number(left.status === "running"));
  }, [catalog, query, environment, statusFilter, labelsByContainer]);
  const filteredImages = useMemo(() => {
    const normalized = imageQuery.trim().toLowerCase();
    return images.filter((image) => {
      const untagged = !image.RepoTags?.length;
      const unused = image.used === false;
      const searchable = `${image.RepoTags?.join(" ") ?? ""} ${image.RepoDigests?.join(" ") ?? ""} ${image.Id}`.toLowerCase();
      return (!normalized || searchable.includes(normalized)) && (imageFilter !== "untagged" || untagged) && (imageFilter !== "unused" || unused);
    });
  }, [images, imageQuery, imageFilter]);
  const totalImageBytes = images.reduce((total, image) => total + (image.Size ?? 0), 0);
  const allFilteredImagesSelected = filteredImages.length > 0 && filteredImages.every((image) => selectedImages.has(image.Id));

  const duplicateSourceDatabase = duplicateService?.databaseTarget?.trim().toLowerCase() ?? "";
  const duplicateTargetDatabase = duplicateDatabase.trim().toLowerCase();
  const duplicateUsesSameDatabase = Boolean(duplicateService && duplicateSourceDatabase && duplicateTargetDatabase === duplicateSourceDatabase);
  const duplicateBlocked = duplicateMode === "application" ? Boolean(duplicateService?.databaseTarget) && !duplicateAcknowledged : duplicateUsesSameDatabase;
  const isServicePending = (serviceId: string) => Boolean(pendingAction?.startsWith(`${serviceId}:`));

  if (!authReady) return <main className="app-content inventory-workspace"><div className="inventory-loading">{language === "es" ? "Cargando recursos…" : "Loading resources…"}</div></main>;

  return (
    <main className="app-content inventory-workspace">
      <header className="topbar">
        <div className="inventory-title"><span className="overview-eyebrow">DOCKER / {t(view)}</span><h1>{t(view)}</h1></div>
        <div className="topbar-badges">{view === "containers" ? <button className="new-service-button" type="button" onClick={openCreateService} disabled={pendingAction !== null}><Icon name="plus" size={16} />{t("new_service")}</button> : null}{view === "volumes" ? <button className="new-service-button" type="button" onClick={() => setCreateVolumeOpen(true)}><Icon name="plus" size={16} />{language === "es" ? "Nuevo volumen" : "New volume"}</button> : null}{serviceHost ? <span className="host-badge">Host · {serviceHost}</span> : null}</div>
      </header>

      {view === "containers" ? <section className="hero">
        <div><h2>{t("find_environment")}</h2><p>{t("search_hint")}</p></div>
        <div className="hero-metric"><strong>{catalog.length}</strong><span>{t("registered_services")}</span></div>
      </section> : null}

      {view === "containers" ? <section className="toolbar" aria-label="Filtros">
        <label className="search"><span>{t("search")}</span><div className="input-with-clear"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search_placeholder")} />{query ? <button className="clear-search" type="button" onClick={() => setQuery("")} aria-label={t("clear_search")} title={t("clear_search")}>×</button> : null}</div></label>
        <CustomSelect label={t("environment")} value={environment} onChange={setEnvironment} options={[{ value: "all", label: t("all") }, { value: "latest", label: "Latest" }, { value: "test", label: t("test") }, { value: "candidate", label: t("candidate") }, { value: "full", label: "Full" }]} />
        <CustomSelect label={t("status")} value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: t("all") }, { value: "active", label: t("active") }, { value: "inactive", label: t("inactive") }]} />
        <span className="result-count">{filtered.length} {filtered.length === 1 ? t("result") : t("results")}</span>
      </section> : null}
      {toast ? <div className={`toast toast-${toast.kind}`} role="status"><span className="toast-icon"><Icon name={toast.kind === "info" ? "loader" : toast.kind === "success" ? "check" : "alert"} size={19} /></span><span>{toast.message}</span><button type="button" aria-label="Cerrar aviso" onClick={() => setToast(null)}>×</button></div> : null}
      {cloneJob ? <aside className={`job-panel${cloneJobMinimized ? " job-panel-minimized" : ""}`} aria-live="polite"><div className="job-panel-head"><div><span className="modal-kicker">{cloneJob.kind === "image" ? "Cambio de imagen" : "Duplicación"} · {cloneJob.status === "running" ? "En curso" : cloneJob.status === "completed" ? "Completada" : "Revisar"}</span>{!cloneJobMinimized ? <strong>{cloneJob.result?.name ?? (cloneJob.kind === "image" ? "Cambio de imagen" : "Nuevo ambiente")}</strong> : null}</div><div className="job-panel-buttons">{cloneJob.status === "failed" && cloneJob.kind === "image" ? <button type="button" onClick={retryCloneJob} aria-label="Reintentar descarga">↻</button> : null}<button type="button" onClick={() => setCloneJobMinimized((value) => !value)} aria-label={cloneJobMinimized ? "Maximizar progreso" : "Minimizar progreso"}>{cloneJobMinimized ? "□" : "—"}</button><button type="button" onClick={dismissCloneJob} aria-label="Cerrar resumen">×</button></div></div>{!cloneJobMinimized ? <><div className="job-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, cloneJob.percent))}%` }} /></div><div className="job-progress-meta"><span>{cloneJob.message}</span><b>{cloneJob.percent}%</b></div>{cloneJob.sharedDatabase ? <div className="job-warning"><Icon name="alert" size={15} /><span><strong>BD compartida</strong> Esta duplicación crea solo la aplicación; no restaura ni crea una base de datos independiente.</span></div> : null}{cloneJob.currentTable ? <div className="job-detail">Tabla actual: <strong>{cloneJob.currentTable}</strong></div> : null}<div className="job-detail">{cloneJob.kind === "image" ? "La imagen se descarga antes de recrear el contenedor." : cloneJob.errors ? `Errores reportados: ${cloneJob.errors} · la restauración continúa` : "Sin errores reportados"}</div>{cloneJob.status === "completed" && cloneJob.result ? <div className="job-detail job-success">✓ Operación completada · {cloneJob.result.port ? `puerto ${cloneJob.result.port}` : "sin puerto publicado"}</div> : null}{cloneJob.status === "failed" && cloneJob.kind === "image" ? <button className="job-retry-button" type="button" onClick={retryCloneJob}>↻ Reintentar descarga</button> : null}</> : null}</aside> : null}
      {labelService ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal edit-modal label-modal" role="dialog" aria-modal="true" aria-labelledby="labels-title"><span className="modal-kicker"><Icon name="tag" size={13} />Metadatos de Vessel</span><h2 id="labels-title"><Icon name="tag" size={19} />Etiquetas del contenedor</h2><p>Organiza <strong>{labelService.name}</strong> con etiquetas propias del portal. No modifican Docker.</p><div className="label-chips">{(labelsByContainer[labelService.id] ?? []).map((label) => <span className="label-chip" key={label}>{label}<button type="button" onClick={() => deleteLabel(label)} aria-label="Quitar etiqueta">×</button></span>)}{!(labelsByContainer[labelService.id] ?? []).length ? <span className="labels-empty">Aún no hay etiquetas asignadas.</span> : null}</div><div className="label-add-row"><input value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveLabel(); } }} maxLength={64} placeholder="ej. cliente, pruebas, prioridad-alta" autoFocus /><button className="primary-button" type="button" onClick={saveLabel} disabled={!labelDraft.trim() || labelSaving}>{labelSaving ? <><Icon name="loader" size={15} />Guardando…</> : <><Icon name="plus" size={15} />Agregar</>}</button></div><div className="modal-actions"><button type="button" onClick={() => setLabelService(null)}><Icon name="x" size={14} />{t("close")}</button></div></section></div> : null}
      {createVolumeOpen ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal volume-modal" role="dialog" aria-modal="true" aria-labelledby="volume-create-title"><span className="modal-kicker"><Icon name="database" size={14} />Docker · {t("volumes")}</span><h2 id="volume-create-title"><Icon name="plus" size={19} />{language === "es" ? "Crear volumen" : "Create volume"}</h2><p>{language === "es" ? "Se creará un volumen local sin asociarlo todavía a ningún contenedor." : "A local volume will be created without attaching it to a container."}</p><label className="modal-field"><span>{language === "es" ? "Nombre del volumen" : "Volume name"}</span><input value={createVolumeName} onChange={(event) => setCreateVolumeName(event.target.value)} maxLength={128} placeholder="mi-volumen" autoFocus /></label><div className="modal-actions"><button type="button" onClick={() => setCreateVolumeOpen(false)} disabled={volumeCreating}>{t("cancel")}</button><button className="primary-button" type="button" onClick={createVolume} disabled={volumeCreating || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(createVolumeName.trim())}><Icon name={volumeCreating ? "loader" : "plus"} size={15} />{volumeCreating ? (language === "es" ? "Creando…" : "Creating…") : (language === "es" ? "Crear volumen" : "Create volume")}</button></div></section></div> : null}
      {volumeDetails ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal volume-modal" role="dialog" aria-modal="true" aria-labelledby="volume-details-title"><span className="modal-kicker"><Icon name="database" size={14} />Docker · {t("volumes")}</span><h2 id="volume-details-title">{volumeDetails.Name}</h2><dl className="volume-details"><div><dt>Driver</dt><dd>{volumeDetails.Driver ?? "local"}</dd></div><div><dt>{language === "es" ? "Ruta" : "Mountpoint"}</dt><dd>{volumeDetails.Mountpoint ?? "—"}</dd></div><div><dt>{language === "es" ? "Contenedores asociados" : "Attached containers"}</dt><dd>{volumeDetails.usedBy?.length ? volumeDetails.usedBy.join(", ") : "—"}</dd></div><div><dt>{language === "es" ? "Etiquetas Docker" : "Docker labels"}</dt><dd>{Object.keys(volumeDetails.Labels ?? {}).length ? Object.entries(volumeDetails.Labels ?? {}).map(([key, value]) => <span key={key}>{key}: {value}<br /></span>) : "—"}</dd></div></dl><div className="modal-actions"><button type="button" onClick={() => setVolumeDetails(null)}>{t("close")}</button></div></section></div> : null}
      {deleteVolume ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal volume-modal" role="alertdialog" aria-modal="true" aria-labelledby="volume-delete-title"><span className="modal-kicker"><Icon name="alert" size={14} />Docker · {t("volumes")}</span><h2 id="volume-delete-title">{language === "es" ? "Eliminar volumen" : "Delete volume"}</h2><p>{language === "es" ? "Esta acción borra permanentemente los datos almacenados en" : "This permanently removes all data stored in"} <strong>{deleteVolume.Name}</strong>. {language === "es" ? "No es posible deshacerla." : "It cannot be undone."}</p><label className="modal-field"><span>{language === "es" ? "Escribe el nombre exacto para confirmar" : "Type the exact name to confirm"}</span><input value={volumeConfirmName} onChange={(event) => setVolumeConfirmName(event.target.value)} autoComplete="off" spellCheck={false} /></label><div className="modal-actions"><button type="button" onClick={() => setDeleteVolume(null)} disabled={volumeDeleting}>{t("cancel")}</button><button className="danger-button" type="button" onClick={deleteSelectedVolume} disabled={volumeDeleting || volumeConfirmName !== deleteVolume.Name || Boolean(deleteVolume.usedBy?.length)}><Icon name={volumeDeleting ? "loader" : "alert"} size={15} />{volumeDeleting ? (language === "es" ? "Eliminando…" : "Deleting…") : t("delete")}</button></div></section></div> : null}
      {imageDeleteConfirm ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="image-delete-title"><span className="modal-kicker">Imágenes de Docker</span><h2 id="image-delete-title">Borrar imágenes seleccionadas</h2><p>¿Confirmas borrar <strong>{selectedImages.size} imagen(es)</strong>? El servidor verificará todos los contenedores, incluso los inactivos. Si alguna imagen está en uso, no se borrará ninguna.</p><div className="modal-actions"><button type="button" onClick={() => setImageDeleteConfirm(false)} disabled={imageDeleting}>{t("cancel")}</button><button className="danger-button" type="button" onClick={deleteSelectedImages} disabled={imageDeleting}>{imageDeleting ? <><Icon name="loader" size={15} />Borrando…</> : <><Icon name="alert" size={15} />Confirmar borrado</>}</button></div></section></div> : null}

      {newServiceOpen ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal edit-modal new-service-modal" role="dialog" aria-modal="true" aria-labelledby="new-service-title"><span className="modal-kicker">Vessel · Nuevo servicio</span><h2 id="new-service-title"><Icon name="plus" size={19} />Crear servicio</h2><p>Se descargará la imagen Docker y se creará un contenedor nuevo. Para conservar variables, volúmenes y configuración de otro servicio usa <strong>{t("duplicate")}</strong>.</p><div className="modal-tabs" role="tablist"><button type="button" className={newServiceTab === "container" ? "active" : ""} onClick={() => setNewServiceTab("container")}><Icon name="box" size={14} />Contenedor</button><button type="button" className={newServiceTab === "variables" ? "active" : ""} onClick={() => setNewServiceTab("variables")}><Icon name="terminal" size={14} />{t("variables")}</button></div>{newServiceTab === "container" ? <div className="modal-tab-content"><label className="modal-field"><span>{t("container_name")}</span><input value={newServiceName} onChange={(event) => setNewServiceName(event.target.value)} autoFocus maxLength={128} placeholder="mi-servicio" /></label><label className="modal-field"><span>{t("docker_image")}</span><input value={newServiceImage} onChange={(event) => setNewServiceImage(event.target.value)} maxLength={512} placeholder="registry/organizacion/imagen:tag" /></label><div className="new-service-port-grid"><label className="modal-field"><span>{t("internal_port")}</span><input value={newServiceInternalPort} onChange={(event) => setNewServiceInternalPort(event.target.value)} type="number" min="1" max="65535" /></label><label className="modal-field"><span>{t("public_port")}</span><input value={newServicePublicPort} onChange={(event) => setNewServicePublicPort(event.target.value)} type="number" min="1" max="65535" /></label></div><CustomSelect icon="refresh" label="Política de reinicio" value={newServiceRestartPolicy} onChange={(value) => setNewServiceRestartPolicy(value as RestartPolicy)} options={restartPolicyOptions} />{newServiceRestartPolicy === "on-failure" ? <label className="modal-field retry-field"><span>{t("max_retries")}</span><input value={newServiceMaxRetries} onChange={(event) => setNewServiceMaxRetries(event.target.value)} type="number" min="0" max="1000000" /></label> : null}</div> : <EnvironmentVariablesEditor value={newServiceVariables} onChange={setNewServiceVariables} />}<p className="modal-note">El servicio se iniciará automáticamente después de crear el contenedor.</p><div className="modal-actions"><button type="button" onClick={() => setNewServiceOpen(false)} disabled={pendingAction !== null}>{t("cancel")}</button><button className="primary-button" type="button" onClick={saveNewService} disabled={pendingAction !== null || !newServiceName.trim() || !newServiceImage.trim() || !newServiceInternalPort || !newServicePublicPort}>{pendingAction === "new:create" ? <><Icon name="loader" size={15} />{t("creating")}</> : <><Icon name="plus" size={15} />Crear servicio</>}</button></div></section></div> : null}


      {view === "images" ? <section className="image-pull-panel" aria-label="Descargar imagen Docker"><div className="image-pull-copy"><span className="image-pull-icon"><Icon name="image" size={19} /></span><div><strong>{t("download_image")}</strong><span>{t("download_image_help")}</span></div></div><div className="image-pull-form"><label className="resource-search"><span>{t("docker_image")}</span><input value={imagePullName} onChange={(event) => setImagePullName(event.target.value)} placeholder="registry/organizacion/imagen:tag" /></label><button className="primary-button" type="button" onClick={pullImage} disabled={!imagePullName.trim()}><Icon name="image" size={15} />{t("download")}</button></div></section> : null}

      {view === "containers" ? <>
        <div className="container-display-toolbar"><span>{language === "es" ? "Vista" : "View"}</span><div className="container-view-switch" role="group" aria-label={language === "es" ? "Vista de contenedores" : "Container view"}><button type="button" className={containerLayout === "cards" ? "active" : ""} onClick={() => changeContainerLayout("cards")} aria-pressed={containerLayout === "cards"}><LayoutGrid size={16} />{language === "es" ? "Tarjetas" : "Cards"}</button><button type="button" className={containerLayout === "table" ? "active" : ""} onClick={() => changeContainerLayout("table")} aria-pressed={containerLayout === "table"}><List size={17} />{language === "es" ? "Tabla" : "Table"}</button></div></div>
        {containerLayout === "table" ? <div className="container-table-wrap"><table className="container-table"><thead><tr><th>{language === "es" ? "Nombre" : "Name"}</th><th>{t("status")}</th><th>Compose</th><th>{t("image")}</th><th>{t("port")}</th><th>{t("database")}</th><th>{language === "es" ? "Acciones" : "Actions"}</th></tr></thead><tbody>{filtered.map((service) => <Fragment key={service.id}><tr><td><button type="button" className="container-name-link" onClick={() => openEdit(service)}>{service.name}</button><small>{({ application: t("applications"), database: t("databases"), external: t("external_tools") } as Record<ServiceCategory, string>)[service.category]}</small></td><td><span className={`status status-${service.status}`}><span className="status-dot" />{statusLabel(service.status, t)}</span></td><td>{service.composeProject ?? "—"}</td><td className="container-table-image" title={service.image ?? undefined}>{service.image ?? "—"}</td><td>{service.port || "—"}</td><td>{service.databaseTarget ?? "—"}</td><td><div className="container-table-actions"><button type="button" onClick={() => requestServiceAction(service, service.status === "running" ? "stop" : "start")} disabled={isServicePending(service.id) || service.status === "starting"} title={service.status === "running" ? t("stop") : language === "es" ? "Iniciar" : "Start"}><Icon name={service.status === "running" ? "stop" : "play"} size={15} /></button><button type="button" onClick={() => openLogs(service)} title={t("logs")}><Icon name="terminal" size={15} /></button><button type="button" onClick={() => setOpenTableMenu(openTableMenu === service.id ? null : service.id)} aria-label={`${language === "es" ? "Más acciones" : "More actions"}: ${service.name}`} aria-expanded={openTableMenu === service.id}><MoreHorizontal size={17} /></button></div></td></tr>{openTableMenu === service.id ? <tr className="container-table-expanded-row"><td colSpan={7}><div className="container-table-expanded-actions"><button type="button" onClick={() => { openEdit(service); setOpenTableMenu(null); }}><Icon name="pencil" size={15} />{t("edit")}</button><button type="button" onClick={() => { requestServiceAction(service, "restart"); setOpenTableMenu(null); }}><Icon name="refresh" size={15} />{t("restart")}</button><button type="button" onClick={() => { requestServiceAction(service, "recreate"); setOpenTableMenu(null); }}><Icon name="box" size={15} />{t("recreate")}</button><button type="button" onClick={() => { openDuplicate(service); setOpenTableMenu(null); }}><Icon name="layers" size={15} />{t("duplicate")}</button><button type="button" onClick={() => { openLabelManager(service); setOpenTableMenu(null); }}><Icon name="tag" size={15} />{t("labels")}</button><button type="button" className="table-delete" onClick={() => { setDeleteService(service); setOpenTableMenu(null); }}><Icon name="alert" size={15} />{t("delete")}</button></div></td></tr> : null}</Fragment>)}</tbody></table>{!filtered.length ? <div className="container-table-empty">{language === "es" ? "No hay contenedores para este filtro." : "No containers match this filter."}</div> : null}</div> : <section className="grid" aria-label="Contenedores">
        {filtered.map((service) => <article className="service-card" key={service.id}>
          <div className="service-card-head"><div className="service-title"><span className="service-icon"><Icon name={categoryIcon[service.category]} size={18} /></span><div><h3>{service.name}</h3><span className="muted" title={service.image ?? undefined}>{({ application: t("applications"), database: t("databases"), external: t("external_tools") } as Record<ServiceCategory, string>)[service.category]} · {environmentLabel(service.environment)}{service.composeProject ? <span className="compose-badge">▣ Compose · {service.composeProject}</span> : null}</span></div></div><div className="service-head-actions"><div className="status-block"><span className={`status status-${service.status}`}><span className="status-dot" />{statusLabel(service.status, t)}</span><span className="status-since">{service.status === "unhealthy" ? t("unhealthy") : localizedStatusSince(service.statusSince, language)}</span></div><button className="edit-button" type="button" onClick={() => openEdit(service)} disabled={isServicePending(service.id)} title={t("edit")} aria-label={`${t("edit")} ${service.name}`}><Icon name="pencil" size={15} /></button></div></div>
          <div className="image-line"><span className="image-label"><Icon name="image" size={14} />{t("image")}</span><span className="image-name" title={service.image ?? undefined}>{service.image ?? "—"}</span><button className="copy-button" type="button" onClick={() => copyImage(service.image)} disabled={!service.image} title="Copiar imagen" aria-label="Copiar imagen"><Icon name="copy" size={15} /></button></div>
          {(labelsByContainer[service.id] ?? []).length ? <div className="service-tags"><Icon name="tag" size={13} />{(labelsByContainer[service.id] ?? []).map((label) => <span className="service-tag" key={label}>{label}</span>)}</div> : null}
          <dl><div><dt><span className="field-label"><Icon name="port" size={13} />{t("port")}</span></dt><dd>{service.port || "—"}</dd></div><div><dt><span className="field-label"><Icon name="tag" size={13} />{t("version")}</span></dt><dd title={service.imageVersion ?? undefined}>{service.imageVersion ?? "Sin tag"}</dd></div><div className="database-field"><dt><span className="field-label"><Icon name="database" size={13} />{t("database")}</span></dt><dd title={service.databaseTarget ?? undefined}>{service.databaseTarget ?? "No configurada"}</dd></div><div className="network-field"><dt><span className="field-label"><Icon name="layers" size={13} />{t("networks")}</span></dt><dd title={service.networks.join(", ")}>{service.networks.length ? service.networks.join(", ") : "Sin red"}</dd></div></dl>
          <div className="card-actions">{service.status === "stopped" ? <button className="primary-button service-off" type="button" disabled><Icon name="stop" size={15} />{t("service_off")}</button> : service.ready && service.url ? <a className="primary-button" href={service.url} target="_blank" rel="noreferrer"><Icon name="external" size={15} />{t("open_service")}</a> : <button className="primary-button service-off" type="button" disabled><Icon name={service.status === "starting" ? "loader" : "box"} size={15} />{service.status === "starting" ? "Verificando…" : "No disponible"}</button>}<button type="button" onClick={() => requestServiceAction(service, "start")} disabled={service.status === "running" || service.status === "starting" || isServicePending(service.id)}><Icon name={service.status === "starting" ? "loader" : "play"} size={14} />{pendingAction === `${service.id}:start` || service.status === "starting" ? "Iniciando…" : "Iniciar"}</button><button type="button" onClick={() => requestServiceAction(service, "stop")} disabled={service.status !== "running" || isServicePending(service.id)}><Icon name="stop" size={14} />{pendingAction === `${service.id}:stop` ? "Deteniendo…" : "Detener"}</button><button type="button" onClick={() => requestServiceAction(service, "restart")} disabled={isServicePending(service.id)}><Icon name="refresh" size={14} />{pendingAction === `${service.id}:restart` ? "Reiniciando…" : "Reiniciar"}</button><button type="button" onClick={() => requestServiceAction(service, "recreate")} disabled={isServicePending(service.id)}><Icon name="box" size={14} />{pendingAction === `${service.id}:recreate` ? "Recreando…" : "Recrear"}</button><button type="button" onClick={() => openLabelManager(service)} disabled={isServicePending(service.id)}><Icon name="tag" size={14} />{t("labels")}</button><button type="button" onClick={() => openDuplicate(service)} disabled={isServicePending(service.id)}><Icon name="layers" size={14} />{t("duplicate")}</button><button type="button" onClick={() => setDeleteService(service)} disabled={isServicePending(service.id)} className="delete-resource-button"><Icon name="alert" size={14} />{t("delete")}</button><button type="button" onClick={() => openLogs(service)} disabled={logsLoading !== null}><Icon name="terminal" size={14} />{logsLoading === service.id ? "Logs…" : "Logs"}</button></div>
        </article>)}
      </section>}</> : <section key={view} className="resource-panel" aria-live="polite">{resourceLoading ? <div className="empty-state"><Icon name="loader" size={22} />{t("loading_resources")}</div> : view === "images" ? <><div className="resource-toolbar"><label className="resource-search"><span>{t("search")}</span><input value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} placeholder="registry, tag o digest…" /></label><CustomSelect label="Filtro" value={imageFilter} onChange={setImageFilter} options={[{ value: "all", label: "Todas" }, { value: "untagged", label: "Sin tag" }, { value: "unused", label: "Sin uso" }]} /><div className="image-total"><span>{t("total_images")}</span><strong>{images.length}</strong><small>{formatBytes(totalImageBytes)}</small></div></div><div className="resource-actions"><button type="button" onClick={() => setSelectedImages(allFilteredImagesSelected ? new Set() : new Set(filteredImages.map((image) => image.Id)))} disabled={!filteredImages.length}><span className="fake-checkbox" aria-hidden="true">{allFilteredImagesSelected ? "✓" : ""}</span>{allFilteredImagesSelected ? "Quitar selección" : `Seleccionar ${filteredImages.length} resultado(s)`}</button><span>{selectedImages.size} seleccionada(s)</span><button className="delete-resource-button" type="button" onClick={() => setImageDeleteConfirm(true)} disabled={!selectedImages.size || imageDeleting}><Icon name="alert" size={14} />{t("delete_selected")}</button></div><div className="resource-list">{filteredImages.length ? filteredImages.map((image) => <article className={`resource-row${selectedImages.has(image.Id) ? " selected" : ""}`} key={image.Id}><label className="image-checkbox"><input type="checkbox" checked={selectedImages.has(image.Id)} onChange={() => toggleImage(image.Id)} aria-label={`Seleccionar ${image.RepoTags?.[0] ?? image.Id}`} /><span className="fake-checkbox">{selectedImages.has(image.Id) ? "✓" : ""}</span></label><span className="resource-row-icon"><Icon name="image" size={18} /></span><div><strong title={image.RepoTags?.join(", ") ?? undefined}>{image.RepoTags?.join(", ") ?? "Imagen sin tag"}</strong><span title={image.RepoDigests?.join(", ") ?? image.Id}>{image.RepoDigests?.[0] ?? image.Id.slice(0, 19)}</span></div><span className="resource-size">{formatBytes(image.Size)}</span><button className="copy-button" type="button" disabled={!image.RepoTags?.[0]} onClick={() => copyImage(image.RepoTags?.[0] ?? null)} title="Copiar imagen"><Icon name="copy" size={15} /></button></article>) : <div className="empty-state">{t("no_images")}</div>}</div></> : view === "networks" ? <><div className="resource-toolbar network-toolbar"><CustomSelect label="Red" value={selectedNetworkId} onChange={setSelectedNetworkId} options={networks.map((network) => ({ value: network.Id, label: network.Name }))} /><CustomSelect label="Contenedor" value={selectedNetworkContainerId} onChange={setSelectedNetworkContainerId} options={networkContainers.map((container) => ({ value: container.id, label: container.name }))} /><button className="primary-button network-connect-button" type="button" onClick={() => changeNetworkConnection(selectedNetworkId, selectedNetworkContainerId, "connect")} disabled={!selectedNetworkId || !selectedNetworkContainerId || networkAction !== null}>{networkAction?.startsWith("connect:") ? <><Icon name="loader" size={15} />{t("connected")}</> : <><Icon name="plus" size={15} />{t("connect_container")}</>}</button></div><div className="resource-list">{networks.length ? networks.map((network) => <article className="resource-row network-row" key={network.Id}><span className="resource-row-icon"><Icon name="layers" size={18} /></span><div><strong>{network.Name}</strong><span>{network.Driver ?? "bridge"} · {network.Scope ?? "local"} · {Object.keys(network.Containers ?? {}).length} contenedor(es)</span><div className="network-members">{Object.entries(network.Containers ?? {}).map(([containerId, container]) => <span className="network-member" key={containerId}><span>{container.Name ?? containerId.slice(0, 12)}</span><button type="button" onClick={() => changeNetworkConnection(network.Id, containerId, "disconnect")} disabled={networkAction !== null} title="Desconectar contenedor">×</button></span>)}</div></div></article>) : <div className="empty-state">{t("no_networks")}</div>}</div></> : <div className="resource-list volume-list">{volumes.length ? volumes.map((volume) => <article className="resource-row volume-row" key={volume.Name}><span className="resource-row-icon"><Icon name="database" size={18} /></span><div className="volume-row-copy"><strong title={volume.Name}>{volume.Name}</strong><span title={volume.Mountpoint ?? undefined}>{volume.Driver ?? "local"} · {volume.Mountpoint ?? (language === "es" ? "Sin punto de montaje" : "No mountpoint")}</span><small className={volume.usedBy?.length ? "volume-used" : "volume-unused"}>{volume.usedBy?.length ? (language === "es" ? `En uso por ${volume.usedBy.join(", ")}` : `Used by ${volume.usedBy.join(", ")}`) : (language === "es" ? "Sin contenedores asociados" : "Not attached to a container")}</small></div><div className="volume-row-actions"><button type="button" onClick={() => setVolumeDetails(volume)}><Icon name="layers" size={14} />{language === "es" ? "Detalles" : "Details"}</button><button type="button" className="volume-remove" onClick={() => { setDeleteVolume(volume); setVolumeConfirmName(""); }} disabled={Boolean(volume.usedBy?.length)} title={volume.usedBy?.length ? (language === "es" ? "Desconecta o elimina los contenedores asociados primero" : "Disconnect or remove attached containers first") : undefined}><Icon name="alert" size={14} />{t("delete")}</button></div></article>) : <div className="empty-state">{language === "es" ? "No hay volúmenes disponibles." : "No volumes available."}</div>}</div>}</section>}

      {confirmation ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><span className="modal-kicker"><Icon name="alert" size={13} />Acción de Vessel</span><h2 id="confirm-title"><Icon name={confirmation.action === "recreate" ? "refresh" : confirmation.action === "stop" ? "stop" : "play"} size={19} />Confirmar acción</h2><p>¿Confirmas {confirmation.action === "start" ? "iniciar" : confirmation.action === "stop" ? "detener" : confirmation.action === "restart" ? "reiniciar" : "recrear"} el contenedor <strong>{confirmation.service.name}</strong>?</p><div className="modal-actions"><button type="button" onClick={() => setConfirmation(null)}><Icon name="x" size={14} />{t("cancel")}</button><button className="danger-button" type="button" onClick={() => executeServiceAction(confirmation.service, confirmation.action)}><Icon name="check" size={15} />{t("confirm")}</button></div></section></div> : null}
      {deleteService ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-service-title"><span className="modal-kicker">Acción de Vessel</span><h2 id="delete-service-title">Borrar contenedor</h2><p>¿Confirmas borrar <strong>{deleteService.name}</strong>? Se eliminará el contenedor de Docker, pero no sus volúmenes ni la imagen.</p><div className="modal-actions"><button type="button" onClick={() => setDeleteService(null)} disabled={pendingAction !== null}>{t("cancel")}</button><button className="danger-button" type="button" onClick={executeDeleteService} disabled={pendingAction !== null}>{pendingAction?.endsWith(":delete") ? <><Icon name="loader" size={15} />Borrando…</> : <><Icon name="alert" size={15} />Confirmar borrado</>}</button></div></section></div> : null}
      {editService ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal edit-modal service-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title"><span className="modal-kicker"><Icon name="pencil" size={13} />Editar contenedor</span><h2 id="edit-title"><Icon name="pencil" size={19} />Nombre, puerto e imagen</h2><p>Se detendrá y recreará <strong>{editService.name}</strong> conservando su configuración y volúmenes. Si estaba activo, se iniciará nuevamente.</p><div className="modal-tabs" role="tablist"><button type="button" className={editTab === "container" ? "active" : ""} onClick={() => setEditTab("container")}><Icon name="box" size={14} />Contenedor</button><button type="button" className={editTab === "variables" ? "active" : ""} onClick={() => setEditTab("variables")}><Icon name="terminal" size={14} />{t("variables")}</button></div>{editTab === "container" ? <div className="modal-tab-content"><CustomSelect icon="layers" label="Red Docker" value={editNetworkId} onChange={setEditNetworkId} options={[{ value: "preserve", label: editService.networks.length ? `Conservar: ${editService.networks.join(", ")}` : "Conservar configuración actual" }, ...networks.map((network) => ({ value: network.Id, label: network.Name }))]} /><p className="modal-note network-summary"><Icon name="layers" size={14} />Al elegir otra red, se conectará la nueva y se retirarán las anteriores después de recrear el contenedor.</p><CustomSelect icon="refresh" label="Política de reinicio" value={editRestartPolicy} onChange={setEditRestartPolicy} options={[{ value: "preserve", label: "Conservar política actual" }, ...restartPolicyOptions]} />{editRestartPolicy === "on-failure" ? <label className="modal-field retry-field"><span>{t("max_retries")}</span><input value={editMaxRetries} onChange={(event) => setEditMaxRetries(event.target.value)} type="number" min="0" max="1000000" /></label> : null}<label className="modal-field"><span><Icon name="box" size={14} />{t("container_name")}</span><input value={editName} onChange={(event) => setEditName(event.target.value)} autoFocus maxLength={128} /></label><label className="modal-field"><span><Icon name="port" size={14} />{t("public_port")}</span><input value={editPort} onChange={(event) => setEditPort(event.target.value)} type="number" min="1" max="65535" /></label><div className="image-edit-grid"><label className="modal-field"><span><Icon name="image" size={14} />{t("registry")}</span><input value={editRegistry} readOnly title="El registry se conserva del contenedor actual" /></label><label className="modal-field"><span><Icon name="tag" size={14} />{t("image_tag")}</span><input value={editImage} onChange={(event) => setEditImage(event.target.value)} maxLength={512} placeholder="erpya/adempiere-zk:ERP-394.001-3.8.0" /></label></div></div> : <EnvironmentVariablesEditor value={editVariables} onChange={setEditVariables} />}<div className="modal-actions"><button type="button" onClick={() => setEditService(null)} disabled={pendingAction !== null}><Icon name="x" size={14} />{t("cancel")}</button><button className="danger-button" type="button" onClick={saveEdit} disabled={pendingAction !== null || !editName.trim() || !editPort || !editImage.trim()}>{pendingAction?.endsWith(":edit") ? <><Icon name="loader" size={15} />{t("recreating_action")}</> : <><Icon name="pencil" size={15} />{t("applying_changes")}</>}</button></div></section></div> : null}
      {duplicateService ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-title"><span className="modal-kicker"><Icon name="layers" size={13} />Clonar ambiente</span><h2 id="duplicate-title"><Icon name="layers" size={19} />Duplicar aplicación</h2><p>Elige qué quieres crear a partir de <strong>{duplicateService.name}</strong>.</p>{duplicateService.databaseTarget ? <div className="duplicate-modes" role="radiogroup" aria-label="Modo de duplicación"><button type="button" className={duplicateMode === "database" ? "selected" : ""} onClick={() => { setDuplicateMode("database"); setDuplicateDatabase(`${duplicateService.databaseTarget || duplicateService.name}_2`); setDuplicateAcknowledged(false); }}><strong><Icon name="database" size={15} />Aplicación + BD</strong><span>Copia la base de datos en PostgreSQL y crea un ambiente independiente.</span></button><button type="button" className={duplicateMode === "application" ? "selected" : ""} onClick={() => { setDuplicateMode("application"); setDuplicateDatabase(duplicateService.databaseTarget || duplicateService.name); setDuplicateAcknowledged(false); }}><strong><Icon name="box" size={15} />Solo aplicación</strong><span>Usa la misma BD del origen; solo crea otro contenedor.</span></button></div> : null}{duplicateMode === "application" && duplicateService.databaseTarget ? <div className="duplicate-warning" role="alert"><strong>⚠ Misma base de datos</strong><span>El nuevo contenedor usará la configuración de conexión que definas en la pestaña <b>{t("variables")}</b>. Los cambios realizados desde cualquiera de las aplicaciones afectarán los mismos datos.</span><label><input type="checkbox" checked={duplicateAcknowledged} onChange={(event) => setDuplicateAcknowledged(event.target.checked)} />Entiendo y deseo continuar compartiendo esta BD.</label></div> : duplicateUsesSameDatabase ? <div className="duplicate-warning" role="alert"><strong>⚠ Operación bloqueada</strong><span>La BD destino coincide con la BD original <b>{duplicateService.databaseTarget}</b>. Debes indicar una BD nueva; no se permite sobrescribir ni clonar sobre la misma.</span></div> : null}<div className="modal-tabs" role="tablist"><button type="button" className={duplicateTab === "container" ? "active" : ""} onClick={() => setDuplicateTab("container")}><Icon name="box" size={14} />Contenedor</button><button type="button" className={duplicateTab === "variables" ? "active" : ""} onClick={() => setDuplicateTab("variables")}><Icon name="terminal" size={14} />{t("variables")}</button></div>{duplicateTab === "container" ? <div className="modal-tab-content"><label className="modal-field"><span><Icon name="box" size={14} />{t("new_container_name")}</span><input value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} autoFocus maxLength={128} /></label>{duplicateMode === "database" ? <label className="modal-field"><span><Icon name="database" size={14} />{duplicateMode === "database" ? "Base de datos destino" : "Base de datos reutilizada"}</span><input value={duplicateDatabase} onChange={(event) => setDuplicateDatabase(event.target.value)} maxLength={63} /></label> : null}<label className="modal-field"><span><Icon name="image" size={14} />{t("docker_image")}</span><input value={duplicateImage} onChange={(event) => setDuplicateImage(event.target.value)} maxLength={512} placeholder="registry/organizacion/imagen:tag" /></label>{duplicateService.port ? <label className="modal-field"><span><Icon name="port" size={14} />{t("public_port")}</span><input value={duplicatePort} onChange={(event) => setDuplicatePort(event.target.value)} type="number" min="1" max="65535" /></label> : <p className="modal-note">{language === "es" ? "El origen no publica puertos; el duplicado tampoco publicará uno." : "The source publishes no port, so the duplicate will not publish one."}</p>}<CustomSelect icon="layers" label="Red Docker" value={duplicateNetworkId} onChange={setDuplicateNetworkId} options={[{ value: "preserve", label: duplicateService.networks.length ? `Conservar: ${duplicateService.networks.join(", ")}` : "Conservar configuración actual" }, ...networks.map((network) => ({ value: network.Id, label: network.Name }))]} /><CustomSelect icon="refresh" label="Política de reinicio" value={duplicateRestartPolicy} onChange={setDuplicateRestartPolicy} options={[{ value: "preserve", label: "Conservar política del origen" }, ...restartPolicyOptions]} />{duplicateRestartPolicy === "on-failure" ? <label className="modal-field retry-field"><span>{t("max_retries")}</span><input value={duplicateMaxRetries} onChange={(event) => setDuplicateMaxRetries(event.target.value)} type="number" min="0" max="1000000" /></label> : null}</div> : <EnvironmentVariablesEditor value={duplicateVariables} onChange={setDuplicateVariables} />}<p className="modal-note">{duplicateMode === "database" ? "La BD destino no puede existir previamente." : duplicateService.databaseTarget ? "Sin confirmación explícita no se podrá crear el duplicado." : "Se conservarán las variables, imagen y configuración del contenedor original."}</p><div className="modal-actions"><button type="button" onClick={() => setDuplicateService(null)} disabled={pendingAction !== null}><Icon name="x" size={14} />{t("cancel")}</button><button className="primary-button" type="button" onClick={saveDuplicate} disabled={pendingAction !== null || !duplicateName.trim() || (duplicateMode === "database" && !duplicateDatabase.trim()) || !duplicateImage.trim() || (Boolean(duplicateService.port) && !duplicatePort) || duplicateBlocked}>{pendingAction?.endsWith(":duplicate") ? <><Icon name="loader" size={15} />{t("creating")}</> : <><Icon name="layers" size={15} />Crear duplicado</>}</button></div></section></div> : null}
      {logService ? <div className="modal-backdrop" role="presentation"><section style={{ transform: `translate(${logsPosition.x}px, ${logsPosition.y}px)` }} className={`logs-modal${logsExpanded ? " logs-expanded" : ""}${draggingLogs ? " logs-dragging" : ""}`} role="dialog" aria-modal="true" aria-labelledby="logs-title"><div className="logs-head" onPointerDown={startDraggingLogs}><div><span className="modal-kicker">Vessel · Logs</span><h2 id="logs-title">{logService.name}</h2></div><div className="logs-actions"><button type="button" className="logs-expand" onClick={() => setLogsExpanded((value) => !value)}>{logsExpanded ? "Reducir" : "Expandir"}</button><button type="button" className="logs-close" onClick={() => setLogService(null)} aria-label="Cerrar logs">×</button></div></div><pre>{logService.logs || "Sin logs disponibles"}</pre></section></div> : null}

      <footer><span>{syncState === "ok" ? `Sincronización activa${discoveredCount === null ? "" : ` · ${discoveredCount} contenedores detectados.`}` : "Backend Docker no disponible."}</span></footer>
    </main>
  );
}
