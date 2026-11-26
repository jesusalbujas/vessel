export type ImageDeletionProgress = {
  phase: "checking" | "deleting" | "completed" | "failed";
  current: number;
  total: number;
  completed: number;
  percent: number;
  imageId?: string;
  error?: string;
  minimized: boolean;
};

type DeleteEvent = Omit<ImageDeletionProgress, "minimized"> & {
  type?: string;
  used?: { container?: string }[];
  deleted?: string[];
};

let snapshot: ImageDeletionProgress | null = null;
let active = false;
let listeners = new Set<() => void>();

function publish(next: ImageDeletionProgress | null) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export function subscribeImageDeletion(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getImageDeletionSnapshot() {
  return snapshot;
}

export function setImageDeletionMinimized(minimized: boolean) {
  if (!snapshot || snapshot.phase === "completed" || snapshot.phase === "failed") return;
  publish({ ...snapshot, minimized });
}

export function dismissImageDeletion() {
  if (snapshot && snapshot.phase !== "completed" && snapshot.phase !== "failed") return;
  publish(null);
}

export async function runImageDeletion(imageIds: string[]) {
  if (!imageIds.length || active) throw new Error("Ya hay un borrado de imágenes en curso.");
  active = true;
  let deletedIds: string[] = [];
  let failure = "";
  publish({ phase: "checking", current: 0, total: imageIds.length, completed: 0, percent: 0, minimized: false });

  const handleEvent = (event: DeleteEvent) => {
    const total = event.total ?? imageIds.length;
    if (event.type === "checking") {
      publish({ phase: "checking", current: 0, total, completed: 0, percent: 0, minimized: snapshot?.minimized ?? false });
    } else if (event.type === "ready") {
      publish({ phase: "deleting", current: 0, total, completed: 0, percent: 0, minimized: snapshot?.minimized ?? false });
    } else if (event.type === "item" || event.type === "progress") {
      publish({ phase: "deleting", current: event.current ?? 0, total, completed: event.completed ?? 0, percent: event.percent ?? 0, imageId: event.imageId, minimized: snapshot?.minimized ?? false });
    } else if (event.type === "done") {
      deletedIds = event.deleted ?? imageIds;
      publish({ phase: "completed", current: total, total, completed: event.completed ?? deletedIds.length, percent: 100, minimized: false });
    } else if (event.type === "error") {
      const used = (event.used ?? []).map((item) => item.container).filter(Boolean).join(", ");
      failure = used ? `${event.error ?? "No fue posible borrar las imágenes"}: ${used}` : event.error ?? "No fue posible borrar las imágenes";
      deletedIds = event.deleted ?? [];
      publish({ phase: "failed", current: event.current ?? event.completed ?? 0, total, completed: event.completed ?? deletedIds.length, percent: event.percent ?? 0, imageId: event.imageId, error: failure, minimized: false });
    }
  };

  try {
    const response = await fetch("/api/resources", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ imageIds }) });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { error?: string; used?: { container?: string }[] };
      const used = (payload.used ?? []).map((item) => item.container).filter(Boolean).join(", ");
      throw new Error(used ? `${payload.error ?? "No fue posible borrar las imágenes"}: ${used}` : payload.error ?? "No fue posible borrar las imágenes");
    }
    if (!response.body) throw new Error("No se recibió el progreso del borrado.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line) as DeleteEvent);
      if (done) break;
    }
    if (buffer.trim()) handleEvent(JSON.parse(buffer) as DeleteEvent);
    if (failure) throw new Error(failure);
    if (snapshot?.phase !== "completed") publish({ phase: "completed", current: imageIds.length, total: imageIds.length, completed: deletedIds.length || imageIds.length, percent: 100, minimized: false });
    return { deletedIds: deletedIds.length ? deletedIds : imageIds, error: "" };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "No fue posible borrar las imágenes";
    if (snapshot?.phase !== "failed") publish({ phase: "failed", current: snapshot?.current ?? 0, total: snapshot?.total ?? imageIds.length, completed: snapshot?.completed ?? deletedIds.length, percent: snapshot?.percent ?? 0, error: message, minimized: false });
    return { deletedIds, error: message };
  } finally {
    active = false;
  }
}
