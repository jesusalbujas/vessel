import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

type LabelRow = { container_id: string; label: string };

const databasePath = process.env.DOCKPILOT_DB_PATH ?? "/app/data/dockpilot.sqlite";
let database: DatabaseSync | null = null;

function getDatabase(): DatabaseSync {
  if (!database) {
    mkdirSync(dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    database.exec(`CREATE TABLE IF NOT EXISTS container_labels (
      container_id TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (container_id, label)
    )`);
  }
  return database;
}

function cleanLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").slice(0, 64);
}

function scopedContainerId(containerId: string, engineId?: string | null): string {
  return engineId ? `remote:${engineId}:${containerId}` : containerId;
}

export function listContainerLabels(engineId?: string | null): Record<string, string[]> {
  const rows = getDatabase().prepare("SELECT container_id, label FROM container_labels ORDER BY label COLLATE NOCASE").all() as unknown as LabelRow[];
  return rows.reduce<Record<string, string[]>>((result, row) => {
    const prefix = engineId ? `remote:${engineId}:` : "remote:";
    if (engineId ? !row.container_id.startsWith(prefix) : row.container_id.startsWith(prefix)) return result;
    const containerId = engineId ? row.container_id.slice(prefix.length) : row.container_id;
    (result[containerId] ??= []).push(row.label);
    return result;
  }, {});
}

export function addContainerLabel(containerId: string, label: string, engineId?: string | null): string {
  const clean = cleanLabel(label);
  if (!containerId || !clean || /[\u0000\r\n]/.test(clean)) throw new Error("La etiqueta no es válida");
  getDatabase().prepare("INSERT OR IGNORE INTO container_labels (container_id, label) VALUES (?, ?)").run(scopedContainerId(containerId, engineId), clean);
  return clean;
}

export function removeContainerLabel(containerId: string, label: string, engineId?: string | null): void {
  getDatabase().prepare("DELETE FROM container_labels WHERE container_id = ? AND label = ?").run(scopedContainerId(containerId, engineId), cleanLabel(label));
}
