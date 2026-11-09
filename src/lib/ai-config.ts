import { randomUUID } from "node:crypto";
import { controlPlaneDatabase, decryptControlPlaneSecret, encryptControlPlaneSecret } from "@/lib/control-plane";

export type CustomAIProvider = { id: string; name: string; baseUrl: string; createdAt: string };
export type AIConfiguration = { id: string; name: string; provider: string; customProviderId: string | null; baseUrl: string; model: string; enabled: boolean; hasApiKey: boolean; createdAt: string; updatedAt: string };
type StoredConfig = AIConfiguration & { encryptedApiKey: string };

function ensureTables() {
  const db = controlPlaneDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS vessel_ai_custom_providers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, base_url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS vessel_ai_configurations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, provider TEXT NOT NULL, custom_provider_id TEXT,
    base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, model TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

export function listCustomAIProviders(): CustomAIProvider[] {
  ensureTables();
  return controlPlaneDatabase().prepare("SELECT id, name, base_url AS baseUrl, created_at AS createdAt FROM vessel_ai_custom_providers ORDER BY name COLLATE NOCASE").all() as CustomAIProvider[];
}

export function saveCustomAIProvider(input: { id?: string; name: string; baseUrl: string }): CustomAIProvider {
  ensureTables();
  const db = controlPlaneDatabase();
  const id = input.id || randomUUID();
  db.prepare(`INSERT INTO vessel_ai_custom_providers(id, name, base_url) VALUES(?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, base_url=excluded.base_url`).run(id, input.name.trim(), input.baseUrl.trim().replace(/\/$/, ""));
  return listCustomAIProviders().find((provider) => provider.id === id)!;
}

export function deleteCustomAIProvider(id: string): boolean {
  ensureTables();
  const db = controlPlaneDatabase();
  db.prepare("UPDATE vessel_ai_configurations SET custom_provider_id = NULL, provider = 'custom', updated_at = CURRENT_TIMESTAMP WHERE custom_provider_id = ?").run(id);
  return Number(db.prepare("DELETE FROM vessel_ai_custom_providers WHERE id = ?").run(id).changes) > 0;
}

export function listAIConfigurations(): AIConfiguration[] {
  ensureTables();
  return controlPlaneDatabase().prepare(`SELECT id, name, provider, custom_provider_id AS customProviderId, base_url AS baseUrl,
    model, enabled, CASE WHEN api_key_encrypted <> '' THEN 1 ELSE 0 END AS hasApiKey,
    created_at AS createdAt, updated_at AS updatedAt FROM vessel_ai_configurations ORDER BY updated_at DESC`).all().map((row) => {
      const value = row as Omit<AIConfiguration, "enabled" | "hasApiKey"> & { enabled: number; hasApiKey: number };
      return { ...value, enabled: Boolean(value.enabled), hasApiKey: Boolean(value.hasApiKey) };
    });
}

export function aiConfigurationWithKey(id: string): (AIConfiguration & { apiKey: string }) | null {
  ensureTables();
  const row = controlPlaneDatabase().prepare(`SELECT id, name, provider, custom_provider_id AS customProviderId, base_url AS baseUrl,
    api_key_encrypted AS encryptedApiKey, model, enabled, created_at AS createdAt, updated_at AS updatedAt
    FROM vessel_ai_configurations WHERE id = ?`).get(id) as StoredConfig | undefined;
  if (!row) return null;
  const { encryptedApiKey, ...config } = row;
  return { ...config, enabled: Boolean(config.enabled), hasApiKey: Boolean(encryptedApiKey), apiKey: decryptControlPlaneSecret(encryptedApiKey) };
}

export function saveAIConfiguration(input: { id?: string; name: string; provider: string; customProviderId?: string | null; baseUrl: string; apiKey: string; model: string; enabled: boolean }): AIConfiguration {
  ensureTables();
  const db = controlPlaneDatabase();
  const id = input.id || randomUUID();
  const existing = input.id ? db.prepare("SELECT api_key_encrypted FROM vessel_ai_configurations WHERE id = ?").get(input.id) as { api_key_encrypted: string } | undefined : undefined;
  const encryptedKey = input.apiKey ? encryptControlPlaneSecret(input.apiKey) : existing?.api_key_encrypted;
  if (!encryptedKey) throw new Error("An API key is required for a new AI configuration");
  db.prepare(`INSERT INTO vessel_ai_configurations(id, name, provider, custom_provider_id, base_url, api_key_encrypted, model, enabled)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, provider=excluded.provider, custom_provider_id=excluded.custom_provider_id,
    base_url=excluded.base_url, api_key_encrypted=excluded.api_key_encrypted, model=excluded.model, enabled=excluded.enabled, updated_at=CURRENT_TIMESTAMP`).run(
      id, input.name.trim(), input.provider, input.customProviderId ?? null, input.baseUrl.trim().replace(/\/$/, ""), encryptedKey, input.model.trim(), input.enabled ? 1 : 0,
    );
  return listAIConfigurations().find((config) => config.id === id)!;
}

export function deleteAIConfiguration(id: string): boolean {
  ensureTables();
  return Number(controlPlaneDatabase().prepare("DELETE FROM vessel_ai_configurations WHERE id = ?").run(id).changes) > 0;
}
