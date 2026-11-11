"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRightLeft, File, Folder, FolderOpen, HardDriveUpload, LoaderCircle, RefreshCw, Upload, X } from "lucide-react";

type ContainerChoice = { id: string; name: string; status: string };
type Entry = { name: string; size: number; type: "file" | "directory" | "symlink" };
type Pane = "source" | "target";
type PaneState = { path: string; entries: Entry[]; loading: boolean; error: string };

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export default function ContainerFilesModal({ service, containers, es, onClose, onToast }: { service: ContainerChoice; containers: ContainerChoice[]; es: boolean; onClose: () => void; onToast: (kind: "success" | "error", message: string) => void }) {
  const [targetId, setTargetId] = useState(containers.find((item) => item.id !== service.id && item.status === "running")?.id ?? containers.find((item) => item.id !== service.id)?.id ?? "");
  const [source, setSource] = useState<PaneState>({ path: "/", entries: [], loading: false, error: "" });
  const [target, setTarget] = useState<PaneState>({ path: "/", entries: [], loading: false, error: "" });
  const [dragOver, setDragOver] = useState<Pane | null>(null);
  const [busy, setBusy] = useState("");
  const uploadRefs = useRef<Record<Pane, HTMLInputElement | null>>({ source: null, target: null });
  const targetContainer = useMemo(() => containers.find((item) => item.id === targetId) ?? null, [containers, targetId]);

  const load = useCallback(async (pane: Pane, path: string) => {
    const targetPane = pane === "source" ? setSource : setTarget;
    const containerId = pane === "source" ? service.id : targetId;
    if (!containerId) return;
    targetPane((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await fetch(`/api/container-files?serviceId=${encodeURIComponent(containerId)}&path=${encodeURIComponent(path)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (es ? "No se pudo leer la carpeta." : "Could not read this folder."));
      targetPane({ path: payload.path, entries: payload.entries ?? [], loading: false, error: "" });
    } catch (error) { targetPane((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : (es ? "Error de lectura." : "Read failed.") })); }
  }, [service.id, targetId, es]);

  useEffect(() => { void load("source", "/"); }, [load, service.id]);
  useEffect(() => { if (targetId) void load("target", "/"); else setTarget({ path: "/", entries: [], loading: false, error: "" }); }, [load, targetId]);

  async function download(pane: Pane, entry: Entry) {
    if (entry.type !== "file") return;
    const containerId = pane === "source" ? service.id : targetId;
    const path = `${(pane === "source" ? source.path : target.path).replace(/\/$/, "")}/${entry.name}` || `/${entry.name}`;
    setBusy(`download:${pane}:${entry.name}`);
    try {
      const response = await fetch(`/api/container-files?action=download&serviceId=${encodeURIComponent(containerId)}&path=${encodeURIComponent(path)}`, { cache: "no-store" });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || (es ? "No se pudo descargar." : "Download failed.")); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = entry.name; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { onToast("error", error instanceof Error ? error.message : (es ? "No se pudo descargar." : "Download failed.")); }
    finally { setBusy(""); }
  }

  async function upload(pane: Pane, files: FileList | File[]) {
    const file = files[0];
    if (!file) return;
    const containerId = pane === "source" ? service.id : targetId;
    const path = pane === "source" ? source.path : target.path;
    const form = new FormData(); form.set("serviceId", containerId); form.set("path", path); form.set("file", file);
    setBusy(`upload:${pane}`);
    try {
      const response = await fetch("/api/container-files", { method: "POST", body: form, cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (es ? "No se pudo subir el archivo." : "Upload failed."));
      onToast("success", es ? `${file.name} se copió al contenedor.` : `${file.name} was uploaded to the container.`);
      await load(pane, path);
    } catch (error) { onToast("error", error instanceof Error ? error.message : (es ? "No se pudo subir el archivo." : "Upload failed.")); }
    finally { setBusy(""); }
  }

  async function transfer(from: Pane, sourcePath: string, name: string, destination: Pane) {
    const sourceId = from === "source" ? service.id : targetId;
    const destinationId = destination === "source" ? service.id : targetId;
    const destinationPath = destination === "source" ? source.path : target.path;
    setBusy(`copy:${name}`);
    try {
      const response = await fetch("/api/container-files", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "copy", sourceServiceId: sourceId, destinationServiceId: destinationId, sourcePath, destinationPath }), cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || (es ? "No se pudo transferir el archivo." : "File transfer failed."));
      onToast("success", es ? `${name} se transfirió correctamente.` : `${name} was transferred successfully.`);
      await load(destination, destinationPath);
    } catch (error) { onToast("error", error instanceof Error ? error.message : (es ? "No se pudo transferir el archivo." : "File transfer failed.")); }
    finally { setBusy(""); setDragOver(null); }
  }

  function paneView(pane: Pane, state: PaneState) {
    const container = pane === "source" ? service : targetContainer;
    const parent = state.path === "/" ? null : state.path.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
    return <section className={`container-files-pane${dragOver === pane ? " is-drop-target" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragOver(pane); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(null); }} onDrop={(event) => { event.preventDefault(); const encoded = event.dataTransfer.getData("application/x-vessel-container-file"); if (encoded) { try { const item = JSON.parse(encoded) as { from: Pane; path: string; name: string; type: Entry["type"] }; if (item.type === "file") void transfer(item.from, item.path, item.name, pane); } catch { setDragOver(null); } } else if (event.dataTransfer.files.length) void upload(pane, event.dataTransfer.files); }}>
      <header><div><strong>{container?.name ?? (es ? "Destino" : "Destination")}</strong><small>{container ? (es ? "Sistema de archivos del contenedor" : "Container filesystem") : (es ? "Selecciona un contenedor destino" : "Choose a destination container")}</small></div><button type="button" onClick={() => void load(pane, state.path)} disabled={state.loading || !container}><RefreshCw size={14} /></button></header>
      {pane === "target" ? <label className="container-files-target-select"><span>{es ? "Contenedor destino" : "Destination container"}</span><select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">{es ? "Seleccionar contenedor…" : "Select a container…"}</option>{containers.filter((item) => item.id !== service.id).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select></label> : null}
      <div className="container-files-path"><button type="button" onClick={() => parent && void load(pane, parent)} disabled={!parent || state.loading} aria-label={es ? "Subir un nivel" : "Go up one level"}><ArrowLeft size={15} /></button><code title={state.path}>{state.path}</code><button type="button" onClick={() => uploadRefs.current[pane]?.click()} disabled={!container || busy !== ""} title={es ? "Subir archivo desde este equipo" : "Upload a file from this computer"}><Upload size={15} /></button><input ref={(element) => { uploadRefs.current[pane] = element; }} type="file" hidden onChange={(event) => { if (event.target.files) void upload(pane, event.target.files); event.target.value = ""; }} /></div>
      <div className="container-files-list" aria-busy={state.loading}>
        {!container ? <div className="container-files-empty">{es ? "Elige un contenedor destino para transferir archivos." : "Choose a destination container to transfer files."}</div> : state.loading ? <div className="container-files-empty"><LoaderCircle size={18} className="spinning" />{es ? "Leyendo carpeta…" : "Loading folder…"}</div> : state.error ? <div className="container-files-error">{state.error}</div> : state.entries.length ? state.entries.map((entry) => { const fullPath = `${state.path.replace(/\/$/, "")}/${entry.name}` || `/${entry.name}`; return <div className="container-files-entry" key={entry.name} draggable={entry.type === "file"} onDragStart={(event) => { event.dataTransfer.setData("application/x-vessel-container-file", JSON.stringify({ from: pane, path: fullPath, name: entry.name, type: entry.type })); event.dataTransfer.effectAllowed = "copy"; }}><button type="button" className="container-files-entry-open" onDoubleClick={() => entry.type === "directory" && void load(pane, fullPath)} onClick={() => entry.type === "file" && void download(pane, entry)} title={entry.type === "directory" ? (es ? "Doble clic para abrir" : "Double-click to open") : (es ? "Descargar archivo" : "Download file")}><span>{entry.type === "directory" ? <Folder size={16} /> : entry.type === "symlink" ? <ArrowRightLeft size={16} /> : <File size={16} />}</span><strong>{entry.name}</strong><small>{entry.type === "directory" ? (es ? "Carpeta" : "Folder") : entry.type === "symlink" ? (es ? "Enlace" : "Link") : formatBytes(entry.size)}</small></button>{entry.type === "directory" ? <button type="button" className="container-files-open" onClick={() => void load(pane, fullPath)} aria-label={`${es ? "Abrir" : "Open"} ${entry.name}`}><FolderOpen size={15} /></button> : entry.type === "file" ? <button type="button" className="container-files-open" onClick={() => void download(pane, entry)} disabled={busy !== ""} aria-label={`${es ? "Descargar" : "Download"} ${entry.name}`}><ArrowDownToLine size={15} /></button> : null}</div>; }) : <div className="container-files-empty"><Folder size={18} />{es ? "Esta carpeta está vacía. Arrastra un archivo aquí para subirlo." : "This folder is empty. Drop a file here to upload it."}</div>}
      </div>
      {dragOver === pane ? <div className="container-files-drop-hint"><HardDriveUpload size={17} />{es ? "Suelta aquí para transferir" : "Drop here to transfer"}</div> : null}
    </section>;
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="container-files-modal" role="dialog" aria-modal="true" aria-labelledby="container-files-title"><header className="container-files-heading"><div><span className="module-kicker">DOCKER · {es ? "ARCHIVOS" : "FILES"}</span><h2 id="container-files-title">{es ? "Archivos del contenedor" : "Container files"}</h2><p>{es ? "Arrastra archivos entre contenedores o desde tu equipo. También puedes descargarlos directamente." : "Drag files between containers or from your computer. You can also download them directly."}</p></div><button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label={es ? "Cerrar" : "Close"}><X size={19} /></button></header><div className="container-files-safety"><ArrowRightLeft size={15} />{es ? "Solo se transfieren archivos de hasta 32 MB. Las carpetas y enlaces simbólicos no se copian entre contenedores." : "Files up to 32 MB can be transferred. Folders and symbolic links are not copied between containers."}</div><div className="container-files-workspace">{paneView("source", source)}<div className="container-files-transfer-mark"><ArrowRightLeft size={19} /></div>{paneView("target", target)}</div><footer className="container-files-footer"><span>{busy ? <><LoaderCircle size={14} className="spinning" />{busy.startsWith("copy:") ? (es ? `Transfiriendo ${busy.slice(5)}…` : `Transferring ${busy.slice(5)}…`) : busy.startsWith("upload:") ? (es ? "Subiendo archivo…" : "Uploading file…") : (es ? "Preparando descarga…" : "Preparing download…")}</> : <>{es ? "Arrastra un archivo de una lista a la otra para copiarlo." : "Drag a file from one list to the other to copy it."}</>}</span><button type="button" onClick={onClose} disabled={Boolean(busy)}>{es ? "Cerrar" : "Close"}</button></footer></section></div>;
}
