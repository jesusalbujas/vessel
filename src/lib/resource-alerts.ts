import { randomUUID } from "node:crypto";
import { readFile, statfs } from "node:fs/promises";
import { controlPlaneDatabase } from "@/lib/control-plane";
import { dockerApiBase } from "@/lib/docker/client";
import { getLocalEngineName } from "@/lib/engine-preferences";
import { listRemoteServers } from "@/lib/remote-servers";

export type ResourceMetric = "cpu" | "memory" | "disk";
export type ResourceAlertRule = { id: string; name: string; engineId: string; metric: ResourceMetric; operator: "above" | "below"; threshold: number; consecutiveSamples: number; notificationIntervalMinutes: number; enabled: boolean; lastValue: number | null; createdAt: string; updatedAt: string };
export type ResourceAlertEvent = { id: string; ruleId: string; ruleName: string; engineId: string; engineName: string; metric: ResourceMetric; operator: "above" | "below"; threshold: number; value: number; state: "active" | "resolved"; triggeredAt: string; lastNotifiedAt: string; resolvedAt: string | null };
type MetricSample = { cpu: number; memory: number; disk: number };
type RuleRow = Omit<ResourceAlertRule, "enabled"> & { enabled: number; consecutiveSamples: number };

function db() {
  const database = controlPlaneDatabase();
  database.exec(`CREATE TABLE IF NOT EXISTS vessel_resource_alert_rules (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, engine_id TEXT NOT NULL, metric TEXT NOT NULL,
    operator TEXT NOT NULL, threshold REAL NOT NULL, consecutive_samples INTEGER NOT NULL DEFAULT 2,
    notification_interval_minutes INTEGER NOT NULL DEFAULT 15,
    enabled INTEGER NOT NULL DEFAULT 1, breach_count INTEGER NOT NULL DEFAULT 0, recovery_count INTEGER NOT NULL DEFAULT 0, last_value REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS vessel_resource_alert_events (
    id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, rule_name TEXT NOT NULL, engine_id TEXT NOT NULL,
    engine_name TEXT NOT NULL, metric TEXT NOT NULL, operator TEXT NOT NULL, threshold REAL NOT NULL,
    value REAL NOT NULL, state TEXT NOT NULL, triggered_at TEXT NOT NULL, last_notified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, resolved_at TEXT
  );
  CREATE INDEX IF NOT EXISTS vessel_resource_alert_events_state ON vessel_resource_alert_events(state, triggered_at DESC);
  CREATE INDEX IF NOT EXISTS vessel_resource_alert_events_rule ON vessel_resource_alert_events(rule_id, triggered_at DESC);`);
  const ruleColumns = database.prepare("PRAGMA table_info(vessel_resource_alert_rules)").all() as Array<{ name: string }>;
  if (!ruleColumns.some((column) => column.name === "notification_interval_minutes")) database.exec("ALTER TABLE vessel_resource_alert_rules ADD COLUMN notification_interval_minutes INTEGER NOT NULL DEFAULT 15");
  if (!ruleColumns.some((column) => column.name === "recovery_count")) database.exec("ALTER TABLE vessel_resource_alert_rules ADD COLUMN recovery_count INTEGER NOT NULL DEFAULT 0");
  const eventColumns = database.prepare("PRAGMA table_info(vessel_resource_alert_events)").all() as Array<{ name: string }>;
  if (!eventColumns.some((column) => column.name === "last_notified_at")) database.exec("ALTER TABLE vessel_resource_alert_events ADD COLUMN last_notified_at TEXT NOT NULL DEFAULT ''");
  database.exec("UPDATE vessel_resource_alert_events SET last_notified_at = triggered_at WHERE last_notified_at IS NULL OR last_notified_at = ''");
  return database;
}

function mapRule(row: RuleRow): ResourceAlertRule { return { ...row, enabled: Boolean(row.enabled) }; }

export function listResourceAlertRules(): ResourceAlertRule[] {
  return db().prepare(`SELECT id, name, engine_id AS engineId, metric, operator, threshold,
    consecutive_samples AS consecutiveSamples, notification_interval_minutes AS notificationIntervalMinutes, enabled, last_value AS lastValue, created_at AS createdAt, updated_at AS updatedAt
    FROM vessel_resource_alert_rules ORDER BY created_at DESC`).all().map((row) => mapRule(row as RuleRow));
}

export function listResourceAlertEvents(limit = 100): ResourceAlertEvent[] {
  // Active events should report the latest sampled value. The event's stored
  // value is the reading at trigger time; the rule row is refreshed on every
  // monitoring pass and is the authoritative current sample while it remains active.
  return db().prepare(`SELECT event.id, event.rule_id AS ruleId, event.rule_name AS ruleName,
    event.engine_id AS engineId, event.engine_name AS engineName, event.metric,
    event.operator, event.threshold,
    CASE WHEN event.state = 'active' THEN COALESCE(rule.last_value, event.value) ELSE event.value END AS value,
    event.state, event.triggered_at AS triggeredAt, event.last_notified_at AS lastNotifiedAt, event.resolved_at AS resolvedAt
    FROM vessel_resource_alert_events AS event
    LEFT JOIN vessel_resource_alert_rules AS rule ON rule.id = event.rule_id
    ORDER BY CASE event.state WHEN 'active' THEN 0 ELSE 1 END, event.triggered_at DESC LIMIT ?`).all(Math.max(1, Math.min(limit, 250))) as ResourceAlertEvent[];
}

export function saveResourceAlertRule(input: { id?: string; name: string; engineId: string; metric: ResourceMetric; operator: "above" | "below"; threshold: number; consecutiveSamples: number; notificationIntervalMinutes?: number }): ResourceAlertRule {
  if (!input.name.trim() || input.name.trim().length > 100) throw new Error("Indica un nombre de alerta de hasta 100 caracteres");
  if (!/^(local|[a-f0-9-]{36})$/i.test(input.engineId)) throw new Error("Selecciona un Engine válido");
  if (!["cpu", "memory", "disk"].includes(input.metric) || !["above", "below"].includes(input.operator)) throw new Error("La métrica o condición no es válida");
  if (!Number.isFinite(input.threshold) || input.threshold < 1 || input.threshold > 100) throw new Error("El umbral debe estar entre 1 y 100 %");
  if (![1, 2, 3, 5].includes(input.consecutiveSamples)) throw new Error("El número de muestras debe ser 1, 2, 3 o 5");
  const notificationIntervalMinutes = input.notificationIntervalMinutes ?? 15;
  if (![0, 1, 5, 10, 15, 30, 60].includes(notificationIntervalMinutes)) throw new Error("El intervalo de aviso debe ser 0, 1, 5, 10, 15, 30 o 60 minutos");
  const database = db();
  const id = input.id && database.prepare("SELECT 1 FROM vessel_resource_alert_rules WHERE id = ?").get(input.id) ? input.id : randomUUID();
  database.prepare(`INSERT INTO vessel_resource_alert_rules (id, name, engine_id, metric, operator, threshold, consecutive_samples, notification_interval_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, engine_id = excluded.engine_id,
    metric = excluded.metric, operator = excluded.operator, threshold = excluded.threshold,
    consecutive_samples = excluded.consecutive_samples, notification_interval_minutes = excluded.notification_interval_minutes,
    breach_count = 0, recovery_count = 0, updated_at = CURRENT_TIMESTAMP`).run(
    id, input.name.trim(), input.engineId, input.metric, input.operator, input.threshold, input.consecutiveSamples, notificationIntervalMinutes,
  );
  return listResourceAlertRules().find((rule) => rule.id === id)!;
}

export function deleteResourceAlertRule(id: string): boolean {
  const database = db();
  database.prepare("DELETE FROM vessel_resource_alert_events WHERE rule_id = ?").run(id);
  return Number(database.prepare("DELETE FROM vessel_resource_alert_rules WHERE id = ?").run(id).changes) > 0;
}

async function localSample(): Promise<MetricSample> {
  const parseCpu = (text: string) => {
    const values = text.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
    return { total: values.reduce((sum, value) => sum + value, 0), idle: (values[3] ?? 0) + (values[4] ?? 0) };
  };
  const first = parseCpu(await readFile("/proc/stat", "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 250));
  const [stat, memory, disk] = await Promise.all([
    readFile("/proc/stat", "utf8"), readFile("/proc/meminfo", "utf8"),
    statfs(process.env.VESSEL_METRICS_PATH ?? "/app/data").catch(() => statfs(process.cwd())),
  ]);
  const second = parseCpu(stat);
  const totalDelta = second.total - first.total;
  const cpu = totalDelta > 0 ? 100 * (1 - (second.idle - first.idle) / totalDelta) : 0;
  const mem = (key: string) => Number(memory.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0) * 1024;
  const totalMemory = mem("MemTotal");
  const usedMemory = Math.max(0, totalMemory - mem("MemAvailable"));
  const totalDisk = Number(disk.blocks) * Number(disk.bsize);
  const usedDisk = (Number(disk.blocks) - Number(disk.bfree)) * Number(disk.bsize);
  return { cpu: Math.max(0, Math.min(100, cpu)), memory: totalMemory ? 100 * usedMemory / totalMemory : 0, disk: totalDisk ? 100 * usedDisk / totalDisk : 0 };
}

async function remoteSample(id: string): Promise<MetricSample> {
  const response = await fetch(`${dockerApiBase()}/engines/metrics/${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error("Remote Engine metrics unavailable");
  const metrics = await response.json() as { cpu?: { percent?: number }; memory?: { used?: number; total?: number }; disk?: { used?: number; total?: number } };
  if (!metrics.cpu || !metrics.memory?.total || !metrics.disk?.total) throw new Error("Incomplete Engine metrics");
  return {
    cpu: Number(metrics.cpu.percent ?? 0),
    memory: 100 * Number(metrics.memory.used ?? 0) / Number(metrics.memory.total),
    disk: 100 * Number(metrics.disk.used ?? 0) / Number(metrics.disk.total),
  };
}

let monitorTimer: NodeJS.Timeout | null = null;
let monitorBusy = false;

async function evaluateAlerts() {
  if (monitorBusy) return;
  monitorBusy = true;
  try {
    const rules = listResourceAlertRules().filter((rule) => rule.enabled);
    if (!rules.length) return;
    const engines = new Map(listRemoteServers().map((server) => [server.id, server.name]));
    engines.set("local", getLocalEngineName());
    const samples = new Map<string, MetricSample>();
    await Promise.all([...new Set(rules.map((rule) => rule.engineId))].map(async (engineId) => {
      try { samples.set(engineId, engineId === "local" ? await localSample() : await remoteSample(engineId)); } catch { /* A disconnected Engine does not count as a threshold breach. */ }
    }));
    const database = db();
    const now = new Date().toISOString();
    const updateRule = database.prepare("UPDATE vessel_resource_alert_rules SET breach_count = ?, recovery_count = ?, last_value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    const activeEvent = database.prepare("SELECT id, last_notified_at AS lastNotifiedAt FROM vessel_resource_alert_events WHERE rule_id = ? AND state = 'active' LIMIT 1");
    const insertEvent = database.prepare(`INSERT INTO vessel_resource_alert_events
      (id, rule_id, rule_name, engine_id, engine_name, metric, operator, threshold, value, state, triggered_at, last_notified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`);
    const resolveEvent = database.prepare("UPDATE vessel_resource_alert_events SET state = 'resolved', value = ?, resolved_at = ? WHERE id = ?");
    const repeatEventNotice = database.prepare("UPDATE vessel_resource_alert_events SET last_notified_at = ? WHERE id = ? AND state = 'active'");
    const currentCounts = database.prepare("SELECT breach_count AS breachCount, recovery_count AS recoveryCount FROM vessel_resource_alert_rules WHERE id = ?");
    for (const rule of rules) {
      const sample = samples.get(rule.engineId);
      if (!sample) continue;
      const value = sample[rule.metric];
      const breached = rule.operator === "above" ? value >= rule.threshold : value <= rule.threshold;
      const counts = currentCounts.get(rule.id) as { breachCount: number; recoveryCount: number } | undefined;
      const active = activeEvent.get(rule.id) as { id: string; lastNotifiedAt: string } | undefined;
      const nextBreachCount = breached ? (counts?.breachCount ?? 0) + 1 : 0;
      const nextRecoveryCount = !breached && active ? (counts?.recoveryCount ?? 0) + 1 : 0;
      updateRule.run(nextBreachCount, nextRecoveryCount, value, rule.id);
      if (breached && nextBreachCount >= rule.consecutiveSamples && !active) {
        insertEvent.run(randomUUID(), rule.id, rule.name, rule.engineId, engines.get(rule.engineId) ?? rule.engineId, rule.metric, rule.operator, rule.threshold, value, now, now);
      } else if (breached && active && rule.notificationIntervalMinutes > 0 && Date.parse(now) - Date.parse(active.lastNotifiedAt) >= rule.notificationIntervalMinutes * 60_000) {
        repeatEventNotice.run(now, active.id);
      }
      if (!breached && active && nextRecoveryCount >= rule.consecutiveSamples) resolveEvent.run(value, now, active.id);
    }
    database.prepare(`DELETE FROM vessel_resource_alert_events WHERE state = 'resolved' AND resolved_at < datetime('now', '-90 days')`).run();
  } catch (error) {
    console.error("Vessel resource alert monitor failed", error);
  } finally { monitorBusy = false; }
}

export function startResourceAlertMonitor() {
  if (monitorTimer) return;
  db();
  const run = () => { void evaluateAlerts(); };
  monitorTimer = setInterval(run, 60_000);
  monitorTimer.unref();
  setTimeout(run, 8_000).unref();
}

export function resourceAlertEngines() {
  return [{ id: "local", name: getLocalEngineName(), host: "local" }, ...listRemoteServers().map(({ id, name, host }) => ({ id, name, host }))];
}
