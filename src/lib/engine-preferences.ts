import { controlPlaneDatabase } from "@/lib/control-plane";

const DEFAULT_LOCAL_ENGINE_NAME = "Engine Local";

export function getLocalEngineName(): string {
  const row = controlPlaneDatabase().prepare("SELECT setting_value AS value FROM vessel_settings WHERE setting_key = 'localEngineName'").get() as { value: string } | undefined;
  return row?.value?.trim() || DEFAULT_LOCAL_ENGINE_NAME;
}

export function updateLocalEngineName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f]/.test(name)) {
    throw new Error("El nombre debe tener entre 1 y 80 caracteres y no incluir caracteres de control");
  }
  controlPlaneDatabase().prepare("INSERT INTO vessel_settings (setting_key, setting_value) VALUES ('localEngineName', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value").run(name);
  return name;
}
