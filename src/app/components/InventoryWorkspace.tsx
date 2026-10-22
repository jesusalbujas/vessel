"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, LayoutGrid, List, MoreHorizontal, SlidersHorizontal } from "lucide-react";
import type { ContainerRuntimeSettings, RestartPolicy, Service, ServiceCategory, ServiceStatus } from "@/lib/services";
import { useI18n, type TranslationKey } from "@/lib/i18n";
import RuntimeSettingsEditor from "./RuntimeSettingsEditor";

const initialCatalog: Service[] = [];
const emptyRuntimeSettings = (): ContainerRuntimeSettings => ({ command: [], entrypoint: [], workingDir: "", user: "", tty: false, openStdin: false, logDriver: "", logOptions: {}, memoryLimitMiB: null, cpuLimit: null });
const copyRuntimeSettings = (value?: ContainerRuntimeSettings): ContainerRuntimeSettings | undefined => value ? { ...value, command: [...value.command], entrypoint: [...value.entrypoint], logOptions: { ...value.logOptions } } : undefined;

function nextAvailablePort(ports: number[]): number {
  const used = new Set(ports.filter((port) => port > 0));
  return Math.max(50000, ...used) + 1;
}

function statusLabel(status: ServiceStatus, t: (key: TranslationKey) => string): string {
  return { unknown: t("unknown"), starting: t("checking"), running: t("running"), stopped: t("stopped"), unhealthy: t("unhealthy"), paused: t("paused") }[status];
}

function localizedStatusSince(value: string | null, language: "es" | "en"): string {
  if (!value || language === "es") return value ?? "";
  return value.replace(/^Activo desde hace /, "Running for ").replace(/^Detenido desde hace /, "Stopped for ").replace(/^Activo$/, "Running").replace(/^Detenido$/, "Stopped").replace(/^Creado, aún no iniciado$/, "Created, not started yet").replace(/^aproximadamente /, "about ").replace(/^menos de /, "less than ").replace(/un segundo$/, "one second").replace(/un minuto$/, "one minute").replace(/una hora$/, "one hour").replace(/un día$/, "one day").replace(/segundos?$/, "seconds").replace(/minutos?$/, "minutes").replace(/horas?$/, "hours").replace(/días?$/, "days");
}

type ImageResource = { Id: string; RepoTags?: string[] | null; RepoDigests?: string[] | null; Created?: number; Size?: number; used?: boolean };
type VolumeResource = { Name: string; Driver?: string; Mountpoint?: string; CreatedAt?: string; Labels?: Record<string, string>; usedBy?: string[] };
type NetworkResource = { Id: string; Name: string; Driver?: string; Scope?: string; Attachable?: boolean; Created?: string; Labels?: Record<string, string>; EnableIPv6?: boolean; IPAM?: { Driver?: string; Config?: Array<{ Subnet?: string; Gateway?: string; IPRange?: string }> }; Containers?: Record<string, { Name?: string; IPv4Address?: string; IPv6Address?: string; MacAddress?: string }> };
type ContainerOption = { id: string; name: string };
type RegistryOption = { id: string; name: string; url: string; username?: string };
type EngineInfo = { Name?: string; ServerVersion?: string; OperatingSystem?: string; OSType?: string; Architecture?: string; NCPU?: number; MemTotal?: number; DockerRootDir?: string; Driver?: string; Containers?: number; ContainersRunning?: number; ContainersPaused?: number; ContainersStopped?: number; Images?: number; Swarm?: { LocalNodeState?: string; ControlAvailable?: boolean; Nodes?: number } };
type ContainerColumn = "compose" | "image" | "created" | "ip" | "ports" | "database" | "managedBy";
type CloneJob = { id: string; kind: "duplicate" | "image"; status: "running" | "completed" | "failed"; step: string; message: string; percent: number; currentItem: string | null; errors: number; startedAt: string; finishedAt: string | null; sharedDataSource?: boolean; result?: { name: string; port: number; dataResource: string; dataCopied: boolean } };

function Icon({ name, size = 17 }: { name: "box" | "docker" | "vessel" | "sun" | "moon" | "plus" | "play" | "stop" | "pause" | "kill" | "refresh" | "external" | "loader" | "check" | "alert" | "copy" | "image" | "database" | "layers" | "port" | "tag" | "terminal" | "pencil" | "chevron" | "x"; size?: number }) {
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
    pause: <><path d="M8 5h3v14H8zM15 5h3v14h-3z" /></>,
    kill: <><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" /></>,
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
type ContainerSortColumn = "name" | "status" | "compose" | "image" | "port" | "database" | "created" | "ip" | "ports" | "managedBy";

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
const formatDateTime = (value: number | string | undefined, language: "es" | "en") => value ? new Intl.DateTimeFormat(language === "es" ? "es-VE" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(typeof value === "number" ? new Date(value * 1000) : new Date(value)) : "—";

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
  const [containerColumnsOpen, setContainerColumnsOpen] = useState(false);
  const [visibleContainerColumns, setVisibleContainerColumns] = useState<Set<ContainerColumn>>(new Set(["compose", "image", "created", "ip", "ports", "database", "managedBy"]));
  const [containerSort, setContainerSort] = useState<{ column: ContainerSortColumn; direction: "asc" | "desc" } | null>(null);
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [bulkPendingIds, setBulkPendingIds] = useState<Set<string>>(new Set());
  const [bulkConfirmation, setBulkConfirmation] = useState<"start" | "stop" | null>(null);
  const [bulkAction, setBulkAction] = useState<"start" | "stop" | null>(null);
  const [openTableMenu, setOpenTableMenu] = useState<string | null>(null);
  const [images, setImages] = useState<ImageResource[]>([]);
  const [imageQuery, setImageQuery] = useState("");
  const [imageFilter, setImageFilter] = useState("all");
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set());
  const [imageDeleteConfirm, setImageDeleteConfirm] = useState(false);
  const [imageDeleting, setImageDeleting] = useState(false);
  const [imagePullName, setImagePullName] = useState("");
  const [imagePullRegistry, setImagePullRegistry] = useState("docker-hub");
  const [registries, setRegistries] = useState<RegistryOption[]>([]);
  const [volumes, setVolumes] = useState<VolumeResource[]>([]);
  const [volumeQuery, setVolumeQuery] = useState("");
  const [volumeUsageFilter, setVolumeUsageFilter] = useState("all");
  const [createVolumeOpen, setCreateVolumeOpen] = useState(false);
  const [createVolumeName, setCreateVolumeName] = useState("");
  const [volumeCreating, setVolumeCreating] = useState(false);
  const [volumeDetails, setVolumeDetails] = useState<VolumeResource | null>(null);
  const [deleteVolume, setDeleteVolume] = useState<VolumeResource | null>(null);
  const [volumeConfirmName, setVolumeConfirmName] = useState("");
  const [volumeDeleting, setVolumeDeleting] = useState(false);
  const [networks, setNetworks] = useState<NetworkResource[]>([]);
  const [networkQuery, setNetworkQuery] = useState("");
  const [networkContainers, setNetworkContainers] = useState<ContainerOption[]>([]);
  const [selectedNetworkId, setSelectedNetworkId] = useState("");
  const [selectedNetworkContainerId, setSelectedNetworkContainerId] = useState("");
  const [networkAction, setNetworkAction] = useState<string | null>(null);
  const [resourceLoading, setResourceLoading] = useState(false);
  const [resourceRefreshIndex, setResourceRefreshIndex] = useState(0);
  const [logService, setLogService] = useState<{ name: string; logs: string } | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [logsLoading, setLogsLoading] = useState<string | null>(null);
  const [logsPosition, setLogsPosition] = useState({ x: 0, y: 0 });
  const [draggingLogs, setDraggingLogs] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dismissedJobs = useRef<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error" | "info"; message: string } | null>(null);
  const [confirmation, setConfirmation] = useState<{ service: Service; action: "start" | "stop" | "restart" | "kill" | "pause" | "unpause" | "recreate" } | null>(null);
  const [deleteService, setDeleteService] = useState<Service | null>(null);
  const [editService, setEditService] = useState<Service | null>(null);
  const [editName, setEditName] = useState("");
  const [editPort, setEditPort] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editRegistry, setEditRegistry] = useState("");
  const [editVariables, setEditVariables] = useState("");
  const [editRuntimeSettings, setEditRuntimeSettings] = useState<ContainerRuntimeSettings | undefined>();
  const [editTab, setEditTab] = useState<"container" | "variables" | "runtime">("container");
  const [editNetworkId, setEditNetworkId] = useState("preserve");
  const [editRestartPolicy, setEditRestartPolicy] = useState("preserve");
  const [editMaxRetries, setEditMaxRetries] = useState("0");
  const [duplicateService, setDuplicateService] = useState<Service | null>(null);
  const [duplicateName, setDuplicateName] = useState("");
  const [duplicatePort, setDuplicatePort] = useState("");
  const [duplicateDataTarget, setDuplicateDataTarget] = useState("");
  const [duplicateImage, setDuplicateImage] = useState("");
  const [duplicateVariables, setDuplicateVariables] = useState("");
  const [duplicateRuntimeSettings, setDuplicateRuntimeSettings] = useState<ContainerRuntimeSettings | undefined>();
  const [duplicateTab, setDuplicateTab] = useState<"container" | "variables" | "runtime">("container");
  const [duplicateMode, setDuplicateMode] = useState<"data" | "application">("data");
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
  const [newServiceRuntimeSettings, setNewServiceRuntimeSettings] = useState<ContainerRuntimeSettings>(emptyRuntimeSettings());
  const [newServiceTab, setNewServiceTab] = useState<"container" | "variables" | "runtime">("container");
  const [newServiceRestartPolicy, setNewServiceRestartPolicy] = useState<RestartPolicy>("no");
  const [newServiceMaxRetries, setNewServiceMaxRetries] = useState("0");
  const [newServiceNetworkId, setNewServiceNetworkId] = useState("");
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
    try {
      const savedColumns = JSON.parse(window.localStorage.getItem("vessel-container-columns") ?? "null");
      if (Array.isArray(savedColumns)) setVisibleContainerColumns(new Set(savedColumns.filter((column): column is ContainerColumn => ["compose", "image", "created", "ip", "ports", "database", "managedBy"].includes(column))));
    } catch {
      // Invalid local preferences fall back to the complete default column set.
    }
  }, []);

  function changeContainerLayout(layout: "cards" | "table") {
    setContainerLayout(layout);
    window.localStorage.setItem("vessel-container-layout", layout);
  }

  function toggleContainerColumn(column: ContainerColumn) {
    setVisibleContainerColumns((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column); else next.add(column);
      window.localStorage.setItem("vessel-container-columns", JSON.stringify([...next]));
      return next;
    });
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
    const requestedImage = imagePullName.trim();
    if (!requestedImage) return;
    const hasRegistry = /^[^/]+\.[^/]+\//.test(requestedImage) || /^[^/]+:\d+\//.test(requestedImage) || requestedImage.startsWith("localhost/");
    const selectedRegistry = registries.find((registry) => registry.id === imagePullRegistry);
    const image = selectedRegistry && !hasRegistry ? `${new URL(selectedRegistry.url).host}/${requestedImage}` : requestedImage;
    try {
      const response = await fetch("/api/resources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "pull", image }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "No fue posible descargar la imagen");
      setImagePullName("");
      setCloneJobMinimized(false);
      const jobResponse = await fetch(`/api/jobs?id=${encodeURIComponent(payload.jobId)}`, { cache: "no-store" });
      const jobPayload = await jobResponse.json();
      setCloneJob(jobPayload.data ?? null);
      setToast({ kind: "info", message: `${language === "es" ? "Descarga iniciada" : "Download started"}: ${image}` });
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
  }, [view, resourceRefreshIndex]);

  useEffect(() => {
    if (view !== "images") return;
    const token = window.localStorage.getItem("vessel-token") ?? "";
    fetch("/api/registries", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const payload = await response.json() as { data?: RegistryOption[] };
      setRegistries(payload.data ?? []);
    }).catch(() => undefined);
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

  async function executeServiceAction(service: Service, action: "start" | "stop" | "restart" | "kill" | "pause" | "unpause" | "recreate") {
    const labels = { start: "iniciar", stop: "detener", restart: "reiniciar", kill: "terminar", pause: "pausar", unpause: "reanudar", recreate: "recrear" };
    const completedLabels = { start: "iniciado", stop: "detenido", restart: "reiniciado", kill: "terminado", pause: "pausado", unpause: "reanudado", recreate: "recreado" };
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

  function requestServiceAction(service: Service, action: "start" | "stop" | "restart" | "kill" | "pause" | "unpause" | "recreate") {
    setConfirmation({ service, action });
  }

  function toggleServiceSelection(serviceId: string) {
    setSelectedServices((current) => {
      const next = new Set(current);
      if (next.has(serviceId)) next.delete(serviceId); else next.add(serviceId);
      return next;
    });
  }

  function toggleAllFilteredServices() {
    setSelectedServices((current) => {
      const next = new Set(current);
      if (allFilteredServicesSelected) filtered.forEach((service) => next.delete(service.id));
      else filtered.forEach((service) => next.add(service.id));
      return next;
    });
  }

  async function executeBulkServiceAction() {
    if (!bulkConfirmation) return;
    const action = bulkConfirmation;
    const targets = action === "start" ? bulkStartable : bulkStoppable;
    if (!targets.length) {
      setBulkConfirmation(null);
      return;
    }
    setBulkConfirmation(null);
    setBulkAction(action);
    setBulkPendingIds(new Set(targets.map((service) => service.id)));
    const completed: string[] = [];
    const failures: string[] = [];
    for (let index = 0; index < targets.length; index += 1) {
      const service = targets[index];
      setToast({ kind: "info", message: `${action === "start" ? "Iniciando" : "Deteniendo"} ${service.name} (${index + 1}/${targets.length})…` });
      try {
        const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: service.id, action }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "No fue posible ejecutar la acción");
        completed.push(service.id);
      } catch (error) {
        failures.push(`${service.name}: ${error instanceof Error ? error.message : "error desconocido"}`);
      }
    }
    setSelectedServices((current) => new Set([...current].filter((id) => !completed.includes(id))));
    try {
      await refreshWithRetry();
    } catch {
      failures.push("No fue posible actualizar el estado de los contenedores.");
    }
    setBulkPendingIds(new Set());
    setBulkAction(null);
    if (failures.length) {
      setToast({ kind: "error", message: `${action === "start" ? "Inicio" : "Detención"}: ${completed.length}/${targets.length} correctos. ${failures.slice(0, 2).join(" · ")}` });
    } else {
      setToast({ kind: "success", message: `${completed.length} contenedor(es) ${action === "start" ? "iniciado(s)" : "detenido(s)"} correctamente.` });
    }
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
    if (service.composeProject) {
      setToast({ kind: "info", message: language === "es" ? `Este contenedor pertenece al proyecto Compose “${service.composeProject}”. Edita el servicio desde su definición Compose para evitar que los cambios se reviertan.` : `This container belongs to Compose project “${service.composeProject}”. Edit its Compose definition to prevent changes from being reverted.` });
      return;
    }
    setEditService(service);
    setEditName(service.name);
    setEditPort(service.port ? String(service.port) : "");
    const image = service.image ?? "";
    const imageParts = image.split("/");
    const registry = imageParts.length > 1 && (imageParts[0].includes(".") || imageParts[0].includes(":")) ? imageParts.shift() ?? "" : "docker.io";
    setEditRegistry(registry);
    setEditImage(imageParts.join("/") || image);
    setEditVariables((service.environmentVariables ?? []).join("\n"));
    setEditRuntimeSettings(copyRuntimeSettings(service.runtimeSettings));
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
    setDuplicateDataTarget(service.databaseTarget ? `${service.databaseTarget}_2` : "");
    setDuplicateImage(service.image || "");
    setDuplicateVariables((service.environmentVariables ?? []).join("\n"));
    setDuplicateRuntimeSettings(copyRuntimeSettings(service.runtimeSettings));
    setDuplicateTab("container");
    setDuplicateMode(service.dataCloneEngine ? "data" : "application");
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
    setNewServiceRuntimeSettings(emptyRuntimeSettings());
    setNewServiceTab("container");
    setNewServiceRestartPolicy("no");
    setNewServiceMaxRetries("0");
    setNewServiceNetworkId("");
    void loadNetworksForEdit();
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
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "create", newName: name, newImage: image, newPort: publicPort, internalPort, environmentVariables, runtimeSettings: newServiceRuntimeSettings, networkId: newServiceNetworkId || undefined, restartPolicy: { name: newServiceRestartPolicy, maxRetries: Number(newServiceMaxRetries) || 0 } }) });
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
    const copyData = duplicateMode === "data";
    const dataTarget = duplicateDataTarget.trim();
    const port = Number(duplicatePort);
    setPendingAction(`${duplicateService.id}:duplicate`);
    setToast({ kind: "info", message: copyData ? `Copiando datos y preparando ${name}…` : `Duplicando ${name}…` });
    try {
      const environmentVariables = duplicateVariables.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && line.includes("=") && !line.startsWith("#"));
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: duplicateService.id, action: "duplicate", newName: name, newPort: port, targetDataName: dataTarget, copyData, newImage: duplicateImage.trim(), environmentVariables, ...(duplicateRuntimeSettings ? { runtimeSettings: duplicateRuntimeSettings } : {}), networkId: duplicateNetworkId === "preserve" ? undefined : duplicateNetworkId, restartPolicy: duplicateRestartPolicy === "preserve" ? undefined : { name: duplicateRestartPolicy, maxRetries: Number(duplicateMaxRetries) || 0 } }) });
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
      const response = await fetch("/api/services", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: editService.id, action: "edit", newName: name, newPort: port, newImage: image, environmentVariables, ...(editRuntimeSettings ? { runtimeSettings: editRuntimeSettings } : {}), networkId: editNetworkId === "preserve" ? undefined : editNetworkId, restartPolicy: { name: editRestartPolicy, maxRetries: Number(editMaxRetries) || 0 } }) });
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
    let timer: number | undefined;
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        if (cancelled) return;
        const seconds = [5, 10, 15, 30, 60].includes(payload?.data?.refreshIntervalSeconds) ? payload.data.refreshIntervalSeconds : 15;
        timer = window.setInterval(() => { if (document.visibilityState === "visible") refreshServices().catch(() => undefined); }, seconds * 1000);
      })
      .catch(() => {
        if (!cancelled) timer = window.setInterval(() => { if (document.visibilityState === "visible") refreshServices().catch(() => undefined); }, 15000);
      });
    return () => { cancelled = true; if (timer !== undefined) window.clearInterval(timer); };
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
  const tableRows = useMemo(() => {
    if (!containerSort) return filtered;
    const { column, direction } = containerSort;
    const sign = direction === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      if (column === "port") {
        if (!left.port && right.port) return 1;
        if (left.port && !right.port) return -1;
        return ((left.port || 0) - (right.port || 0)) * sign;
      }
      if (column === "created") {
        if (!left.createdAt && right.createdAt) return 1;
        if (left.createdAt && !right.createdAt) return -1;
        return ((left.createdAt ?? 0) - (right.createdAt ?? 0)) * sign;
      }
      const values: Record<Exclude<ContainerSortColumn, "port" | "created">, [string, string]> = {
        name: [left.name, right.name],
        status: [left.status, right.status],
        compose: [left.composeProject ?? "", right.composeProject ?? ""],
        image: [left.image ?? "", right.image ?? ""],
        database: [left.databaseTarget ?? "", right.databaseTarget ?? ""],
        ip: [(left.ipAddresses ?? []).join(" "), (right.ipAddresses ?? []).join(" ")],
        ports: [(left.publishedPorts ?? []).join(" "), (right.publishedPorts ?? []).join(" ")],
        managedBy: [left.managedBy ?? "", right.managedBy ?? ""],
      };
      const [leftValue, rightValue] = values[column];
      if (!leftValue && rightValue) return 1;
      if (leftValue && !rightValue) return -1;
      return leftValue.localeCompare(rightValue, language, { numeric: true, sensitivity: "base" }) * sign;
    });
  }, [filtered, containerSort, language]);
  const selectedServiceItems = catalog.filter((service) => selectedServices.has(service.id));
  const bulkStartable = selectedServiceItems.filter((service) => service.status === "stopped" || service.status === "unknown");
  const bulkStoppable = selectedServiceItems.filter((service) => service.status === "running" || service.status === "unhealthy");
  const allFilteredServicesSelected = filtered.length > 0 && filtered.every((service) => selectedServices.has(service.id));
  const someFilteredServicesSelected = filtered.some((service) => selectedServices.has(service.id));
  const filteredImages = useMemo(() => {
    const normalized = imageQuery.trim().toLowerCase();
    return images.filter((image) => {
      const untagged = !image.RepoTags?.length;
      const unused = image.used === false;
      const searchable = `${image.RepoTags?.join(" ") ?? ""} ${image.RepoDigests?.join(" ") ?? ""} ${image.Id}`.toLowerCase();
      return (!normalized || searchable.includes(normalized)) && (imageFilter !== "untagged" || untagged) && (imageFilter !== "unused" || unused);
    });
  }, [images, imageQuery, imageFilter]);
  const filteredVolumes = useMemo(() => {
    const normalized = volumeQuery.trim().toLowerCase();
    return volumes.filter((volume) => {
      const project = volume.Labels?.["com.docker.compose.project"] ?? "";
      const searchable = `${volume.Name} ${volume.Driver ?? ""} ${volume.Mountpoint ?? ""} ${project} ${(volume.usedBy ?? []).join(" ")}`.toLowerCase();
      const usageMatches = volumeUsageFilter === "all" || (volumeUsageFilter === "used" ? Boolean(volume.usedBy?.length) : !volume.usedBy?.length);
      return (!normalized || searchable.includes(normalized)) && usageMatches;
    }).sort((left, right) => left.Name.localeCompare(right.Name, language, { numeric: true, sensitivity: "base" }));
  }, [volumes, volumeQuery, volumeUsageFilter, language]);
  const filteredNetworks = useMemo(() => {
    const normalized = networkQuery.trim().toLowerCase();
    return networks.filter((network) => `${network.Name} ${network.Driver ?? ""} ${network.Scope ?? ""} ${network.Labels?.["com.docker.compose.project"] ?? ""} ${(network.Containers ? Object.values(network.Containers).map((container) => container.Name ?? "").join(" ") : "")}`.toLowerCase().includes(normalized)).sort((left, right) => left.Name.localeCompare(right.Name, language, { numeric: true, sensitivity: "base" }));
  }, [networks, networkQuery, language]);
  const totalImageBytes = images.reduce((total, image) => total + (image.Size ?? 0), 0);
  const allFilteredImagesSelected = filteredImages.length > 0 && filteredImages.every((image) => selectedImages.has(image.Id));

  const duplicateSourceData = duplicateService?.databaseTarget?.trim().toLowerCase() ?? "";
  const duplicateTargetData = duplicateDataTarget.trim().toLowerCase();
  const duplicateUsesSameData = Boolean(duplicateService && duplicateSourceData && duplicateTargetData === duplicateSourceData);
  const duplicateBlocked = duplicateMode === "application" ? Boolean(duplicateService?.databaseTarget) && !duplicateAcknowledged : duplicateUsesSameData;
  const isServicePending = (serviceId: string) => Boolean(pendingAction?.startsWith(`${serviceId}:`) || bulkPendingIds.has(serviceId));

  function sortTableBy(column: ContainerSortColumn) {
    setContainerSort((current) => current?.column === column ? { column, direction: current.direction === "asc" ? "desc" : "asc" } : { column, direction: "asc" });
  }

  function tableSortHeader(column: ContainerSortColumn, label: string) {
    const active = containerSort?.column === column;
    const direction = active ? containerSort.direction : null;
    return <th key={column} aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}><button type="button" className={`container-table-sort${active ? " active" : ""}`} onClick={() => sortTableBy(column)}>{label}{direction === "asc" ? <ArrowUp size={13} /> : direction === "desc" ? <ArrowDown size={13} /> : <ArrowUpDown size={13} />}</button></th>;
  }

  if (!authReady) return <main className="app-content inventory-workspace"><div className="inventory-loading">{language === "es" ? "Cargando recursos…" : "Loading resources…"}</div></main>;

  return (
    <main className="app-content inventory-workspace">
      <header className="topbar">
        <div className="inventory-title"><span className="overview-eyebrow">DOCKER / {t(view)}</span><h1>{t(view)}</h1></div>
        <div className="topbar-badges">{view === "containers" ? <button className="new-service-button" type="button" onClick={openCreateService} disabled={pendingAction !== null}><Icon name="plus" size={16} />{t("new_service")}</button> : null}{view === "volumes" ? <button className="new-service-button" type="button" onClick={() => setCreateVolumeOpen(true)}><Icon name="plus" size={16} />{language === "es" ? "Nuevo volumen" : "New volume"}</button> : null}{view !== "containers" ? <button className="overview-refresh resource-refresh" type="button" onClick={() => setResourceRefreshIndex((value) => value + 1)} disabled={resourceLoading}><Icon name="refresh" size={15} />{t("refresh")}</button> : null}{serviceHost ? <span className="host-badge">Host · {serviceHost}</span> : null}</div>
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
      {cloneJob ? <aside className={`job-panel${cloneJobMinimized ? " job-panel-minimized" : ""}`} aria-live="polite"><div className="job-panel-head"><div><span className="modal-kicker">{cloneJob.kind === "image" ? "Cambio de imagen" : "Duplicación"} · {cloneJob.status === "running" ? "En curso" : cloneJob.status === "completed" ? "Completada" : "Revisar"}</span>{!cloneJobMinimized ? <strong>{cloneJob.result?.name ?? (cloneJob.kind === "image" ? "Cambio de imagen" : "Nuevo ambiente")}</strong> : null}</div><div className="job-panel-buttons">{cloneJob.status === "failed" && cloneJob.kind === "image" ? <button type="button" onClick={retryCloneJob} aria-label="Reintentar descarga">↻</button> : null}<button type="button" onClick={() => setCloneJobMinimized((value) => !value)} aria-label={cloneJobMinimized ? "Maximizar progreso" : "Minimizar progreso"}>{cloneJobMinimized ? "□" : "—"}</button><button type="button" onClick={dismissCloneJob} aria-label="Cerrar resumen">×</button></div></div>{!cloneJobMinimized ? <><div className="job-progress-track"><span style={{ width: `${Math.max(0, Math.min(100, cloneJob.percent))}%` }} /></div><div className="job-progress-meta"><span>{cloneJob.message}</span><b>{cloneJob.percent}%</b></div>{cloneJob.sharedDataSource ? <div className="job-warning"><Icon name="alert" size={15} /><span><strong>Recurso de datos compartido</strong> Esta duplicación crea solo la aplicación; no restaura ni crea una base de datos independiente.</span></div> : null}{cloneJob.currentItem ? <div className="job-detail">Elemento actual: <strong>{cloneJob.currentItem}</strong></div> : null}<div className="job-detail">{cloneJob.kind === "image" ? "La imagen se descarga antes de recrear el contenedor." : cloneJob.errors ? `Errores reportados: ${cloneJob.errors} · la restauración continúa` : "Sin errores reportados"}</div>{cloneJob.status === "completed" && cloneJob.result ? <div className="job-detail job-success">✓ Operación completada · {cloneJob.result.port ? `puerto ${cloneJob.result.port}` : "sin puerto publicado"}</div> : null}{cloneJob.status === "failed" && cloneJob.kind === "image" ? <button className="job-retry-button" type="button" onClick={retryCloneJob}>↻ Reintentar descarga</button> : null}</> : null}</aside> : null}
      {labelService ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal edit-modal label-modal" role="dialog" aria-modal="true" aria-labelledby="labels-title"><span className="modal-kicker"><Icon name="tag" size={13} />Metadatos de Vessel</span><h2 id="labels-title"><Icon name="tag" size={19} />Etiquetas del contenedor</h2><p>Organiza <strong>{labelService.name}</strong> con etiquetas propias del portal. No modifican Docker.</p><div className="label-chips">{(labelsByContainer[labelService.id] ?? []).map((label) => <span className="label-chip" key={label}>{label}<button type="button" onClick={() => deleteLabel(label)} aria-label="Quitar etiqueta">×</button></span>)}{!(labelsByContainer[labelService.id] ?? []).length ? <span className="labels-empty">Aún no hay etiquetas asignadas.</span> : null}</div><div className="label-add-row"><input value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void saveLabel(); } }} maxLength={64} placeholder="ej. cliente, pruebas, prioridad-alta" autoFocus /><button className="primary-button" type="button" onClick={saveLabel} disabled={!labelDraft.trim() || labelSaving}>{labelSaving ? <><Icon name="loader" size={15} />Guardando…</> : <><Icon name="plus" size={15} />Agregar</>}</button></div><div className="modal-actions"><button type="button" onClick={() => setLabelService(null)}><Icon name="x" size={14} />{t("close")}</button></div></section></div> : null}
      {createVolumeOpen ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal volume-modal" role="dialog" aria-modal="true" aria-labelledby="volume-create-title"><span className="modal-kicker"><Icon name="database" size={14} />Docker · {t("volumes")}</span><h2 id="volume-create-title"><Icon name="plus" size={19} />{language === "es" ? "Crear volumen" : "Create volume"}</h2><p>{language === "es" ? "Se creará un volumen local sin asociarlo todavía a ningún contenedor." : "A local volume will be created without attaching it to a container."}</p><label className="modal-field"><span>{language === "es" ? "Nombre del volumen" : "Volume name"}</span><input value={createVolumeName} onChange={(event) => setCreateVolumeName(event.target.value)} maxLength={128} placeholder="mi-volumen" autoFocus /></label><div className="modal-actions"><button type="button" onClick={() => setCreateVolumeOpen(false)} disabled={volumeCreating}>{t("cancel")}</button><button className="primary-button" type="button" onClick={createVolume} disabled={volumeCreating || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(createVolumeName.trim())}><Icon name={volumeCreating ? "loader" : "plus"} size={15} />{volumeCreating ? (language === "es" ? "Creando…" : "Creating…") : (language === "es" ? "Crear volumen" : "Create volume")}</button></div></section></div> : null}
      {volumeDetails ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal volume-modal" role="dialog" aria-modal="true" aria-labelledby="volume-details-title"><span className="modal-kicker"><Icon name="database" size={14} />Docker · {t("volumes")}</span><h2 id="volume-details-title">{volumeDetails.Name}</h2><dl className="volume-details"><div><dt>Driver</dt><dd>{volumeDetails.Driver ?? "local"}</dd></div><div><dt>{language === "es" ? "Ruta" : "Mountpoint"}</dt><dd>{volumeDetails.Mountpoint ?? "—"}</dd></div><div><dt>{language === "es" ? "Contenedores asociados" : "Attached containers"}</dt><dd>{volumeDetails.usedBy?.length ? volumeDetails.usedBy.join(", ") : "—"}</dd></div><div><dt>{language === "es" ? "Etiquetas Docker" : "Docker labels"}</dt><dd>{Object.keys(volumeDetails.Labels ?? {}).length ? Object.entries(volumeDetails.Labels ?? {}).map(([key, value]) => <span key={key}>{key}: {value}<br /></span>) : "—"}</dd></div></dl><div className="modal-actions"><button type="button" onClick={() => setVolumeDetails(null)}>{t("close")}</button></div></section></div> : null}
      {deleteVolume ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal volume-modal" role="alertdialog" aria-modal="true" aria-labelledby="volume-delete-title"><span className="modal-kicker"><Icon name="alert" size={14} />Docker · {t("volumes")}</span><h2 id="volume-delete-title">{language === "es" ? "Eliminar volumen" : "Delete volume"}</h2><p>{language === "es" ? "Esta acción borra permanentemente los datos almacenados en" : "This permanently removes all data stored in"} <strong>{deleteVolume.Name}</strong>. {language === "es" ? "No es posible deshacerla." : "It cannot be undone."}</p><label className="modal-field"><span>{language === "es" ? "Escribe el nombre exacto para confirmar" : "Type the exact name to confirm"}</span><input value={volumeConfirmName} onChange={(event) => setVolumeConfirmName(event.target.value)} autoComplete="off" spellCheck={false} /></label><div className="modal-actions"><button type="button" onClick={() => setDeleteVolume(null)} disabled={volumeDeleting}>{t("cancel")}</button><button className="danger-button" type="button" onClick={deleteSelectedVolume} disabled={volumeDeleting || volumeConfirmName !== deleteVolume.Name || Boolean(deleteVolume.usedBy?.length)}><Icon name={volumeDeleting ? "loader" : "alert"} size={15} />{volumeDeleting ? (language === "es" ? "Eliminando…" : "Deleting…") : t("delete")}</button></div></section></div> : null}
      {imageDeleteConfirm ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="image-delete-title"><span className="modal-kicker">Imágenes de Docker</span><h2 id="image-delete-title">Borrar imágenes seleccionadas</h2><p>¿Confirmas borrar <strong>{selectedImages.size} imagen(es)</strong>? El servidor verificará todos los contenedores, incluso los inactivos. Si alguna imagen está en uso, no se borrará ninguna.</p><div className="modal-actions"><button type="button" onClick={() => setImageDeleteConfirm(false)} disabled={imageDeleting}>{t("cancel")}</button><button className="danger-button" type="button" onClick={deleteSelectedImages} disabled={imageDeleting}>{imageDeleting ? <><Icon name="loader" size={15} />Borrando…</> : <><Icon name="alert" size={15} />Confirmar borrado</>}</button></div></section></div> : null}

      {newServiceOpen ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal edit-modal new-service-modal" role="dialog" aria-modal="true" aria-labelledby="new-service-title">
        <span className="modal-kicker">Vessel · {language === "es" ? "Nuevo servicio" : "New service"}</span><h2 id="new-service-title"><Icon name="plus" size={19} />{language === "es" ? "Crear servicio" : "Create service"}</h2>
        <p>{language === "es" ? <>Se descargará la imagen Docker y se creará un contenedor nuevo. Para conservar variables y volúmenes de otro servicio usa <strong>{t("duplicate")}</strong>.</> : <>The Docker image will be pulled and a new container created. To preserve another service's variables and volumes, use <strong>{t("duplicate")}</strong>.</>}</p>
        <div className="modal-tabs" role="tablist">
          <button type="button" className={newServiceTab === "container" ? "active" : ""} onClick={() => setNewServiceTab("container")}><Icon name="box" size={14} />{t("container")}</button>
          <button type="button" className={newServiceTab === "variables" ? "active" : ""} onClick={() => setNewServiceTab("variables")}><Icon name="terminal" size={14} />{t("variables")}</button>
          <button type="button" className={newServiceTab === "runtime" ? "active" : ""} onClick={() => setNewServiceTab("runtime")}><Icon name="refresh" size={14} />{language === "es" ? "Ejecución y logs" : "Runtime & logs"}</button>
        </div>
        {newServiceTab === "container" ? <div className="modal-tab-content">
          <label className="modal-field"><span>{t("container_name")}</span><input value={newServiceName} onChange={(event) => setNewServiceName(event.target.value)} autoFocus maxLength={128} placeholder="my-service" /></label>
          <label className="modal-field"><span>{t("docker_image")}</span><input value={newServiceImage} onChange={(event) => setNewServiceImage(event.target.value)} maxLength={512} placeholder="registry/organization/image:tag" /></label>
          <div className="new-service-port-grid"><label className="modal-field"><span>{t("internal_port")}</span><input value={newServiceInternalPort} onChange={(event) => setNewServiceInternalPort(event.target.value)} type="number" min="1" max="65535" /></label><label className="modal-field"><span>{t("public_port")}</span><input value={newServicePublicPort} onChange={(event) => setNewServicePublicPort(event.target.value)} type="number" min="1" max="65535" /></label></div>
          <CustomSelect icon="layers" label={language === "es" ? "Red Docker" : "Docker network"} value={newServiceNetworkId} onChange={setNewServiceNetworkId} options={[{ value: "", label: language === "es" ? "Predeterminada del Engine (bridge)" : "Engine default (bridge)" }, ...networks.map((network) => ({ value: network.Id, label: network.Name }))]} />
          <CustomSelect icon="refresh" label={t("policy")} value={newServiceRestartPolicy} onChange={(value) => setNewServiceRestartPolicy(value as RestartPolicy)} options={restartPolicyOptions} />
          {newServiceRestartPolicy === "on-failure" ? <label className="modal-field retry-field"><span>{t("max_retries")}</span><input value={newServiceMaxRetries} onChange={(event) => setNewServiceMaxRetries(event.target.value)} type="number" min="0" max="1000000" /></label> : null}
        </div> : newServiceTab === "variables" ? <EnvironmentVariablesEditor value={newServiceVariables} onChange={setNewServiceVariables} /> : <RuntimeSettingsEditor value={newServiceRuntimeSettings} onChange={setNewServiceRuntimeSettings} />}
        <p className="modal-note">{language === "es" ? "El servicio se iniciará automáticamente después de crearlo." : "The service starts automatically after creation."}</p>
        <div className="modal-actions"><button type="button" onClick={() => setNewServiceOpen(false)} disabled={pendingAction !== null}>{t("cancel")}</button><button className="primary-button" type="button" onClick={saveNewService} disabled={pendingAction !== null || !newServiceName.trim() || !newServiceImage.trim() || !newServiceInternalPort || !newServicePublicPort}>{pendingAction === "new:create" ? <><Icon name="loader" size={15} />{t("creating")}</> : <><Icon name="plus" size={15} />{language === "es" ? "Crear servicio" : "Create service"}</>}</button></div>
      </section></div> : null}


      {view === "images" ? <section className="image-pull-panel" aria-label={t("download_image")}><div className="image-pull-copy"><span className="image-pull-icon"><Icon name="image" size={19} /></span><div><strong>{t("download_image")}</strong><span>{t("download_image_help")}</span></div></div><div className="image-pull-form"><CustomSelect icon="image" label={t("registry")} value={imagePullRegistry} onChange={setImagePullRegistry} options={[{ value: "docker-hub", label: t("docker_hub") }, ...registries.map((registry) => ({ value: registry.id, label: `${registry.name} · ${registry.url.replace(/^https?:\/\//, "")}` }))]} /><label className="resource-search"><span>{t("docker_image")}</span><input value={imagePullName} onChange={(event) => setImagePullName(event.target.value)} placeholder={imagePullRegistry === "docker-hub" ? "nginx:latest" : "organization/image:tag"} /></label><button className="primary-button" type="button" onClick={pullImage} disabled={!imagePullName.trim()}><Icon name="image" size={15} />{t("download")}</button></div></section> : null}

      {view === "containers" ? <>
        <div className="container-display-toolbar"><span>{language === "es" ? "Vista" : "View"}</span><div className="container-view-switch" role="group" aria-label={language === "es" ? "Vista de contenedores" : "Container view"}><button type="button" className={containerLayout === "cards" ? "active" : ""} onClick={() => changeContainerLayout("cards")} aria-pressed={containerLayout === "cards"}><LayoutGrid size={16} />{language === "es" ? "Tarjetas" : "Cards"}</button><button type="button" className={containerLayout === "table" ? "active" : ""} onClick={() => changeContainerLayout("table")} aria-pressed={containerLayout === "table"}><List size={17} />{language === "es" ? "Tabla" : "Table"}</button></div>{containerLayout === "table" ? <div className="container-columns-control" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setContainerColumnsOpen(false); }}><button type="button" className={`container-columns-trigger${containerColumnsOpen ? " active" : ""}`} aria-expanded={containerColumnsOpen} onClick={() => setContainerColumnsOpen((current) => !current)}><SlidersHorizontal size={15} />{t("columns")}<ChevronDown size={14} /></button>{containerColumnsOpen ? <div className="container-columns-menu" role="group" aria-label={t("columns")}>{([{ key: "compose", label: "Compose" }, { key: "image", label: t("image") }, { key: "created", label: t("created") }, { key: "ip", label: t("ip_address") }, { key: "ports", label: t("published_ports") }, { key: "database", label: t("database") }, { key: "managedBy", label: t("managed_by") }] as Array<{ key: ContainerColumn; label: string }>).map((column) => <label key={column.key}><input type="checkbox" checked={visibleContainerColumns.has(column.key)} onChange={() => toggleContainerColumn(column.key)} /><span>{column.label}</span></label>)}</div> : null}</div> : null}</div>
        {containerLayout === "table" ? <>
          {selectedServiceItems.length ? <div className="container-selection-toolbar" role="toolbar" aria-label={language === "es" ? "Acciones sobre selección" : "Selection actions"}>
            <span className="selection-count"><strong>{selectedServiceItems.length}</strong> {language === "es" ? "seleccionado(s)" : "selected"}</span>
            <button type="button" onClick={() => setBulkConfirmation("start")} disabled={!bulkStartable.length || bulkAction !== null}><Icon name="play" size={14} />{language === "es" ? `Iniciar (${bulkStartable.length})` : `Start (${bulkStartable.length})`}</button>
            <button type="button" onClick={() => setBulkConfirmation("stop")} disabled={!bulkStoppable.length || bulkAction !== null}><Icon name="stop" size={14} />{language === "es" ? `Detener (${bulkStoppable.length})` : `Stop (${bulkStoppable.length})`}</button>
            <button type="button" className="selection-clear" onClick={() => setSelectedServices(new Set())} disabled={bulkAction !== null}>{language === "es" ? "Quitar selección" : "Clear selection"}</button>
          </div> : null}
          <div className="container-table-wrap"><table className="container-table"><thead><tr>
            <th className="container-select-cell"><input type="checkbox" checked={allFilteredServicesSelected} ref={(element) => { if (element) element.indeterminate = someFilteredServicesSelected && !allFilteredServicesSelected; }} onChange={toggleAllFilteredServices} disabled={!filtered.length || bulkAction !== null} aria-label={language === "es" ? "Seleccionar todos los contenedores filtrados" : "Select all filtered containers"} /></th>
            {tableSortHeader("name", language === "es" ? "Nombre" : "Name")}
            {tableSortHeader("status", t("status"))}
            {visibleContainerColumns.has("compose") ? tableSortHeader("compose", "Compose") : null}
            {visibleContainerColumns.has("image") ? tableSortHeader("image", t("image")) : null}
            {visibleContainerColumns.has("created") ? tableSortHeader("created", t("created")) : null}
            {visibleContainerColumns.has("ip") ? tableSortHeader("ip", t("ip_address")) : null}
            {visibleContainerColumns.has("ports") ? tableSortHeader("ports", t("published_ports")) : null}
            {visibleContainerColumns.has("database") ? tableSortHeader("database", t("database")) : null}
            {visibleContainerColumns.has("managedBy") ? tableSortHeader("managedBy", t("managed_by")) : null}
            <th>{language === "es" ? "Acciones" : "Actions"}</th>
          </tr></thead><tbody>{tableRows.map((service) => <Fragment key={service.id}>
            <tr className={selectedServices.has(service.id) ? "container-row-selected" : ""}>
              <td className="container-select-cell"><input type="checkbox" checked={selectedServices.has(service.id)} onChange={() => toggleServiceSelection(service.id)} disabled={bulkAction !== null} aria-label={`${language === "es" ? "Seleccionar" : "Select"} ${service.name}`} /></td>
              <td><button type="button" className="container-name-link" onClick={() => openEdit(service)}>{service.name}</button><small>{({ application: t("applications"), database: t("databases"), external: t("external_tools") } as Record<ServiceCategory, string>)[service.category]}</small></td>
              <td><span className={`status status-${service.status}`}><span className="status-dot" />{statusLabel(service.status, t)}</span></td>
              {visibleContainerColumns.has("compose") ? <td>{service.composeProject ?? "—"}</td> : null}
              {visibleContainerColumns.has("image") ? <td className="container-table-image" title={service.image ?? undefined}>{service.image ?? "—"}</td> : null}
              {visibleContainerColumns.has("created") ? <td>{formatDateTime(service.createdAt ?? undefined, language)}</td> : null}
              {visibleContainerColumns.has("ip") ? <td className="container-table-image" title={service.ipAddresses?.join(", ")}>{service.ipAddresses?.join(", ") || "—"}</td> : null}
              {visibleContainerColumns.has("ports") ? <td className="container-table-image" title={service.publishedPorts?.join(", ")}>{service.publishedPorts?.join(", ") || (service.port ? String(service.port) : "—")}</td> : null}
              {visibleContainerColumns.has("database") ? <td>{service.databaseTarget ?? "—"}</td> : null}
              {visibleContainerColumns.has("managedBy") ? <td>{service.managedBy ?? "Docker Engine"}</td> : null}
              <td><div className="container-table-actions"><button type="button" onClick={() => requestServiceAction(service, service.status === "running" || service.status === "unhealthy" ? "stop" : service.status === "paused" ? "unpause" : "start")} disabled={isServicePending(service.id) || service.status === "starting"} title={service.status === "running" || service.status === "unhealthy" ? t("stop") : service.status === "paused" ? t("resume") : language === "es" ? "Iniciar" : "Start"}><Icon name={service.status === "running" || service.status === "unhealthy" ? "stop" : "play"} size={15} /></button><button type="button" onClick={() => openLogs(service)} title={t("logs")}><Icon name="terminal" size={15} /></button><button type="button" onClick={() => setOpenTableMenu(openTableMenu === service.id ? null : service.id)} aria-label={`${language === "es" ? "Más acciones" : "More actions"}: ${service.name}`} aria-expanded={openTableMenu === service.id}><MoreHorizontal size={17} /></button></div></td>
            </tr>
            {openTableMenu === service.id ? <tr className="container-table-expanded-row"><td colSpan={visibleContainerColumns.size + 4}><div className="container-table-expanded-actions"><button type="button" onClick={() => { openEdit(service); setOpenTableMenu(null); }}><Icon name="pencil" size={15} />{t("edit")}</button><button type="button" onClick={() => { requestServiceAction(service, "restart"); setOpenTableMenu(null); }}><Icon name="refresh" size={15} />{t("restart")}</button><button type="button" onClick={() => { requestServiceAction(service, service.status === "paused" ? "unpause" : "pause"); setOpenTableMenu(null); }} disabled={service.status !== "running" && service.status !== "paused"}><Icon name={service.status === "paused" ? "play" : "pause"} size={15} />{service.status === "paused" ? t("resume") : t("pause")}</button><button type="button" onClick={() => { requestServiceAction(service, "kill"); setOpenTableMenu(null); }} disabled={service.status !== "running" && service.status !== "unhealthy"}><Icon name="kill" size={15} />{t("kill")}</button><button type="button" onClick={() => { requestServiceAction(service, "recreate"); setOpenTableMenu(null); }}><Icon name="box" size={15} />{t("recreate")}</button><button type="button" onClick={() => { openDuplicate(service); setOpenTableMenu(null); }}><Icon name="layers" size={15} />{t("duplicate")}</button><button type="button" onClick={() => { openLabelManager(service); setOpenTableMenu(null); }}><Icon name="tag" size={15} />{t("labels")}</button><button type="button" className="table-delete" onClick={() => { setDeleteService(service); setOpenTableMenu(null); }}><Icon name="alert" size={15} />{t("delete")}</button></div></td></tr> : null}
          </Fragment>)}</tbody></table>{!filtered.length ? <div className="container-table-empty">{language === "es" ? "No hay contenedores para este filtro." : "No containers match this filter."}</div> : null}</div>
        </> : <section className="grid" aria-label="Contenedores">
        {filtered.map((service) => <article className="service-card" key={service.id}>
          <div className="service-card-head"><div className="service-title"><span className="service-icon"><Icon name={categoryIcon[service.category]} size={18} /></span><div><h3>{service.name}</h3><span className="muted" title={service.image ?? undefined}>{({ application: t("applications"), database: t("databases"), external: t("external_tools") } as Record<ServiceCategory, string>)[service.category]} · {environmentLabel(service.environment)}{service.composeProject ? <span className="compose-badge">▣ Compose · {service.composeProject}</span> : null}</span></div></div><div className="service-head-actions"><div className="status-block"><span className={`status status-${service.status}`}><span className="status-dot" />{statusLabel(service.status, t)}</span><span className="status-since">{service.status === "unhealthy" ? t("unhealthy") : localizedStatusSince(service.statusSince, language)}</span></div><button className="edit-button" type="button" onClick={() => openEdit(service)} disabled={isServicePending(service.id)} title={t("edit")} aria-label={`${t("edit")} ${service.name}`}><Icon name="pencil" size={15} /></button></div></div>
          <div className="image-line"><span className="image-label"><Icon name="image" size={14} />{t("image")}</span><span className="image-name" title={service.image ?? undefined}>{service.image ?? "—"}</span><button className="copy-button" type="button" onClick={() => copyImage(service.image)} disabled={!service.image} title="Copiar imagen" aria-label="Copiar imagen"><Icon name="copy" size={15} /></button></div>
          {(labelsByContainer[service.id] ?? []).length ? <div className="service-tags"><Icon name="tag" size={13} />{(labelsByContainer[service.id] ?? []).map((label) => <span className="service-tag" key={label}>{label}</span>)}</div> : null}
          <dl><div><dt><span className="field-label"><Icon name="port" size={13} />{t("port")}</span></dt><dd>{service.port || "—"}</dd></div><div><dt><span className="field-label"><Icon name="tag" size={13} />{t("version")}</span></dt><dd title={service.imageVersion ?? undefined}>{service.imageVersion ?? "Sin tag"}</dd></div><div className="database-field"><dt><span className="field-label"><Icon name="database" size={13} />{t("database")}</span></dt><dd title={service.databaseTarget ?? undefined}>{service.databaseTarget ?? "No configurada"}</dd></div><div className="network-field"><dt><span className="field-label"><Icon name="layers" size={13} />{t("networks")}</span></dt><dd title={service.networks.join(", ")}>{service.networks.length ? service.networks.join(", ") : "Sin red"}</dd></div></dl>
          <div className="card-actions">
            {service.status === "stopped" ? <button className="primary-button service-off" type="button" disabled><Icon name="stop" size={15} />{t("service_off")}</button> : service.ready && service.url ? <a className="primary-button" href={service.url} target="_blank" rel="noreferrer"><Icon name="external" size={15} />{t("open_service")}</a> : <button className="primary-button service-off" type="button" disabled><Icon name={service.status === "starting" ? "loader" : service.status === "paused" ? "pause" : "box"} size={15} />{service.status === "starting" ? "Verificando…" : service.status === "paused" ? t("paused") : t("no_available")}</button>}
            <button type="button" onClick={() => requestServiceAction(service, service.status === "paused" ? "unpause" : "start")} disabled={service.status === "running" || service.status === "unhealthy" || service.status === "starting" || isServicePending(service.id)}><Icon name={service.status === "starting" ? "loader" : "play"} size={14} />{service.status === "paused" ? t("resume") : t("start")}</button>
            <button type="button" onClick={() => requestServiceAction(service, "stop")} disabled={(service.status !== "running" && service.status !== "unhealthy") || isServicePending(service.id)}><Icon name="stop" size={14} />{t("stop")}</button>
            <button type="button" onClick={() => requestServiceAction(service, service.status === "paused" ? "unpause" : "pause")} disabled={(service.status !== "running" && service.status !== "paused") || isServicePending(service.id)}><Icon name={service.status === "paused" ? "play" : "pause"} size={14} />{service.status === "paused" ? t("resume") : t("pause")}</button>
            <button type="button" onClick={() => requestServiceAction(service, "kill")} disabled={(service.status !== "running" && service.status !== "unhealthy") || isServicePending(service.id)}><Icon name="kill" size={14} />{t("kill")}</button>
            <button type="button" onClick={() => requestServiceAction(service, "restart")} disabled={isServicePending(service.id)}><Icon name="refresh" size={14} />{t("restart")}</button>
            <button type="button" onClick={() => requestServiceAction(service, "recreate")} disabled={isServicePending(service.id)}><Icon name="box" size={14} />{t("recreate")}</button>
            <button type="button" onClick={() => openLabelManager(service)} disabled={isServicePending(service.id)}><Icon name="tag" size={14} />{t("labels")}</button><button type="button" onClick={() => openDuplicate(service)} disabled={isServicePending(service.id)}><Icon name="layers" size={14} />{t("duplicate")}</button><button type="button" onClick={() => setDeleteService(service)} disabled={isServicePending(service.id)} className="delete-resource-button"><Icon name="alert" size={14} />{t("delete")}</button><button type="button" onClick={() => openLogs(service)} disabled={logsLoading !== null}><Icon name="terminal" size={14} />{logsLoading === service.id ? "Logs…" : t("logs")}</button>
          </div>
        </article>)}
      </section>}</> : <section key={view} className="resource-panel" aria-live="polite">
        {resourceLoading ? <div className="empty-state"><Icon name="loader" size={22} />{t("loading_resources")}</div> : view === "images" ? <>
          <div className="resource-toolbar">
            <label className="resource-search"><span>{t("search")}</span><input value={imageQuery} onChange={(event) => setImageQuery(event.target.value)} placeholder={language === "es" ? "Registry, etiqueta o digest…" : "Registry, tag, or digest…"} /></label>
            <CustomSelect label={t("filter")} value={imageFilter} onChange={setImageFilter} options={[{ value: "all", label: t("all_images") }, { value: "untagged", label: t("untagged") }, { value: "unused", label: t("unused") }]} />
            <div className="image-total"><span>{t("total_images")}</span><strong>{images.length}</strong><small>{formatBytes(totalImageBytes)}</small></div>
          </div>
          <div className="resource-actions"><button type="button" onClick={() => setSelectedImages(allFilteredImagesSelected ? new Set() : new Set(filteredImages.map((image) => image.Id)))} disabled={!filteredImages.length}><span className="fake-checkbox" aria-hidden="true">{allFilteredImagesSelected ? "✓" : ""}</span>{allFilteredImagesSelected ? t("remove_selection") : `${t("select_results")} (${filteredImages.length})`}</button><span>{selectedImages.size} {t("selected")}</span><button className="delete-resource-button" type="button" onClick={() => setImageDeleteConfirm(true)} disabled={!selectedImages.size || imageDeleting}><Icon name="alert" size={14} />{t("delete_selected")}</button></div>
          <div className="resource-list">{filteredImages.length ? filteredImages.map((image) => <article className={`resource-row${selectedImages.has(image.Id) ? " selected" : ""}`} key={image.Id}><label className="image-checkbox"><input type="checkbox" checked={selectedImages.has(image.Id)} onChange={() => toggleImage(image.Id)} aria-label={`${language === "es" ? "Seleccionar" : "Select"} ${image.RepoTags?.[0] ?? image.Id}`} /><span className="fake-checkbox">{selectedImages.has(image.Id) ? "✓" : ""}</span></label><span className="resource-row-icon"><Icon name="image" size={18} /></span><div><strong title={image.RepoTags?.join(", ") ?? undefined}>{image.RepoTags?.join(", ") ?? (language === "es" ? "Imagen sin etiqueta" : "Untagged image")}</strong><span title={image.RepoDigests?.join(", ") ?? image.Id}>{image.RepoDigests?.[0] ?? image.Id.slice(0, 19)}</span><small className={image.used ? "image-in-use" : "image-unused"}>{image.used ? t("in_use") : t("unused_resource")} · {t("created")}: {formatDateTime(image.Created, language)}</small></div><span className="resource-size">{formatBytes(image.Size)}</span><button className="copy-button" type="button" disabled={!image.RepoTags?.[0]} onClick={() => copyImage(image.RepoTags?.[0] ?? null)} title={t("copy_image")}><Icon name="copy" size={15} /></button></article>) : <div className="empty-state">{t("no_images")}</div>}</div>
        </> : view === "networks" ? <>
          <div className="resource-toolbar network-toolbar">
            <label className="resource-search"><span>{t("search")}</span><input value={networkQuery} onChange={(event) => setNetworkQuery(event.target.value)} placeholder={t("search_networks")} /></label>
            <CustomSelect icon="layers" label={language === "es" ? "Red" : "Network"} value={selectedNetworkId} onChange={setSelectedNetworkId} options={networks.length ? networks.map((network) => ({ value: network.Id, label: network.Name })) : [{ value: "", label: t("no_networks") }]} />
            <CustomSelect icon="box" label={language === "es" ? "Contenedor" : "Container"} value={selectedNetworkContainerId} onChange={setSelectedNetworkContainerId} options={networkContainers.length ? networkContainers.map((container) => ({ value: container.id, label: container.name })) : [{ value: "", label: language === "es" ? "Sin contenedores" : "No containers" }]} />
            <button className="primary-button network-connect-button" type="button" onClick={() => changeNetworkConnection(selectedNetworkId, selectedNetworkContainerId, "connect")} disabled={!selectedNetworkId || !selectedNetworkContainerId || networkAction !== null}>{networkAction?.startsWith("connect:") ? <><Icon name="loader" size={15} />{t("connected")}</> : <><Icon name="plus" size={15} />{t("connect_container")}</>}</button>
          </div>
          <div className="resource-table-wrap"><table className="resource-data-table network-data-table"><thead><tr><th>{language === "es" ? "Nombre" : "Name"}</th><th>{t("compose_project")}</th><th>{language === "es" ? "Driver / alcance" : "Driver / scope"}</th><th>{t("ipam_driver")}</th><th>IPv4</th><th>IPv6</th><th>{t("attachable")}</th><th>{t("attached_containers")}</th></tr></thead><tbody>{filteredNetworks.map((network) => { const config = network.IPAM?.Config ?? []; const ipv4 = config.filter((item) => item.Subnet && !item.Subnet.includes(":")); const ipv6 = config.filter((item) => item.Subnet?.includes(":")); const project = network.Labels?.["com.docker.compose.project"] ?? "—"; return <tr key={network.Id}><td className="resource-name-cell" title={network.Name}>{network.Name}</td><td className="resource-subtle">{project}</td><td>{network.Driver ?? "bridge"} · {network.Scope ?? "local"}</td><td>{network.IPAM?.Driver ?? "default"}</td><td className="resource-multiline">{ipv4.length ? ipv4.map((item) => <span key={`${item.Subnet}-${item.Gateway}`}>{item.Subnet}{item.Gateway ? ` · ${item.Gateway}` : ""}<br /></span>) : "—"}</td><td className="resource-multiline">{ipv6.length ? ipv6.map((item) => <span key={`${item.Subnet}-${item.Gateway}`}>{item.Subnet}{item.Gateway ? ` · ${item.Gateway}` : ""}<br /></span>) : network.EnableIPv6 ? (language === "es" ? "Habilitado, sin subnet" : "Enabled, no subnet") : "—"}</td><td>{network.Attachable ? (language === "es" ? "Sí" : "Yes") : (language === "es" ? "No" : "No")}</td><td><div className="network-members">{Object.entries(network.Containers ?? {}).map(([containerId, container]) => <span className="network-member" key={containerId}><span title={container.Name ?? containerId}>{container.Name ?? containerId.slice(0, 12)}</span><button type="button" onClick={() => changeNetworkConnection(network.Id, containerId, "disconnect")} disabled={networkAction !== null} aria-label={`${t("disconnect_container")}: ${container.Name ?? containerId}`} title={t("disconnect_container")}>×</button></span>)}</div></td></tr>; })}</tbody></table>{!filteredNetworks.length ? <div className="resource-empty">{networks.length ? (language === "es" ? "No hay redes que coincidan con la búsqueda." : "No networks match this search.") : t("no_networks")}</div> : null}</div>
        </> : <>
          <div className="resource-toolbar">
            <label className="resource-search"><span>{t("search")}</span><input value={volumeQuery} onChange={(event) => setVolumeQuery(event.target.value)} placeholder={t("search_volumes")} /></label>
            <CustomSelect label={t("filter_usage")} value={volumeUsageFilter} onChange={setVolumeUsageFilter} options={[{ value: "all", label: t("all") }, { value: "used", label: t("in_use") }, { value: "unused", label: t("unused_resource") }]} />
            <span className="result-count">{filteredVolumes.length} {language === "es" ? "resultados" : "results"}</span>
          </div>
          <div className="resource-table-wrap"><table className="resource-data-table volume-data-table"><thead><tr><th>{language === "es" ? "Nombre" : "Name"}</th><th>{t("compose_project")}</th><th>{language === "es" ? "Driver" : "Driver"}</th><th>{language === "es" ? "Punto de montaje" : "Mount point"}</th><th>{t("created")}</th><th>{t("attached_containers")}</th><th>{language === "es" ? "Acciones" : "Actions"}</th></tr></thead><tbody>{filteredVolumes.map((volume) => <tr key={volume.Name}><td className="resource-name-cell" title={volume.Name}>{volume.Name}</td><td className="resource-subtle">{volume.Labels?.["com.docker.compose.project"] ?? "—"}</td><td>{volume.Driver ?? "local"}</td><td className="resource-multiline" title={volume.Mountpoint ?? undefined}>{volume.Mountpoint ?? "—"}</td><td>{volume.CreatedAt ? formatDateTime(volume.CreatedAt, language) : "—"}</td><td className="resource-multiline">{volume.usedBy?.length ? volume.usedBy.join(", ") : <span className="volume-unused">{language === "es" ? "Sin uso" : "Unused"}</span>}</td><td><div className="volume-row-actions"><button type="button" onClick={() => setVolumeDetails(volume)}><Icon name="layers" size={14} />{language === "es" ? "Detalles" : "Details"}</button><button type="button" className="volume-remove" onClick={() => { setDeleteVolume(volume); setVolumeConfirmName(""); }} disabled={Boolean(volume.usedBy?.length)} title={volume.usedBy?.length ? (language === "es" ? "Desconecta o elimina los contenedores asociados primero" : "Disconnect or remove attached containers first") : undefined}><Icon name="alert" size={14} />{t("delete")}</button></div></td></tr>)}</tbody></table>{!filteredVolumes.length ? <div className="resource-empty">{volumes.length ? (language === "es" ? "No hay volúmenes que coincidan con el filtro." : "No volumes match this filter.") : (language === "es" ? "No hay volúmenes disponibles." : "No volumes available.")}</div> : null}</div>
        </>}
      </section>}

      {confirmation ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><span className="modal-kicker"><Icon name="alert" size={13} />Acción de Vessel</span><h2 id="confirm-title"><Icon name={confirmation.action === "recreate" || confirmation.action === "restart" ? "refresh" : confirmation.action === "stop" ? "stop" : confirmation.action === "pause" ? "pause" : confirmation.action === "kill" ? "kill" : "play"} size={19} />Confirmar acción</h2><p>¿Confirmas {({ start: t("confirm_start"), stop: t("confirm_stop"), restart: t("confirm_restart"), kill: t("kill").toLowerCase(), pause: t("pause").toLowerCase(), unpause: t("resume").toLowerCase(), recreate: t("confirm_recreate") } as Record<typeof confirmation.action, string>)[confirmation.action]} el contenedor <strong>{confirmation.service.name}</strong>?</p><div className="modal-actions"><button type="button" onClick={() => setConfirmation(null)}><Icon name="x" size={14} />{t("cancel")}</button><button className="danger-button" type="button" onClick={() => executeServiceAction(confirmation.service, confirmation.action)}><Icon name="check" size={15} />{t("confirm")}</button></div></section></div> : null}
      {bulkConfirmation ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="bulk-confirm-title"><span className="modal-kicker"><Icon name={bulkConfirmation === "start" ? "play" : "stop"} size={13} />{language === "es" ? "Acción sobre selección" : "Bulk action"}</span><h2 id="bulk-confirm-title">{language === "es" ? (bulkConfirmation === "start" ? "Iniciar contenedores" : "Detener contenedores") : (bulkConfirmation === "start" ? "Start containers" : "Stop containers")}</h2><p>{language === "es" ? `Se ${bulkConfirmation === "start" ? "iniciarán" : "detendrán"} ${bulkConfirmation === "start" ? bulkStartable.length : bulkStoppable.length} contenedor(es) seleccionado(s). Los que no correspondan a esta acción se omitirán.` : `${bulkConfirmation === "start" ? "Start" : "Stop"} ${bulkConfirmation === "start" ? bulkStartable.length : bulkStoppable.length} selected container(s). Containers not eligible for this action will be skipped.`}</p><div className="modal-actions"><button type="button" onClick={() => setBulkConfirmation(null)}><Icon name="x" size={14} />{t("cancel")}</button><button className={bulkConfirmation === "stop" ? "danger-button" : "primary-button"} type="button" onClick={() => void executeBulkServiceAction()}><Icon name="check" size={15} />{t("confirm")}</button></div></section></div> : null}
      {deleteService ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-service-title"><span className="modal-kicker">Acción de Vessel</span><h2 id="delete-service-title">Borrar contenedor</h2><p>¿Confirmas borrar <strong>{deleteService.name}</strong>? Se eliminará el contenedor de Docker, pero no sus volúmenes ni la imagen.</p><div className="modal-actions"><button type="button" onClick={() => setDeleteService(null)} disabled={pendingAction !== null}>{t("cancel")}</button><button className="danger-button" type="button" onClick={executeDeleteService} disabled={pendingAction !== null}>{pendingAction?.endsWith(":delete") ? <><Icon name="loader" size={15} />Borrando…</> : <><Icon name="alert" size={15} />Confirmar borrado</>}</button></div></section></div> : null}
      {editService ? <div className="modal-backdrop" role="presentation"><section className="confirm-modal edit-modal service-edit-modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <span className="modal-kicker"><Icon name="pencil" size={13} />{language === "es" ? "Editar contenedor" : "Edit container"}</span><h2 id="edit-title"><Icon name="pencil" size={19} />{language === "es" ? "Configuración del contenedor" : "Container settings"}</h2>
        <p>{language === "es" ? <>Se detendrá y recreará <strong>{editService.name}</strong>, conservando sus montajes y configuración no modificada. Si estaba activo, se iniciará nuevamente.</> : <>Container <strong>{editService.name}</strong> will be stopped and recreated, preserving mounts and unchanged settings. It will be started again if it was running.</>}</p>
        <div className="modal-tabs" role="tablist">
          <button type="button" className={editTab === "container" ? "active" : ""} onClick={() => setEditTab("container")}><Icon name="box" size={14} />{t("container")}</button>
          <button type="button" className={editTab === "variables" ? "active" : ""} onClick={() => setEditTab("variables")}><Icon name="terminal" size={14} />{t("variables")}</button>
          <button type="button" className={editTab === "runtime" ? "active" : ""} onClick={() => setEditTab("runtime")}><Icon name="refresh" size={14} />{language === "es" ? "Ejecución y logs" : "Runtime & logs"}</button>
        </div>
        {editTab === "container" ? <div className="modal-tab-content">
          <CustomSelect icon="layers" label={language === "es" ? "Red Docker" : "Docker network"} value={editNetworkId} onChange={setEditNetworkId} options={[{ value: "preserve", label: editService.networks.length ? `${language === "es" ? "Conservar" : "Keep"}: ${editService.networks.join(", ")}` : t("preserve_current") }, ...networks.map((network) => ({ value: network.Id, label: network.Name }))]} />
          <p className="modal-note network-summary"><Icon name="layers" size={14} />{language === "es" ? "Al elegir otra red, se conectará después de recrear el contenedor." : "A different network will be connected after the container is recreated."}</p>
          <CustomSelect icon="refresh" label={t("policy")} value={editRestartPolicy} onChange={setEditRestartPolicy} options={[{ value: "preserve", label: t("preserve_policy") }, ...restartPolicyOptions]} />
          {editRestartPolicy === "on-failure" ? <label className="modal-field retry-field"><span>{t("max_retries")}</span><input value={editMaxRetries} onChange={(event) => setEditMaxRetries(event.target.value)} type="number" min="0" max="1000000" /></label> : null}
          <label className="modal-field"><span><Icon name="box" size={14} />{t("container_name")}</span><input value={editName} onChange={(event) => setEditName(event.target.value)} autoFocus maxLength={128} /></label>
          <label className="modal-field"><span><Icon name="port" size={14} />{t("public_port")}</span><input value={editPort} onChange={(event) => setEditPort(event.target.value)} type="number" min="1" max="65535" /></label>
          <div className="image-edit-grid"><label className="modal-field"><span><Icon name="image" size={14} />{t("registry")}</span><input value={editRegistry} readOnly title={language === "es" ? "Se conserva el registry actual" : "The current registry is preserved"} /></label><label className="modal-field"><span><Icon name="tag" size={14} />{t("image_tag")}</span><input value={editImage} onChange={(event) => setEditImage(event.target.value)} maxLength={512} placeholder="organization/image:tag" /></label></div>
        </div> : editTab === "variables" ? <EnvironmentVariablesEditor value={editVariables} onChange={setEditVariables} /> : editRuntimeSettings ? <RuntimeSettingsEditor value={editRuntimeSettings} onChange={setEditRuntimeSettings} /> : <p className="runtime-unavailable">{language === "es" ? "No se pudieron leer los ajustes actuales del Engine; se conservarán sin cambios." : "Current Engine settings could not be read; they will be left unchanged."}</p>}
        <div className="modal-actions"><button type="button" onClick={() => setEditService(null)} disabled={pendingAction !== null}><Icon name="x" size={14} />{t("cancel")}</button><button className="danger-button" type="button" onClick={saveEdit} disabled={pendingAction !== null || !editName.trim() || !editPort || !editImage.trim()}>{pendingAction?.endsWith(":edit") ? <><Icon name="loader" size={15} />{t("recreating_action")}</> : <><Icon name="pencil" size={15} />{t("applying_changes")}</>}</button></div>
      </section></div> : null}
      {duplicateService ? <div className="modal-backdrop" role="presentation">
        <section className="confirm-modal edit-modal" role="dialog" aria-modal="true" aria-labelledby="duplicate-title">
          <span className="modal-kicker"><Icon name="layers" size={13} />{language === "es" ? "Clonar ambiente" : "Clone environment"}</span>
          <h2 id="duplicate-title"><Icon name="layers" size={19} />{language === "es" ? "Duplicar aplicación" : "Duplicate application"}</h2>
          <p>{language === "es" ? "Elige qué quieres crear a partir de" : "Choose what to create from"} <strong>{duplicateService.name}</strong>.</p>
          {duplicateService.dataCloneEngine ? <div className="duplicate-modes" role="radiogroup" aria-label={language === "es" ? "Modo de duplicación" : "Duplication mode"}>
            <button type="button" className={duplicateMode === "data" ? "selected" : ""} onClick={() => { setDuplicateMode("data"); setDuplicateDataTarget(`${duplicateService.databaseTarget || duplicateService.name}_2`); setDuplicateAcknowledged(false); }}>
              <strong><Icon name="database" size={15} />{language === "es" ? "Aplicación + datos" : "Application + data"}</strong>
              <span>{language === "es" ? `Copia el recurso de datos con el motor detectado (${duplicateService.dataCloneEngine}) y crea un entorno independiente.` : `Copies the data resource using the detected ${duplicateService.dataCloneEngine} engine and creates an independent environment.`}</span>
            </button>
            <button type="button" className={duplicateMode === "application" ? "selected" : ""} onClick={() => { setDuplicateMode("application"); setDuplicateAcknowledged(false); }}>
              <strong><Icon name="box" size={15} />{language === "es" ? "Solo aplicación" : "Application only"}</strong>
              <span>{language === "es" ? "Crea otro contenedor y conserva la conexión al recurso de origen." : "Creates another container and keeps it connected to the original data resource."}</span>
            </button>
          </div> : duplicateService.databaseTarget ? <div className="duplicate-warning" role="status">
            <strong>{language === "es" ? "Copia de datos no disponible" : "Data copy unavailable"}</strong>
            <span>{language === "es" ? "No se detectó un adaptador de copia compatible en la configuración del servicio. Puedes duplicar solo la aplicación." : "No compatible data-copy adapter was detected in this service configuration. You can duplicate the application only."}</span>
          </div> : null}
          {duplicateMode === "application" && duplicateService.databaseTarget ? <div className="duplicate-warning" role="alert">
            <strong>{language === "es" ? "Recurso de datos compartido" : "Shared data resource"}</strong>
            <span>{language === "es" ? "El nuevo contenedor usará la conexión definida en sus variables. Los cambios de cualquiera de las aplicaciones afectarán los mismos datos." : "The new container will use the connection defined by its environment variables. Changes from either application affect the same data."}</span>
            <label><input type="checkbox" checked={duplicateAcknowledged} onChange={(event) => setDuplicateAcknowledged(event.target.checked)} />{language === "es" ? "Entiendo y deseo continuar compartiendo estos datos." : "I understand and want to continue sharing this data."}</label>
          </div> : duplicateUsesSameData ? <div className="duplicate-warning" role="alert">
            <strong>{language === "es" ? "Operación bloqueada" : "Operation blocked"}</strong>
            <span>{language === "es" ? "El nombre destino coincide con el recurso de origen" : "The target name matches the source resource"} <b>{duplicateService.databaseTarget}</b>. {language === "es" ? "Indica un nombre nuevo; Vessel no sobrescribe recursos existentes." : "Choose a new name; Vessel never overwrites existing resources."}</span>
          </div> : null}
          <div className="modal-tabs" role="tablist">
            <button type="button" className={duplicateTab === "container" ? "active" : ""} onClick={() => setDuplicateTab("container")}><Icon name="box" size={14} />{language === "es" ? "Contenedor" : "Container"}</button>
            <button type="button" className={duplicateTab === "variables" ? "active" : ""} onClick={() => setDuplicateTab("variables")}><Icon name="terminal" size={14} />{t("variables")}</button>
            <button type="button" className={duplicateTab === "runtime" ? "active" : ""} onClick={() => setDuplicateTab("runtime")}><Icon name="refresh" size={14} />{language === "es" ? "Ejecución y logs" : "Runtime & logs"}</button>
          </div>
          {duplicateTab === "container" ? <div className="modal-tab-content">
            <label className="modal-field"><span><Icon name="box" size={14} />{t("new_container_name")}</span><input value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} autoFocus maxLength={128} /></label>
            {duplicateMode === "data" ? <label className="modal-field"><span><Icon name="database" size={14} />{language === "es" ? "Nombre del recurso de datos destino" : "Target data resource name"}</span><input value={duplicateDataTarget} onChange={(event) => setDuplicateDataTarget(event.target.value)} maxLength={64} /></label> : null}
            <label className="modal-field"><span><Icon name="image" size={14} />{t("docker_image")}</span><input value={duplicateImage} onChange={(event) => setDuplicateImage(event.target.value)} maxLength={512} placeholder="registry/organization/image:tag" /></label>
            {duplicateService.port ? <label className="modal-field"><span><Icon name="port" size={14} />{t("public_port")}</span><input value={duplicatePort} onChange={(event) => setDuplicatePort(event.target.value)} type="number" min="1" max="65535" /></label> : <p className="modal-note">{language === "es" ? "El origen no publica puertos; el duplicado tampoco publicará uno." : "The source publishes no ports, so the duplicate will not publish one."}</p>}
            <CustomSelect icon="layers" label={language === "es" ? "Red Docker" : "Docker network"} value={duplicateNetworkId} onChange={setDuplicateNetworkId} options={[{ value: "preserve", label: duplicateService.networks.length ? `${language === "es" ? "Conservar" : "Keep"}: ${duplicateService.networks.join(", ")}` : (language === "es" ? "Conservar configuración actual" : "Keep current configuration") }, ...networks.map((network) => ({ value: network.Id, label: network.Name }))]} />
            <CustomSelect icon="refresh" label={language === "es" ? "Política de reinicio" : "Restart policy"} value={duplicateRestartPolicy} onChange={setDuplicateRestartPolicy} options={[{ value: "preserve", label: language === "es" ? "Conservar política del origen" : "Keep source policy" }, ...restartPolicyOptions]} />
            {duplicateRestartPolicy === "on-failure" ? <label className="modal-field retry-field"><span>{t("max_retries")}</span><input value={duplicateMaxRetries} onChange={(event) => setDuplicateMaxRetries(event.target.value)} type="number" min="0" max="1000000" /></label> : null}
          </div> : duplicateTab === "variables" ? <EnvironmentVariablesEditor value={duplicateVariables} onChange={setDuplicateVariables} /> : duplicateRuntimeSettings ? <RuntimeSettingsEditor value={duplicateRuntimeSettings} onChange={setDuplicateRuntimeSettings} /> : <p className="runtime-unavailable">{language === "es" ? "No se pudieron leer los ajustes del contenedor origen; se conservarán sin cambios." : "The source container settings could not be read; they will be left unchanged."}</p>}
          <p className="modal-note">{duplicateMode === "data" ? (language === "es" ? "El recurso destino debe ser nuevo. Vessel no sobrescribe datos existentes." : "The target resource must be new. Vessel never overwrites existing data.") : duplicateService.databaseTarget ? (language === "es" ? "El duplicado solo continuará cuando confirmes que compartirá el recurso de datos." : "The duplicate can continue only after you confirm it will share the data resource.") : (language === "es" ? "Se conservarán las variables, imagen y configuración del contenedor original." : "The source container's environment, image and configuration will be preserved.")}</p>
          <p className="modal-note duplicate-mount-warning">{language === "es" ? "Los volúmenes y rutas montados se reutilizan, no se copian. Si el servicio escribe datos persistentes allí, el duplicado compartirá esos mismos datos." : "Mounted volumes and paths are reused, not copied. If the service writes persistent data there, the duplicate will share that data."}</p>
          <div className="modal-actions">
            <button type="button" onClick={() => setDuplicateService(null)} disabled={pendingAction !== null}><Icon name="x" size={14} />{t("cancel")}</button>
            <button className="primary-button" type="button" onClick={saveDuplicate} disabled={pendingAction !== null || !duplicateName.trim() || (duplicateMode === "data" && (!duplicateDataTarget.trim() || !duplicateService.dataCloneEngine)) || !duplicateImage.trim() || (Boolean(duplicateService.port) && !duplicatePort) || duplicateBlocked}>
              {pendingAction?.endsWith(":duplicate") ? <><Icon name="loader" size={15} />{t("creating")}</> : <><Icon name="layers" size={15} />{language === "es" ? "Crear duplicado" : "Create duplicate"}</>}
            </button>
          </div>
        </section>
      </div> : null}
      {logService ? <div className="modal-backdrop" role="presentation"><section style={{ transform: `translate(${logsPosition.x}px, ${logsPosition.y}px)` }} className={`logs-modal${logsExpanded ? " logs-expanded" : ""}${draggingLogs ? " logs-dragging" : ""}`} role="dialog" aria-modal="true" aria-labelledby="logs-title"><div className="logs-head" onPointerDown={startDraggingLogs}><div><span className="modal-kicker">Vessel · Logs</span><h2 id="logs-title">{logService.name}</h2></div><div className="logs-actions"><button type="button" className="logs-expand" onClick={() => setLogsExpanded((value) => !value)}>{logsExpanded ? "Reducir" : "Expandir"}</button><button type="button" className="logs-close" onClick={() => setLogService(null)} aria-label="Cerrar logs">×</button></div></div><pre>{logService.logs || "Sin logs disponibles"}</pre></section></div> : null}

      <footer><span>{syncState === "ok" ? `Sincronización activa${discoveredCount === null ? "" : ` · ${discoveredCount} contenedores detectados.`}` : "Backend Docker no disponible."}</span></footer>
    </main>
  );
}
