import { NextResponse } from "next/server";
import { connectDockerContainer, createDockerVolume, deleteDockerImage, deleteDockerVolume, disconnectDockerContainer, getDockerComposeVersion, getDockerEngineInfo, inspectDockerContainer, isDockerConfigured, listDockerContainers, listDockerImages, listDockerNetworks, listDockerVolumes, pullDockerImage } from "@/lib/docker";
import { startOperationJob } from "@/lib/jobs";
import { authenticatedUser, mutationUser } from "@/lib/control-plane";

export async function getResources(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isDockerConfigured()) return NextResponse.json({ error: "El backend Docker no está configurado" }, { status: 503 });
  const type = new URL(request.url).searchParams.get("type");
  try {
    if (type === "engine") {
      const [info, composeVersion] = await Promise.all([getDockerEngineInfo(), getDockerComposeVersion()]);
      info.ComposeVersion = composeVersion;
      return NextResponse.json({ data: info, type });
    }
    if (type === "images") {
      const [images, containers] = await Promise.all([listDockerImages(), listDockerContainers()]);
      const usedImageIds = new Set(containers.map((container) => container.ImageID).filter((id): id is string => Boolean(id)));
      return NextResponse.json({ data: images.map((image) => ({ ...image, used: usedImageIds.has(image.Id) })), type });
    }
    if (type === "volumes") {
      const [volumes, containers] = await Promise.all([listDockerVolumes(), listDockerContainers()]);
      const mounts = await Promise.all(containers.map(async (container) => container.Mounts ?? (await inspectDockerContainer(container.Id)).Mounts ?? []));
      return NextResponse.json({ data: volumes.map((volume) => ({ ...volume, usedBy: containers.filter((_, index) => mounts[index].some((mount) => mount.Type === "volume" && mount.Name === volume.Name)).map((container) => (container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, "")) })), type });
    }
    if (type === "networks") {
      const [networks, containers] = await Promise.all([listDockerNetworks(), listDockerContainers()]);
      return NextResponse.json({ data: networks, containers: containers.map((container) => ({ id: container.Id, name: (container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, "") })), type });
    }
    return NextResponse.json({ error: "type debe ser engine, images, volumes o networks" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible leer Docker" }, { status: 502 });
  }
}

export async function postResources(request: Request) {
  const user = mutationUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isDockerConfigured()) return NextResponse.json({ error: "El backend Docker no está configurado" }, { status: 503 });
  let body: { action?: "connect" | "disconnect" | "pull" | "create_volume"; networkId?: string; containerId?: string; image?: string; volumeName?: string };
  try {
    body = await request.json() as { action?: "connect" | "disconnect" | "pull" | "create_volume"; networkId?: string; containerId?: string; image?: string; volumeName?: string };
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  if (body.action === "create_volume") {
    if (user.role === "viewer") return NextResponse.json({ error: "Esta cuenta no puede crear volúmenes" }, { status: 403 });
    const name = body.volumeName?.trim() ?? "";
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name)) return NextResponse.json({ error: "Nombre de volumen inválido" }, { status: 400 });
    try {
      if ((await listDockerVolumes()).some((volume) => volume.Name === name)) return NextResponse.json({ error: "Ya existe un volumen con ese nombre" }, { status: 409 });
      const volume = await createDockerVolume(name);
      return NextResponse.json({ ok: true, data: volume }, { status: 201 });
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo crear el volumen" }, { status: 502 }); }
  }
  if (body.action === "pull") {
    const image = body.image?.trim() ?? "";
    if (!image || /\s/.test(image) || image.length > 512) return NextResponse.json({ error: "Indica una imagen Docker válida" }, { status: 400 });
    const job = startOperationJob("image", async (update) => {
      update({ step: "pulling_image", message: "Preparando descarga de imagen", percent: 1 });
      await pullDockerImage(image, (percent, message) => update({ step: "pulling_image", message, percent }));
      return { name: image, port: 0, dataResource: "", dataCopied: false };
    });
    return NextResponse.json({ ok: true, action: "pull", jobId: job.id, image }, { status: 202 });
  }
  if (!body.action || !body.networkId || !body.containerId) return NextResponse.json({ error: "action, networkId y containerId son obligatorios" }, { status: 400 });
  try {
    if (body.action === "connect") await connectDockerContainer(body.networkId, body.containerId);
    else await disconnectDockerContainer(body.networkId, body.containerId);
    return NextResponse.json({ ok: true, action: body.action });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible modificar la red" }, { status: 502 });
  }
}

export async function deleteResources(request: Request) {
  const user = mutationUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isDockerConfigured()) return NextResponse.json({ error: "El backend Docker no está configurado" }, { status: 503 });
  let body: { imageIds?: string[]; volumeName?: string };
  try {
    body = await request.json() as { imageIds?: string[]; volumeName?: string };
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  if (body.volumeName !== undefined) {
    if (user.role === "viewer") return NextResponse.json({ error: "Esta cuenta no puede borrar volúmenes" }, { status: 403 });
    const name = body.volumeName;
    if (typeof name !== "string" || !name || name.length > 255 || /[\x00-\x1f/]/.test(name)) return NextResponse.json({ error: "Nombre de volumen inválido" }, { status: 400 });
    try {
      const [volumes, containers] = await Promise.all([listDockerVolumes(), listDockerContainers()]);
      if (!volumes.some((volume) => volume.Name === name)) return NextResponse.json({ error: "El volumen ya no existe; actualiza la lista" }, { status: 404 });
      const inspections = await Promise.all(containers.map((container) => inspectDockerContainer(container.Id)));
      const usedBy = inspections.flatMap((details, index) => details.Mounts?.some((mount) => mount.Type === "volume" && mount.Name === name) ? [(containers[index].Names?.[0] ?? containers[index].Id.slice(0, 12)).replace(/^\//, "")] : []);
      if (usedBy.length) return NextResponse.json({ error: "No se puede borrar un volumen montado por un contenedor", usedBy }, { status: 409 });
      await deleteDockerVolume(name);
      return NextResponse.json({ ok: true, deletedVolume: name });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible borrar el volumen" }, { status: 502 });
    }
  }
  const imageIds = [...new Set((body.imageIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];
  if (!imageIds.length) return NextResponse.json({ error: "No se seleccionaron imágenes" }, { status: 400 });
  try {
    const [images, containers] = await Promise.all([listDockerImages(), listDockerContainers()]);
    const known = new Set(images.map((image) => image.Id));
    const unknown = imageIds.filter((id) => !known.has(id));
    if (unknown.length) return NextResponse.json({ error: "Una o más imágenes ya no existen; actualiza la lista" }, { status: 409 });
    const used = containers.flatMap((container) => {
      const imageId = container.ImageID ?? "";
      return imageIds.includes(imageId) ? [{ imageId, container: (container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, "") }] : [];
    });
    if (used.length) return NextResponse.json({ error: "No se puede borrar: hay imágenes en uso por contenedores", used }, { status: 409 });
    for (const imageId of imageIds) await deleteDockerImage(imageId);
    return NextResponse.json({ ok: true, deleted: imageIds });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible borrar las imágenes" }, { status: 502 });
  }
}
