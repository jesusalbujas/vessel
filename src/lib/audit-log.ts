import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authenticatedUser, controlPlaneDatabase } from "@/lib/control-plane";

export type AuditEvent = {
  id: string;
  createdAt: string;
  actor: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId: string | null;
  resourceName: string | null;
  outcome: "success" | "failure";
  status: number;
};

function ensureAuditTable() {
  const db = controlPlaneDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS vessel_audit_events (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource TEXT NOT NULL,
    resource_id TEXT,
    resource_name TEXT,
    outcome TEXT NOT NULL,
    status INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS vessel_audit_events_created ON vessel_audit_events(created_at DESC, id);
  CREATE INDEX IF NOT EXISTS vessel_audit_events_actor ON vessel_audit_events(actor, created_at DESC);`);
  return db;
}

function safeText(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return clean ? clean.slice(0, max) : null;
}

function resourceFromPath(path: string) {
  const clean = path.split("?")[0].replace(/^\/api\//, "").replace(/\//g, ".");
  return safeText(clean || "unknown", 100) ?? "unknown";
}

const ignoredActions = new Set([
  "preview", "validate", "check", "test", "test_connection", "list_repositories",
  "list_branches", "list_files", "inspect", "analyze", "refresh", "status",
]);

async function record(request: Request, status: number, resourceLabel?: string) {
  try {
    const user = authenticatedUser(request);
    let body: Record<string, unknown> = {};
    const contentType = request.headers.get("content-type") ?? "";
    const size = Number(request.headers.get("content-length") ?? 0);
    if (contentType.includes("application/json") && (!size || size <= 16 * 1024)) {
      const parsed: unknown = await request.clone().json().catch(() => null);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    }

    const requestedAction = safeText(body.action, 80)?.toLowerCase();
    if (requestedAction && ignoredActions.has(requestedAction)) return;
    const method = request.method.toUpperCase();
    const action = requestedAction ?? ({ POST: "create_or_execute", PATCH: "update", PUT: "replace", DELETE: "delete" }[method] ?? method.toLowerCase());
    const resource = resourceLabel ?? resourceFromPath(new URL(request.url).pathname);
    const resourceId = ["id", "userId", "projectId", "jobId", "serviceId", "sourceId", "serverId", "registryId", "keyId", "containerId", "networkId", "volumeId"]
      .map((key) => safeText(body[key], 100)).find(Boolean) ?? null;
    const resourceName = ["name", "username", "projectName", "jobName", "serviceName", "containerName"]
      .map((key) => safeText(body[key], 120)).find(Boolean) ?? null;
    const actor = user?.username ?? "anonymous";
    const actorRole = user?.role ?? "unauthenticated";
    const db = ensureAuditTable();
    db.prepare(`INSERT INTO vessel_audit_events
      (id, actor, actor_role, action, resource, resource_id, resource_name, outcome, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), actor, actorRole, action, resource, resourceId, resourceName, status >= 400 ? "failure" : "success", status);
    // Bound disk usage while keeping a useful recent history.
    db.exec(`DELETE FROM vessel_audit_events WHERE id IN (
      SELECT id FROM vessel_audit_events ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 10000
    )`);
  } catch (error) {
    // Auditing must not change the result of an administrative operation.
    console.error("Vessel audit event could not be recorded", error instanceof Error ? error.message : "unknown error");
  }
}

export async function withAudit(
  request: Request,
  handler: (request: Request) => Promise<Response | undefined> | Response | undefined,
  resource?: string,
): Promise<Response> {
  const shouldAudit = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  const auditRequest = shouldAudit ? request.clone() : request;
  let response: Response | undefined;
  try {
    response = await handler(request);
  } catch (error) {
    if (shouldAudit) await record(auditRequest, 500, resource);
    throw error;
  }
  if (!response) {
    if (shouldAudit) await record(auditRequest, 500, resource);
    return NextResponse.json({ error: "The operation returned no response" }, { status: 500 });
  }
  if (shouldAudit) await record(auditRequest, response.status, resource);
  return response;
}

export function listAuditEvents(limit = 100, offset = 0): { data: AuditEvent[]; total: number } {
  const db = ensureAuditTable();
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const total = (db.prepare("SELECT COUNT(*) AS count FROM vessel_audit_events").get() as { count: number }).count;
  const data = db.prepare(`SELECT id, created_at AS createdAt, actor, actor_role AS actorRole,
    action, resource, resource_id AS resourceId, resource_name AS resourceName, outcome, status
    FROM vessel_audit_events ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(safeLimit, safeOffset) as AuditEvent[];
  return { data, total };
}
