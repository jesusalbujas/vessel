"use client";

import { useI18n } from "@/lib/i18n";
import type { ContainerRuntimeSettings } from "@/lib/services";

const logDrivers = ["", "json-file", "local", "journald", "syslog", "none"];

export default function RuntimeSettingsEditor({ value, onChange }: { value: ContainerRuntimeSettings; onChange: (value: ContainerRuntimeSettings) => void }) {
  const { language } = useI18n();
  const es = language === "es";
  const update = (patch: Partial<ContainerRuntimeSettings>) => onChange({ ...value, ...patch });
  const updateLogOption = (key: string, next: string) => {
    const logOptions = { ...value.logOptions };
    if (next) logOptions[key] = next;
    else delete logOptions[key];
    update({ logOptions });
  };
  const parseNumber = (raw: string) => raw === "" ? null : Number.isFinite(Number(raw)) ? Number(raw) : null;

  return <div className="runtime-settings-editor">
    <div className="runtime-settings-grid">
      <label className="modal-field runtime-wide"><span>{es ? "Command · un argumento por línea" : "Command · one argument per line"}</span><textarea value={value.command.join("\n")} onChange={(event) => update({ command: event.target.value.split(/\r?\n/).filter((line) => line.length > 0) })} spellCheck={false} rows={3} placeholder={es ? "Deja vacío para usar el comando de la imagen" : "Leave empty to use the image command"} /></label>
      <label className="modal-field runtime-wide"><span>{es ? "Entrypoint · un argumento por línea" : "Entrypoint · one argument per line"}</span><textarea value={value.entrypoint.join("\n")} onChange={(event) => update({ entrypoint: event.target.value.split(/\r?\n/).filter((line) => line.length > 0) })} spellCheck={false} rows={3} placeholder={es ? "Deja vacío para usar el entrypoint de la imagen" : "Leave empty to use the image entrypoint"} /></label>
      <label className="modal-field"><span>{es ? "Directorio de trabajo" : "Working directory"}</span><input value={value.workingDir} onChange={(event) => update({ workingDir: event.target.value })} maxLength={4096} placeholder="/app" /></label>
      <label className="modal-field"><span>{es ? "Usuario del contenedor" : "Container user"}</span><input value={value.user} onChange={(event) => update({ user: event.target.value })} maxLength={4096} placeholder="1000:1000" /></label>
    </div>

    <div className="runtime-toggle-row">
      <label><input type="checkbox" checked={value.tty} onChange={(event) => update({ tty: event.target.checked })} /><span><strong>TTY</strong><small>{es ? "Asigna una terminal al proceso" : "Allocate a terminal to the process"}</small></span></label>
      <label><input type="checkbox" checked={value.openStdin} onChange={(event) => update({ openStdin: event.target.checked })} /><span><strong>{es ? "Mantener STDIN abierto" : "Keep STDIN open"}</strong><small>{es ? "Mantiene abierta la entrada estándar" : "Keep standard input open"}</small></span></label>
    </div>

    <section className="runtime-settings-section">
      <div className="runtime-section-heading"><strong>{es ? "Registro de logs" : "Logging"}</strong><span>{es ? "Se conservarán las opciones no modificadas." : "Unchanged driver options are preserved."}</span></div>
      <div className="runtime-settings-grid">
        <label className="modal-field"><span>{es ? "Driver" : "Driver"}</span><select value={value.logDriver} onChange={(event) => update({ logDriver: event.target.value })}>
          {!logDrivers.includes(value.logDriver) ? <option value={value.logDriver}>{value.logDriver} · {es ? "actual" : "current"}</option> : null}
          {logDrivers.map((driver) => <option key={driver || "default"} value={driver}>{driver || (es ? "Predeterminado del Engine" : "Engine default")}</option>)}
        </select></label>
        <label className="modal-field"><span>max-size</span><input value={value.logOptions["max-size"] ?? ""} onChange={(event) => updateLogOption("max-size", event.target.value)} placeholder="100m" /></label>
        <label className="modal-field"><span>max-file</span><input value={value.logOptions["max-file"] ?? ""} onChange={(event) => updateLogOption("max-file", event.target.value)} inputMode="numeric" placeholder="3" /></label>
      </div>
      <p className="runtime-help">{es ? "Opciones habituales para json-file/local. La disponibilidad depende del Docker Engine y del driver elegido." : "Common options for json-file/local. Availability depends on Docker Engine and the selected driver."}</p>
    </section>

    <section className="runtime-settings-section">
      <div className="runtime-section-heading"><strong>{es ? "Límites de recursos" : "Resource limits"}</strong><span>{es ? "Vacío o 0 = sin límite" : "Blank or 0 = unlimited"}</span></div>
      <div className="runtime-settings-grid">
        <label className="modal-field"><span>{es ? "Memoria máxima (MiB)" : "Memory limit (MiB)"}</span><input type="number" min="0" max="1048576" step="1" value={value.memoryLimitMiB ?? ""} onChange={(event) => update({ memoryLimitMiB: parseNumber(event.target.value) })} placeholder={es ? "Sin límite" : "Unlimited"} /></label>
        <label className="modal-field"><span>{es ? "CPU máximo (núcleos)" : "CPU limit (cores)"}</span><input type="number" min="0" max="1024" step="0.1" value={value.cpuLimit ?? ""} onChange={(event) => update({ cpuLimit: parseNumber(event.target.value) })} placeholder={es ? "Sin límite" : "Unlimited"} /></label>
      </div>
    </section>
  </div>;
}
