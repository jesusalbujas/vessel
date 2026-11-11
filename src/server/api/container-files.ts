import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticatedUser, userHasPermission } from "@/lib/control-plane";
import { dockerApiBase, dockerHeaders, isDockerConfigured } from "@/lib/docker/client";
import { listDockerContainers } from "@/lib/docker/containers";

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
// Allow tar headers and block padding around an eligible 32 MB file.
const MAX_ARCHIVE_BYTES = MAX_UPLOAD_BYTES + 1024 * 1024;
const MAX_DIRECTORY_LIST_BYTES = 8 * 1024 * 1024;
type TarEntry = { name: string; size: number; type: "file" | "directory" | "symlink" };

function privateJson(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization" } });
}

function safeContainerPath(input: string | null): string {
  const value = input?.trim() || "/";
  if (!value.startsWith("/") || value.length > 4096 || /[\0-\x1f\x7f]/.test(value)) throw new Error("La ruta debe ser absoluta y no contener caracteres de control.");
  const parts = value.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..")) throw new Error("La ruta no puede salir de la raíz del contenedor.");
  return `/${parts.join("/")}`;
}

function safeFileName(input: string): string {
  const name = input.trim();
  if (!name || name.length > 255 || name === "." || name === ".." || /[\\/\0-\x1f\x7f]/.test(name)) throw new Error("El nombre del archivo no es válido.");
  return name;
}

async function containerId(serviceId: unknown): Promise<string> {
  if (typeof serviceId !== "string" || !/^container-[a-f0-9]{12}$/i.test(serviceId)) throw new Error("Contenedor inválido.");
  const item = (await listDockerContainers()).find((container) => serviceId === `container-${container.Id.slice(0, 12)}`);
  if (!item) throw new Error("Contenedor no encontrado.");
  return item.Id;
}

async function fetchArchive(id: string, path: string): Promise<Buffer> {
  const response = await fetch(`${dockerApiBase()}/containers/${encodeURIComponent(id)}/archive?path=${encodeURIComponent(path)}`, { headers: dockerHeaders(), cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(response.status === 404 ? "No se encontró la ruta en el contenedor." : `Docker no pudo leer la ruta (${response.status}).`);
  if (!response.body) throw new Error("Docker no devolvió el archivo.");
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ARCHIVE_BYTES) { await reader.cancel(); throw new Error("El archivo supera el límite de transferencia de 32 MB. Comprímelo dentro del contenedor para transferirlo."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

async function listContainerDirectory(id: string, path: string): Promise<TarEntry[]> {
  // List only direct children with a tiny shell command. Docker's archive API
  // recursively tars the whole directory, so using it to list `/` fails on
  // ordinary containers whose filesystem is larger than the transfer limit.
  const script = [
    'dir="$1"',
    'for item in "$dir"/* "$dir"/.[!.]* "$dir"/..?*; do',
    '  [ -e "$item" ] || [ -L "$item" ] || continue',
    '  name=${item##*/}',
    '  if [ -L "$item" ]; then kind=symlink; size=',
    '  elif [ -d "$item" ]; then kind=directory; size=',
    '  else kind=file; size=$(stat -c %s "$item" 2>/dev/null || printf ""); fi',
    '  encoded=$(printf %s "$name" | base64 | tr -d "\\n") || exit 20',
    '  printf "%s\\t%s\\t%s\\n" "$kind" "$size" "$encoded"',
    'done',
  ].join("\n");
  const created = await fetch(`${dockerApiBase()}/containers/${encodeURIComponent(id)}/exec`, {
    method: "POST", headers: { ...dockerHeaders(), "Content-Type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({ AttachStdout: true, AttachStderr: true, Tty: false, Cmd: ["/bin/sh", "-c", script, "vessel-files", path] }),
  });
  if (created.status === 409) throw new Error("Inicia el contenedor para explorar sus archivos.");
  if (!created.ok) throw new Error(`Docker no pudo iniciar el explorador de archivos (${created.status}).`);
  const execId = (await created.json().catch(() => null))?.Id;
  if (typeof execId !== "string" || !/^[a-f0-9]{12,64}$/i.test(execId)) throw new Error("Docker no devolvió una sesión válida para explorar archivos.");
  const started = await fetch(`${dockerApiBase()}/exec/${encodeURIComponent(execId)}/start`, {
    method: "POST", headers: { ...dockerHeaders(), "Content-Type": "application/json" }, cache: "no-store",
    signal: AbortSignal.timeout(15_000), body: JSON.stringify({ Detach: false, Tty: false }),
  });
  if (!started.ok || !started.body) throw new Error(started.status === 409 ? "Inicia el contenedor para explorar sus archivos." : `Docker no pudo leer la carpeta (${started.status}).`);
  const reader = started.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DIRECTORY_LIST_BYTES) { await reader.cancel(); throw new Error("La carpeta tiene demasiadas entradas para mostrar en una sola vista."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const stream = Buffer.concat(chunks, total);
  const output: Buffer[] = [];
  const errors: Buffer[] = [];
  let offset = 0;
  while (offset + 8 <= stream.length) {
    const channel = stream[offset];
    const size = stream.readUInt32BE(offset + 4);
    if (size > stream.length - offset - 8) throw new Error("Docker devolvió una respuesta incompleta al leer la carpeta.");
    const payload = stream.subarray(offset + 8, offset + 8 + size);
    if (channel === 1) output.push(payload);
    else if (channel === 2) errors.push(payload);
    offset += 8 + size;
  }
  if (offset !== stream.length) throw new Error("Docker devolvió una respuesta no válida al leer la carpeta.");
  const listing = Buffer.concat(output).toString("utf8");
  const stderr = Buffer.concat(errors).toString("utf8").trim();
  if (stderr && !listing) {
    if (/executable file not found|stat \/bin\/sh|no such file/i.test(stderr)) throw new Error("Este contenedor no incluye una shell compatible para explorar sus archivos.");
    throw new Error("El contenedor no permitió leer esta carpeta. Revisa sus permisos.");
  }
  const entries: TarEntry[] = [];
  for (const line of listing.split("\n")) {
    if (!line) continue;
    const [kind, sizeText, encoded] = line.split("\t");
    if (!(kind === "file" || kind === "directory" || kind === "symlink") || !encoded || encoded.length > 4096) continue;
    const name = Buffer.from(encoded, "base64").toString("utf8");
    if (!name || name === "." || name === ".." || /[\/\0]/.test(name)) continue;
    const size = sizeText && /^\d+$/.test(sizeText) ? Number(sizeText) : 0;
    entries.push({ name, size: Number.isSafeInteger(size) ? size : 0, type: kind });
  }
  return entries.sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name));
}

function tarEntries(archive: Buffer): Array<{ meta: TarEntry; data: Buffer }> {
  const result: Array<{ meta: TarEntry; data: Buffer }> = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start: number, end: number) => header.subarray(start, end).toString("utf8").split("\0", 1)[0];
    const prefix = text(345, 500);
    const name = [prefix, text(0, 100)].filter(Boolean).join("/");
    const sizeText = text(124, 136).trim();
    const size = sizeText ? Number.parseInt(sizeText.replace(/[^0-7]/g, ""), 8) : 0;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_ARCHIVE_BYTES) throw new Error("El archivo tar del contenedor no es válido.");
    const typeflag = header[156];
    const type = typeflag === 53 ? "directory" : typeflag === 50 ? "symlink" : typeflag === 0 || typeflag === 48 ? "file" : null;
    if (type) result.push({ meta: { name, size, type }, data: archive.subarray(offset + 512, offset + 512 + size) });
    offset += 512 + Math.ceil(size / 512) * 512;
    if (offset > archive.length) throw new Error("El archivo tar del contenedor está incompleto.");
  }
  return result;
}

function listChildren(archive: Buffer, requestedPath: string): TarEntry[] {
  const base = requestedPath.replace(/^\/+|\/+$/g, "");
  const entries = new Map<string, TarEntry>();
  for (const { meta } of tarEntries(archive)) {
    let name = meta.name.replace(/^\.\//, "").replace(/^\/+/, "");
    if (base && name === base) continue;
    if (base && name.startsWith(`${base}/`)) name = name.slice(base.length + 1);
    else if (base && name.includes("/")) {
      // Docker may return names relative to the requested directory.
    }
    name = name.replace(/\/+$/, "");
    if (!name || name.split("/").some((part) => part === "..")) continue;
    const [first, ...rest] = name.split("/");
    const isNested = rest.length > 0;
    const type = isNested ? "directory" : meta.type;
    const previous = entries.get(first);
    if (!previous || previous.type !== "directory") entries.set(first, { name: first, size: isNested ? 0 : meta.size, type });
  }
  return [...entries.values()].sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name));
}

function tarFile(name: string, data: Buffer): Buffer {
  const header = Buffer.alloc(512);
  const put = (value: string, start: number, length: number) => header.write(value.slice(0, length - 1), start, length - 1, "utf8");
  const octal = (value: number, length: number) => value.toString(8).padStart(length - 1, "0");
  put(name, 0, 100); put(octal(0o644, 8), 100, 8); put(octal(0, 8), 108, 8); put(octal(0, 8), 116, 8); put(octal(data.length, 12), 124, 12); put(octal(Math.floor(Date.now() / 1000), 12), 136, 12);
  header.fill(32, 148, 156); header[156] = 48; put("ustar", 257, 6); put("00", 263, 2);
  let checksum = 0; for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512); data.copy(padded);
  return Buffer.concat([header, padded, Buffer.alloc(1024)]);
}

async function uploadArchive(id: string, directory: string, name: string, archive: Buffer): Promise<void> {
  const fullPath = `${directory === "/" ? "" : directory}/${name}`;
  const exists = await fetch(`${dockerApiBase()}/containers/${encodeURIComponent(id)}/archive?path=${encodeURIComponent(fullPath)}`, { method: "HEAD", headers: dockerHeaders(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (exists.ok) throw new Error("Ya existe un archivo con ese nombre en la carpeta de destino.");
  const response = await fetch(`${dockerApiBase()}/containers/${encodeURIComponent(id)}/archive?path=${encodeURIComponent(directory)}`, { method: "PUT", headers: { ...dockerHeaders(), "Content-Type": "application/x-tar" }, body: new Uint8Array(archive), cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Docker no pudo escribir en el contenedor (${response.status}). Revisa los permisos de la carpeta.`);
}

async function authorized(request: Request, manage = false) {
  const user = authenticatedUser(request);
  if (!user) return { error: privateJson({ error: "Authentication required" }, 401) };
  if (!userHasPermission(user, manage ? "containers.manage" : "containers.files")) return { error: privateJson({ error: "Permission denied" }, 403) };
  if (!isDockerConfigured()) return { error: privateJson({ error: "Docker Engine no está configurado" }, 503) };
  return { user };
}

export async function getContainerFiles(request: Request) {
  const access = await authorized(request);
  if (access.error) return access.error;
  const url = new URL(request.url);
  try {
    const id = await containerId(url.searchParams.get("serviceId"));
    const path = safeContainerPath(url.searchParams.get("path"));
    const action = url.searchParams.get("action") ?? "list";
    if (action === "list") return privateJson({ path, entries: await listContainerDirectory(id, path) });
    if (action !== "download") return privateJson({ error: "Acción de archivos inválida." }, 400);
    const archive = await fetchArchive(id, path);
    const requestedName = path.split("/").filter(Boolean).pop();
    const files = tarEntries(archive).filter(({ meta }) => meta.type === "file");
    const found = files.find(({ meta }) => meta.name.replace(/\/+$/, "").split("/").pop() === requestedName) ?? (files.length === 1 ? files[0] : undefined);
    if (!found) return privateJson({ error: "La ruta no apunta a un archivo regular." }, 400);
    if (found.data.byteLength > MAX_UPLOAD_BYTES) return privateJson({ error: "El archivo supera el límite de transferencia de 32 MB. Comprímelo dentro del contenedor para transferirlo." }, 413);
    return new NextResponse(new Uint8Array(found.data), { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(found.data.byteLength), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(requestedName ?? "download")}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return privateJson({ error: error instanceof Error ? error.message : "No se pudo leer el contenedor." }, 400); }
}

export async function postContainerFiles(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const access = await authorized(request, true);
  if (access.error) return access.error;
  try {
    if (contentType.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const id = await containerId(form.get("serviceId"));
      const directory = safeContainerPath(typeof form.get("path") === "string" ? String(form.get("path")) : "/");
      const value = form.get("file");
      if (!(value instanceof File)) return privateJson({ error: "Selecciona un archivo para subir." }, 400);
      const name = safeFileName(value.name);
      if (value.size > MAX_UPLOAD_BYTES) return privateJson({ error: "El límite de carga es 32 MB por archivo." }, 413);
      await uploadArchive(id, directory, name, tarFile(name, Buffer.from(await value.arrayBuffer())));
      return privateJson({ ok: true, name });
    }
    const body = await request.json() as { action?: unknown; sourceServiceId?: unknown; destinationServiceId?: unknown; sourcePath?: unknown; destinationPath?: unknown };
    if (body.action !== "copy") return privateJson({ error: "Acción de archivos inválida." }, 400);
    const sourceId = await containerId(body.sourceServiceId);
    const destinationId = await containerId(body.destinationServiceId);
    if (sourceId === destinationId) return privateJson({ error: "Elige otro contenedor para transferir el archivo." }, 400);
    const sourcePath = safeContainerPath(typeof body.sourcePath === "string" ? body.sourcePath : null);
    const destinationPath = safeContainerPath(typeof body.destinationPath === "string" ? body.destinationPath : null);
    const name = safeFileName(sourcePath.split("/").filter(Boolean).pop() ?? "");
    const archive = await fetchArchive(sourceId, sourcePath);
    const entries = tarEntries(archive).filter(({ meta }) => meta.type === "file");
    const file = entries.find(({ meta }) => meta.name.replace(/\/+$/, "").split("/").pop() === name) ?? (entries.length === 1 ? entries[0] : undefined);
    if (!file) return privateJson({ error: "Solo se pueden transferir archivos; las carpetas se deben descargar o comprimir primero." }, 400);
    if (file.data.byteLength > MAX_UPLOAD_BYTES) return privateJson({ error: "El archivo supera el límite de transferencia de 32 MB. Comprímelo dentro del contenedor para transferirlo." }, 413);
    await uploadArchive(destinationId, destinationPath, name, tarFile(name, file.data));
    return privateJson({ ok: true, name, transferId: randomUUID() });
  } catch (error) { return privateJson({ error: error instanceof Error ? error.message : "No se pudo transferir el archivo." }, 400); }
}
