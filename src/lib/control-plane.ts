import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeRegistryHost, prepareRegistry, type RegistryInput, type RegistryProvider } from "./registries";

export type PlatformSettings = {
  refreshIntervalSeconds: number;
  sessionLifetimeHours: number;
  passwordMinLength: number;
  passwordRequireStrong: boolean;
  authMode: "internal" | "oauth";
  oauthProvider: "microsoft" | "google" | "github" | "custom";
  oauthUseSso: boolean;
  oauthHideInternalPrompt: boolean;
  oauthAutoProvision: boolean;
  oauthClientId: string;
  oauthClientSecretConfigured: boolean;
  oauthAuthorizationUrl: string;
  oauthTokenUrl: string;
  oauthResourceUrl: string;
  oauthRedirectUrl: string;
  oauthLogoutUrl: string;
  oauthUserIdentifier: string;
  oauthScopes: string;
  oauthAuthStyle: "auto" | "basic" | "post";
};

export const permissionCatalog = [
  { id: "overview.view", area: "overview", action: "view" },
  ...(["containers", "images", "volumes", "networks", "compose", "projects", "deployments", "monitoring", "automation", "registries", "git", "servers"] as const).flatMap((area) => [
    { id: `${area}.view`, area, action: "view" }, { id: `${area}.manage`, area, action: "manage" },
  ]),
  { id: "containers.logs", area: "containers", action: "logs" },
  { id: "containers.exec", area: "containers", action: "exec" },
  { id: "containers.files", area: "containers", action: "files" },
  { id: "ssh_keys.manage", area: "servers", action: "ssh_keys" },
  { id: "settings.manage", area: "settings", action: "manage" },
  { id: "ai.manage", area: "ai", action: "manage" },
  { id: "audit.view", area: "audit", action: "view" },
  { id: "sessions.manage", area: "sessions", action: "manage" },
] as const;
export type PermissionId = typeof permissionCatalog[number]["id"];
export type VesselRole = { id: string; name: string; description: string; permissions: PermissionId[]; system: boolean };
const roleSeeds: VesselRole[] = [
  { id: "administrator", name: "Administrator", description: "Full control-plane access.", permissions: ["*" as PermissionId], system: true },
  { id: "operator", name: "Operator", description: "Manage Docker resources and deployments.", permissions: ["overview.view", "containers.view", "containers.manage", "containers.logs", "containers.exec", "containers.files", "images.view", "images.manage", "volumes.view", "volumes.manage", "networks.view", "networks.manage", "projects.view", "projects.manage", "deployments.view", "deployments.manage", "monitoring.view"], system: true },
  { id: "viewer", name: "Viewer", description: "Read Docker resources and project status.", permissions: ["overview.view", "containers.view", "images.view", "volumes.view", "networks.view", "projects.view", "deployments.view", "monitoring.view"], system: true },
];

export type OAuthConfiguration = Omit<PlatformSettings, "refreshIntervalSeconds" | "sessionLifetimeHours" | "passwordMinLength" | "passwordRequireStrong" | "oauthClientSecretConfigured"> & { oauthClientSecret: string };

const defaultSettings: PlatformSettings = {
  refreshIntervalSeconds: 15,
  sessionLifetimeHours: 8,
  passwordMinLength: 10,
  passwordRequireStrong: false,
  authMode: "internal",
  oauthProvider: "google",
  oauthUseSso: false,
  oauthHideInternalPrompt: false,
  oauthAutoProvision: true,
  oauthClientId: "",
  oauthClientSecretConfigured: false,
  oauthAuthorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  oauthTokenUrl: "https://oauth2.googleapis.com/token",
  oauthResourceUrl: "https://openidconnect.googleapis.com/v1/userinfo",
  oauthRedirectUrl: "",
  oauthLogoutUrl: "",
  oauthUserIdentifier: "sub",
  oauthScopes: "openid email profile",
  oauthAuthStyle: "auto",
};

const databasePath = process.env.DOCKPILOT_DB_PATH ?? "/app/data/dockpilot.sqlite";
let database: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!database) {
    mkdirSync(dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    chmodSync(databasePath, 0o600);
    database.exec(`CREATE TABLE IF NOT EXISTS vessel_users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator', email TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      auth_provider TEXT, auth_subject TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_roles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '', permissions_json TEXT NOT NULL DEFAULT '[]',
      is_system INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      id_token TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_api_tokens (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES vessel_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT, last_used_at TEXT
    );
    CREATE INDEX IF NOT EXISTS vessel_api_tokens_user ON vessel_api_tokens(user_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS vessel_registries (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, base_url TEXT, region TEXT,
      username TEXT NOT NULL, secret TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'generic',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_compose_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, compose_yaml TEXT NOT NULL,
      directory TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_project_services (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES vessel_projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      app_name TEXT NOT NULL DEFAULT '', target_type TEXT, target_ref TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, name)
    );
    CREATE INDEX IF NOT EXISTS vessel_project_services_project ON vessel_project_services(project_id, created_at);
    CREATE TABLE IF NOT EXISTS vessel_project_tags (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_project_tag_links (
      project_id TEXT NOT NULL REFERENCES vessel_projects(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES vessel_project_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, tag_id)
    );
    CREATE TABLE IF NOT EXISTS vessel_project_environment (
      project_id TEXT NOT NULL REFERENCES vessel_projects(id) ON DELETE CASCADE,
      variable_name TEXT NOT NULL, encrypted_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (project_id, variable_name)
    );
    CREATE TABLE IF NOT EXISTS vessel_git_sources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, repository TEXT NOT NULL,
      branch TEXT NOT NULL, compose_path TEXT NOT NULL, access_token TEXT,
      git_provider_id TEXT,
      auto_deploy INTEGER NOT NULL DEFAULT 1, poll_interval_seconds INTEGER NOT NULL DEFAULT 60,
      trigger_type TEXT NOT NULL DEFAULT 'push', last_event_ref TEXT,
      watch_paths TEXT NOT NULL DEFAULT '[]', enable_submodules INTEGER NOT NULL DEFAULT 0,
      last_commit TEXT, last_checked_at TEXT, last_deployed_at TEXT,
      last_status TEXT NOT NULL DEFAULT 'idle', last_error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_git_source_secrets (
      source_id TEXT NOT NULL REFERENCES vessel_git_sources(id) ON DELETE CASCADE,
      secret_name TEXT NOT NULL, encrypted_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_id, secret_name)
    );
    CREATE TABLE IF NOT EXISTS vessel_git_deployments (
      id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_name TEXT NOT NULL,
      repository TEXT NOT NULL, branch TEXT NOT NULL, trigger_kind TEXT NOT NULL,
      commit_sha TEXT, status TEXT NOT NULL, phase TEXT NOT NULL,
      commit_title TEXT,
      events_json TEXT NOT NULL DEFAULT '[]', logs_text TEXT NOT NULL DEFAULT '', error TEXT,
      started_at TEXT NOT NULL, updated_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS vessel_git_deployments_source_started
      ON vessel_git_deployments(source_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS vessel_git_providers (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, name TEXT NOT NULL, base_url TEXT NOT NULL,
      client_id TEXT NOT NULL, client_secret TEXT, app_id TEXT, app_slug TEXT, app_private_key TEXT,
      webhook_secret TEXT,
      installation_id TEXT, access_token TEXT, refresh_token TEXT, token_expires_at TEXT,
      account_name TEXT, share_with_org INTEGER NOT NULL DEFAULT 1,
      connected_at TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(provider, name)
    );
    CREATE TABLE IF NOT EXISTS vessel_git_provider_states (
      state_hash TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES vessel_git_providers(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, verifier TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS vessel_git_provider_states_expiry ON vessel_git_provider_states(expires_at);
    CREATE TABLE IF NOT EXISTS vessel_git_manifest_states (
      state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, browser_origin TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS vessel_git_manifest_states_expiry ON vessel_git_manifest_states(expires_at);
    CREATE TABLE IF NOT EXISTS vessel_git_webhook_deliveries (
      provider_id TEXT NOT NULL REFERENCES vessel_git_providers(id) ON DELETE CASCADE,
      delivery_id TEXT NOT NULL, received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(provider_id, delivery_id)
    );
    CREATE TABLE IF NOT EXISTS vessel_git_source_event_refs (
      source_id TEXT NOT NULL REFERENCES vessel_git_sources(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL, ref_name TEXT NOT NULL, commit_sha TEXT,
      status TEXT NOT NULL DEFAULT 'pending', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(source_id, event_type, ref_name)
    );
    CREATE TABLE IF NOT EXISTS vessel_git_source_event_baselines (
      source_id TEXT NOT NULL REFERENCES vessel_git_sources(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL, initialized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(source_id, event_type)
    );
    CREATE TABLE IF NOT EXISTS vessel_scheduled_tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL DEFAULT '',
      group_name TEXT NOT NULL DEFAULT 'ALL',
      cron_expression TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC',
      script TEXT NOT NULL, encrypted_environment TEXT NOT NULL DEFAULT '',
      environment_names TEXT NOT NULL DEFAULT '[]', timeout_seconds INTEGER NOT NULL DEFAULT 1800,
      enabled INTEGER NOT NULL DEFAULT 1, schedule_enabled INTEGER NOT NULL DEFAULT 1, options_json TEXT NOT NULL DEFAULT '[]', last_scheduled_key TEXT,
      last_run_at TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_job_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '', created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_job_project_keys (
      project_id TEXT NOT NULL REFERENCES vessel_job_projects(id) ON DELETE CASCADE,
      key_name TEXT NOT NULL, encrypted_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(project_id, key_name)
    );
    CREATE TABLE IF NOT EXISTS vessel_job_global_keys (
      key_name TEXT PRIMARY KEY, encrypted_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS vessel_scheduled_tasks_enabled ON vessel_scheduled_tasks(enabled, updated_at);
    CREATE TABLE IF NOT EXISTS vessel_scheduled_task_runs (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, task_name TEXT NOT NULL,
      trigger_kind TEXT NOT NULL, status TEXT NOT NULL, exit_code INTEGER,
      output TEXT NOT NULL DEFAULT '', error TEXT, started_by TEXT,
      started_at TEXT NOT NULL, finished_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS vessel_scheduled_tasks_name_nocase ON vessel_scheduled_tasks(name COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS vessel_scheduled_task_runs_task ON vessel_scheduled_task_runs(task_id, started_at DESC);
    CREATE TABLE IF NOT EXISTS vessel_settings (
      setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_oauth_states (
      state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const saveRole = database.prepare(`INSERT INTO vessel_roles (id, name, description, permissions_json, is_system)
      VALUES (?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
      permissions_json=excluded.permissions_json, is_system=1`);
    for (const role of roleSeeds) saveRole.run(role.id, role.name, role.description, JSON.stringify(role.permissions));
    const userColumns = database.prepare("PRAGMA table_info(vessel_users)").all() as Array<{ name: string }>;
    if (!userColumns.some((column) => column.name === "email")) database.exec("ALTER TABLE vessel_users ADD COLUMN email TEXT");
    if (!userColumns.some((column) => column.name === "auth_provider")) database.exec("ALTER TABLE vessel_users ADD COLUMN auth_provider TEXT");
    if (!userColumns.some((column) => column.name === "auth_subject")) database.exec("ALTER TABLE vessel_users ADD COLUMN auth_subject TEXT");
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS vessel_users_oauth_identity ON vessel_users(auth_provider, auth_subject) WHERE auth_provider IS NOT NULL AND auth_subject IS NOT NULL");
    const sessionColumns = database.prepare("PRAGMA table_info(vessel_sessions)").all() as Array<{ name: string }>;
    if (!sessionColumns.some((column) => column.name === "id_token")) database.exec("ALTER TABLE vessel_sessions ADD COLUMN id_token TEXT");
    if (!sessionColumns.some((column) => column.name === "session_id")) database.exec("ALTER TABLE vessel_sessions ADD COLUMN session_id TEXT");
    if (!sessionColumns.some((column) => column.name === "client_ip")) database.exec("ALTER TABLE vessel_sessions ADD COLUMN client_ip TEXT");
    const manifestStateColumns = database.prepare("PRAGMA table_info(vessel_git_manifest_states)").all() as Array<{ name: string }>;
    if (!manifestStateColumns.some((column) => column.name === "browser_origin")) database.exec("ALTER TABLE vessel_git_manifest_states ADD COLUMN browser_origin TEXT NOT NULL DEFAULT ''");
    if (!sessionColumns.some((column) => column.name === "user_agent")) database.exec("ALTER TABLE vessel_sessions ADD COLUMN user_agent TEXT");
    const legacySessions = database.prepare("SELECT token_hash FROM vessel_sessions WHERE session_id IS NULL").all() as Array<{ token_hash: string }>;
    const backfillSessionId = database.prepare("UPDATE vessel_sessions SET session_id = ? WHERE token_hash = ? AND session_id IS NULL");
    for (const session of legacySessions) backfillSessionId.run(randomUUID(), session.token_hash);
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS vessel_sessions_session_id ON vessel_sessions(session_id)");
    const gitSourceColumns = database.prepare("PRAGMA table_info(vessel_git_sources)").all() as Array<{ name: string }>;
    if (!gitSourceColumns.some((column) => column.name === "git_provider_id")) database.exec("ALTER TABLE vessel_git_sources ADD COLUMN git_provider_id TEXT");
    if (!gitSourceColumns.some((column) => column.name === "watch_paths")) database.exec("ALTER TABLE vessel_git_sources ADD COLUMN watch_paths TEXT NOT NULL DEFAULT '[]'");
    if (!gitSourceColumns.some((column) => column.name === "enable_submodules")) database.exec("ALTER TABLE vessel_git_sources ADD COLUMN enable_submodules INTEGER NOT NULL DEFAULT 0");
    if (!gitSourceColumns.some((column) => column.name === "trigger_type")) database.exec("ALTER TABLE vessel_git_sources ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'push'");
    if (!gitSourceColumns.some((column) => column.name === "last_event_ref")) database.exec("ALTER TABLE vessel_git_sources ADD COLUMN last_event_ref TEXT");
    const gitProviderColumns = database.prepare("PRAGMA table_info(vessel_git_providers)").all() as Array<{ name: string }>;
    if (!gitProviderColumns.some((column) => column.name === "webhook_secret")) database.exec("ALTER TABLE vessel_git_providers ADD COLUMN webhook_secret TEXT");
    const gitDeploymentColumns = database.prepare("PRAGMA table_info(vessel_git_deployments)").all() as Array<{ name: string }>;
    if (!gitDeploymentColumns.some((column) => column.name === "logs_text")) database.exec("ALTER TABLE vessel_git_deployments ADD COLUMN logs_text TEXT NOT NULL DEFAULT ''");
    if (!gitDeploymentColumns.some((column) => column.name === "commit_title")) database.exec("ALTER TABLE vessel_git_deployments ADD COLUMN commit_title TEXT");
    const registryColumns = database.prepare("PRAGMA table_info(vessel_registries)").all() as Array<{ name: string }>;
    if (!registryColumns.some((column) => column.name === "provider")) database.exec("ALTER TABLE vessel_registries ADD COLUMN provider TEXT NOT NULL DEFAULT 'generic'");
    if (!registryColumns.some((column) => column.name === "base_url")) database.exec("ALTER TABLE vessel_registries ADD COLUMN base_url TEXT");
    if (!registryColumns.some((column) => column.name === "region")) database.exec("ALTER TABLE vessel_registries ADD COLUMN region TEXT");
    const projectServiceColumns = database.prepare("PRAGMA table_info(vessel_project_services)").all() as Array<{ name: string }>;
    if (!projectServiceColumns.some((column) => column.name === "app_name")) database.exec("ALTER TABLE vessel_project_services ADD COLUMN app_name TEXT NOT NULL DEFAULT ''");
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS vessel_project_services_app_name ON vessel_project_services(project_id, app_name) WHERE app_name <> ''");
    const scheduledTaskColumns = database.prepare("PRAGMA table_info(vessel_scheduled_tasks)").all() as Array<{ name: string }>;
    if (!scheduledTaskColumns.some((column) => column.name === "project_id")) database.exec("ALTER TABLE vessel_scheduled_tasks ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'");
    if (!scheduledTaskColumns.some((column) => column.name === "group_name")) database.exec("ALTER TABLE vessel_scheduled_tasks ADD COLUMN group_name TEXT NOT NULL DEFAULT 'ALL'");
    if (!scheduledTaskColumns.some((column) => column.name === "schedule_enabled")) database.exec("ALTER TABLE vessel_scheduled_tasks ADD COLUMN schedule_enabled INTEGER NOT NULL DEFAULT 1");
    if (!scheduledTaskColumns.some((column) => column.name === "options_json")) database.exec("ALTER TABLE vessel_scheduled_tasks ADD COLUMN options_json TEXT NOT NULL DEFAULT '[]'");
    database.exec("CREATE INDEX IF NOT EXISTS vessel_scheduled_tasks_project ON vessel_scheduled_tasks(project_id, enabled, name COLLATE NOCASE)");
    const scheduledRunColumns = database.prepare("PRAGMA table_info(vessel_scheduled_task_runs)").all() as Array<{ name: string }>;
    if (!scheduledRunColumns.some((column) => column.name === "started_by")) database.exec("ALTER TABLE vessel_scheduled_task_runs ADD COLUMN started_by TEXT");
    database.prepare("UPDATE vessel_scheduled_tasks SET project_id = 'default' WHERE project_id IS NULL OR project_id = ''").run();
  }
  return database;
}


export function controlPlaneDatabase(): DatabaseSync {
  return db();
}

export function encryptControlPlaneSecret(value: string): string {
  return encrypt(value);
}

export function decryptControlPlaneSecret(value: string): string {
  return decrypt(value);
}

function secretKey(): Buffer {
  const configured = process.env.VESSEL_SECRET_KEY?.trim();
  if (!secretStorageReady() || !configured) throw new Error("VESSEL_SECRET_KEY must be configured before accessing encrypted secrets");
  return createHash("sha256").update(configured).digest();
}

export function secretStorageReady(): boolean {
  const configured = process.env.VESSEL_SECRET_KEY?.trim();
  return Boolean(configured && configured.length >= 32 && ![
    "change-this-vessel-secret-key",
    "replace-this-secret-before-exposing",
    "generate-a-long-random-secret",
  ].includes(configured) && !/^(.)\1+$/.test(configured));
}

function encrypt(value: string): string {
  if (!secretStorageReady()) throw new Error("Configura una clave VESSEL_SECRET_KEY privada de al menos 32 caracteres aleatorios antes de guardar valores cifrados");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decrypt(value: string): string {
  const [iv, tag, payload] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload, "base64url")), decipher.final()]).toString("utf8");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === actual.length && timingSafeEqual(actual, expected);
}

const dummyPasswordSalt = "vessel-invalid-user-timing-padding";
const dummyPasswordHash = `${dummyPasswordSalt}:${scryptSync("not-a-real-vessel-password", dummyPasswordSalt, 64).toString("hex")}`;

export function ensureInitialAdmin(): void {
  const count = (db().prepare("SELECT COUNT(*) AS count FROM vessel_users").get() as { count: number }).count;
  if (count > 0) return;
  // The fixed admin/admin credential is an explicit localhost-only bootstrap
  // convenience. Never enable it on a host-bound listener or by default.
  const localDefaultEnabled = process.env.VESSEL_ALLOW_DEFAULT_ADMIN === "true"
    && (process.env.VESSEL_BIND_ADDRESS ?? "127.0.0.1") === "127.0.0.1";
  const usingLocalDefault = localDefaultEnabled && !process.env.VESSEL_ADMIN_PASSWORD;
  const password = process.env.VESSEL_ADMIN_PASSWORD ?? (usingLocalDefault ? "admin" : undefined);
  if (!password) return;
  const username = process.env.VESSEL_ADMIN_USERNAME ?? "admin";
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) return;
  if (usingLocalDefault) {
    if (username !== "admin") return;
  } else {
    try { validatePassword(password); } catch { return; }
  }
  db().prepare("INSERT INTO vessel_users (id, username, password_hash, role) VALUES (?, ?, ?, 'administrator')").run(randomUUID(), username, hashPassword(password));
}

export function userCount(): number {
  return Number((db().prepare("SELECT COUNT(*) AS count FROM vessel_users").get() as { count: number }).count);
}

export function createInitialAdmin(username: string, password: string) {
  const table = db();
  table.exec("BEGIN IMMEDIATE");
  try {
    if (userCount() > 0) throw new Error("Initial administrator already exists");
    const user = createUser(username, password, "administrator");
    table.exec("COMMIT");
    return user;
  } catch (error) {
    table.exec("ROLLBACK");
    throw error;
  }
}

export function authenticate(username: string, password: string): { id: string; username: string; role: string } | null {
  ensureInitialAdmin();
  const row = db().prepare("SELECT id, username, role, password_hash FROM vessel_users WHERE username = ? AND enabled = 1").get(username) as { id: string; username: string; role: string; password_hash: string } | undefined;
  if (!row) { verifyPassword(password, dummyPasswordHash); return null; }
  return verifyPassword(password, row.password_hash) ? { id: row.id, username: row.username, role: row.role } : null;
}

export function createSession(userId: string, idToken?: string | null, request?: Request): string {
  const token = randomBytes(32).toString("base64url");
  const forwardedIp = request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const remoteIp = forwardedIp || request?.headers.get("x-real-ip")?.trim() || null;
  const clientIp = remoteIp && remoteIp.length <= 64 && /^[0-9a-f:.%]+$/i.test(remoteIp) ? remoteIp : null;
  const userAgent = request?.headers.get("user-agent")?.slice(0, 512) || null;
  db().prepare("INSERT INTO vessel_sessions (token_hash, session_id, user_id, expires_at, id_token, client_ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(createHash("sha256").update(token).digest("hex"), randomUUID(), userId, new Date(Date.now() + sessionLifetimeSeconds() * 1000).toISOString(), idToken ? encrypt(idToken) : null, clientIp, userAgent);
  return token;
}

export function createOAuthState(): { state: string; verifier: string } {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const table = db();
  table.prepare("DELETE FROM vessel_oauth_states WHERE expires_at <= ?").run(new Date().toISOString());
  table.prepare("INSERT INTO vessel_oauth_states (state_hash, verifier, expires_at) VALUES (?, ?, ?)")
    .run(createHash("sha256").update(state).digest("hex"), encrypt(verifier), new Date(Date.now() + 10 * 60 * 1000).toISOString());
  return { state, verifier };
}

export function consumeOAuthState(state: string): string | null {
  if (!state || state.length > 256) return null;
  const hash = createHash("sha256").update(state).digest("hex");
  const row = db().prepare("SELECT verifier, expires_at AS expiresAt FROM vessel_oauth_states WHERE state_hash = ?").get(hash) as { verifier: string; expiresAt: string } | undefined;
  db().prepare("DELETE FROM vessel_oauth_states WHERE state_hash = ?").run(hash);
  if (!row || Date.parse(row.expiresAt) <= Date.now()) return null;
  try { return decrypt(row.verifier); } catch { return null; }
}

export function resolveOAuthUser(input: { provider: string; subject: string; email: string | null; emailVerified: boolean; username: string; autoProvision: boolean }) {
  if (!input.subject || input.subject.length > 512) throw new Error("El proveedor no devolvió un identificador de usuario válido");
  const table = db();
  const byIdentity = table.prepare("SELECT id, username, role, email, enabled FROM vessel_users WHERE auth_provider = ? AND auth_subject = ?").get(input.provider, input.subject) as { id: string; username: string; role: string; email: string | null; enabled: number } | undefined;
  if (byIdentity) {
    if (!byIdentity.enabled) throw new Error("La cuenta de Vessel está deshabilitada");
    return byIdentity;
  }

  const email = input.email ? normalizeEmail(input.email) : null;
  const linkedAccount = email && input.emailVerified ? table.prepare("SELECT id, username, role, email, enabled, auth_provider AS authProvider, auth_subject AS authSubject FROM vessel_users WHERE lower(email) = lower(?) ORDER BY created_at LIMIT 1").get(email) as { id: string; username: string; role: string; email: string | null; enabled: number; authProvider: string | null; authSubject: string | null } | undefined : undefined;
  if (linkedAccount) {
    if (!linkedAccount.enabled) throw new Error("La cuenta de Vessel asociada está deshabilitada");
    if ((linkedAccount.authProvider || linkedAccount.authSubject) && (linkedAccount.authProvider !== input.provider || linkedAccount.authSubject !== input.subject)) throw new Error("El correo ya está asociado a otra identidad externa");
    table.prepare("UPDATE vessel_users SET auth_provider = ?, auth_subject = ? WHERE id = ?").run(input.provider, input.subject, linkedAccount.id);
    return { id: linkedAccount.id, username: linkedAccount.username, role: linkedAccount.role, email: linkedAccount.email, enabled: linkedAccount.enabled };
  }

  if (!input.autoProvision) throw new Error("No existe una cuenta de Vessel asociada a esta identidad. Pide al administrador que cree la cuenta con el mismo correo verificado.");
  const candidate = input.username.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 55);
  let username = candidate.length >= 3 ? candidate : `user_${createHash("sha256").update(input.subject).digest("hex").slice(0, 10)}`;
  if (table.prepare("SELECT 1 FROM vessel_users WHERE username = ?").get(username)) username = `${username.slice(0, 49)}_${randomBytes(4).toString("hex")}`;
  const id = randomUUID();
  table.prepare("INSERT INTO vessel_users (id, username, password_hash, role, email, auth_provider, auth_subject) VALUES (?, ?, '', 'operator', ?, ?, ?)").run(id, username, email, input.provider, input.subject);
  return { id, username, role: "operator", email, enabled: 1 };
}

export function getPlatformSettings(): PlatformSettings {
  const rows = db().prepare("SELECT setting_key AS key, setting_value AS value FROM vessel_settings").all() as Array<{ key: string; value: string }>;
  const saved = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  const refresh = Number(saved.refreshIntervalSeconds);
  const lifetime = Number(saved.sessionLifetimeHours);
  const minLength = Number(saved.passwordMinLength);
  return {
    refreshIntervalSeconds: [5, 10, 15, 30, 60].includes(refresh) ? refresh : defaultSettings.refreshIntervalSeconds,
    sessionLifetimeHours: [1, 2, 4, 8, 12, 24].includes(lifetime) ? lifetime : defaultSettings.sessionLifetimeHours,
    passwordMinLength: Number.isInteger(minLength) && minLength >= 8 && minLength <= 64 ? minLength : defaultSettings.passwordMinLength,
    passwordRequireStrong: saved.passwordRequireStrong === "true",
    authMode: saved.authMode === "oauth" ? "oauth" : "internal",
    oauthProvider: ["microsoft", "google", "github", "custom"].includes(saved.oauthProvider) ? saved.oauthProvider as PlatformSettings["oauthProvider"] : defaultSettings.oauthProvider,
    oauthUseSso: saved.oauthUseSso === "true",
    oauthHideInternalPrompt: saved.oauthHideInternalPrompt === "true",
    oauthAutoProvision: saved.oauthAutoProvision !== "false",
    oauthClientId: saved.oauthClientId ?? defaultSettings.oauthClientId,
    oauthClientSecretConfigured: Boolean(saved.oauthClientSecret),
    oauthAuthorizationUrl: saved.oauthAuthorizationUrl ?? defaultSettings.oauthAuthorizationUrl,
    oauthTokenUrl: saved.oauthTokenUrl ?? defaultSettings.oauthTokenUrl,
    oauthResourceUrl: saved.oauthResourceUrl ?? defaultSettings.oauthResourceUrl,
    oauthRedirectUrl: saved.oauthRedirectUrl ?? defaultSettings.oauthRedirectUrl,
    oauthLogoutUrl: saved.oauthLogoutUrl ?? defaultSettings.oauthLogoutUrl,
    oauthUserIdentifier: saved.oauthUserIdentifier ?? defaultSettings.oauthUserIdentifier,
    oauthScopes: saved.oauthScopes ?? defaultSettings.oauthScopes,
    oauthAuthStyle: ["auto", "basic", "post"].includes(saved.oauthAuthStyle) ? saved.oauthAuthStyle as PlatformSettings["oauthAuthStyle"] : defaultSettings.oauthAuthStyle,
  };
}

export function getOAuthConfiguration(): OAuthConfiguration {
  const settings = getPlatformSettings();
  const encryptedSecret = (db().prepare("SELECT setting_value AS value FROM vessel_settings WHERE setting_key = 'oauthClientSecret'").get() as { value: string } | undefined)?.value;
  return {
    authMode: settings.authMode,
    oauthProvider: settings.oauthProvider,
    oauthUseSso: settings.oauthUseSso,
    oauthHideInternalPrompt: settings.oauthHideInternalPrompt,
    oauthAutoProvision: settings.oauthAutoProvision,
    oauthClientId: settings.oauthClientId,
    oauthAuthorizationUrl: settings.oauthAuthorizationUrl,
    oauthTokenUrl: settings.oauthTokenUrl,
    oauthResourceUrl: settings.oauthResourceUrl,
    oauthRedirectUrl: settings.oauthRedirectUrl,
    oauthLogoutUrl: settings.oauthLogoutUrl,
    oauthUserIdentifier: settings.oauthUserIdentifier,
    oauthScopes: settings.oauthScopes,
    oauthAuthStyle: settings.oauthAuthStyle,
    oauthClientSecret: encryptedSecret ? decrypt(encryptedSecret) : "",
  };
}

function validateOAuthUrl(value: string, label: string, required = false, callback = false): void {
  if (!value && !required) return;
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${label} debe ser una URL válida`); }
  const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (!(["https:", "http:"].includes(parsed.protocol)) || (parsed.protocol !== "https:" && !localHost)) throw new Error(`${label} debe usar HTTPS (HTTP solo se permite en localhost)`);
  if (parsed.username || parsed.password || parsed.hash) throw new Error(`${label} no puede contener credenciales ni fragmentos`);
  if (callback && (parsed.pathname !== "/api/auth/oauth/callback" || parsed.search)) throw new Error("La URL de retorno debe terminar exactamente en /api/auth/oauth/callback y no incluir parámetros");
}

export type PlatformSettingsUpdate = Partial<PlatformSettings> & { oauthClientSecret?: string };

export function updatePlatformSettings(input: PlatformSettingsUpdate): PlatformSettings {
  const allowed = new Set<string>([
    "refreshIntervalSeconds", "sessionLifetimeHours", "passwordMinLength", "passwordRequireStrong",
    "authMode", "oauthProvider", "oauthUseSso", "oauthHideInternalPrompt", "oauthAutoProvision",
    "oauthClientId", "oauthAuthorizationUrl", "oauthTokenUrl", "oauthResourceUrl", "oauthRedirectUrl",
    "oauthLogoutUrl", "oauthUserIdentifier", "oauthScopes", "oauthAuthStyle", "oauthClientSecret",
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) throw new Error("La solicitud incluye una opción desconocida");
  const current = getPlatformSettings();
  const { oauthClientSecret, ...publicInput } = input;
  const next = { ...current, ...publicInput };
  if (![5, 10, 15, 30, 60].includes(next.refreshIntervalSeconds)) throw new Error("El intervalo debe ser 5, 10, 15, 30 o 60 segundos");
  if (![1, 2, 4, 8, 12, 24].includes(next.sessionLifetimeHours)) throw new Error("La sesión debe durar 1, 2, 4, 8, 12 o 24 horas");
  if (!Number.isInteger(next.passwordMinLength) || next.passwordMinLength < 8 || next.passwordMinLength > 64) throw new Error("La longitud mínima debe estar entre 8 y 64 caracteres");
  if (typeof next.passwordRequireStrong !== "boolean") throw new Error("La opción de contraseña segura debe ser verdadera o falsa");
  if (!["internal", "oauth"].includes(next.authMode)) throw new Error("El método de autenticación no es válido");
  if (!["microsoft", "google", "github", "custom"].includes(next.oauthProvider)) throw new Error("El proveedor OAuth no es válido");
  if (!["auto", "basic", "post"].includes(next.oauthAuthStyle)) throw new Error("El estilo de autenticación OAuth no es válido");
  if ([next.oauthUseSso, next.oauthHideInternalPrompt, next.oauthAutoProvision].some((value) => typeof value !== "boolean")) throw new Error("Las opciones OAuth deben ser verdaderas o falsas");
  if (typeof next.oauthClientId !== "string" || next.oauthClientId.length > 1024) throw new Error("El Client ID no es válido");
  if (typeof next.oauthUserIdentifier !== "string" || !/^[A-Za-z0-9_.-]{1,128}$/.test(next.oauthUserIdentifier)) throw new Error("El identificador de usuario debe ser una ruta de claim válida, por ejemplo sub o user.id");
  if (typeof next.oauthScopes !== "string" || next.oauthScopes.length > 1000 || /[\r\n]/.test(next.oauthScopes)) throw new Error("Los scopes OAuth no son válidos");
  if ([next.oauthAuthorizationUrl, next.oauthTokenUrl, next.oauthResourceUrl, next.oauthRedirectUrl, next.oauthLogoutUrl].some((value) => typeof value !== "string" || value.length > 2048)) throw new Error("Una URL OAuth supera el tamaño permitido");
  if (oauthClientSecret !== undefined && (typeof oauthClientSecret !== "string" || oauthClientSecret.length > 4096)) throw new Error("El Client Secret no es válido");
  validateOAuthUrl(next.oauthAuthorizationUrl, "Authorization URL");
  validateOAuthUrl(next.oauthTokenUrl, "Access token URL");
  validateOAuthUrl(next.oauthResourceUrl, "Resource URL");
  validateOAuthUrl(next.oauthRedirectUrl, "Redirect URL", false, true);
  validateOAuthUrl(next.oauthLogoutUrl, "Logout URL");
  const existingSecret = current.oauthClientSecretConfigured;
  const hasSecret = Boolean(oauthClientSecret) || existingSecret;
  if (next.authMode === "oauth") {
    if (process.env.NODE_ENV === "production" && (!process.env.VESSEL_SECRET_KEY || process.env.VESSEL_SECRET_KEY === "change-this-vessel-secret-key")) throw new Error("Configura VESSEL_SECRET_KEY antes de habilitar OAuth en producción");
    if (!next.oauthUseSso) throw new Error("Activa Use SSO para habilitar el acceso OAuth");
    if (!next.oauthClientId.trim() || !hasSecret || !next.oauthScopes.trim()) throw new Error("Completa Client ID, Client Secret y Scopes antes de activar OAuth");
    validateOAuthUrl(next.oauthAuthorizationUrl, "Authorization URL", true);
    validateOAuthUrl(next.oauthTokenUrl, "Access token URL", true);
    validateOAuthUrl(next.oauthResourceUrl, "Resource URL", true);
    validateOAuthUrl(next.oauthRedirectUrl, "Redirect URL", true, true);
  }
  const statement = db().prepare("INSERT INTO vessel_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP");
  for (const [key, value] of Object.entries(next)) if (key !== "oauthClientSecretConfigured") statement.run(key, String(value));
  if (oauthClientSecret) statement.run("oauthClientSecret", encrypt(oauthClientSecret));
  next.oauthClientSecretConfigured = hasSecret;
  return next;
}

export function sessionLifetimeSeconds(): number {
  return getPlatformSettings().sessionLifetimeHours * 60 * 60;
}

export function passwordPolicy(): Pick<PlatformSettings, "passwordMinLength" | "passwordRequireStrong"> {
  const { passwordMinLength, passwordRequireStrong } = getPlatformSettings();
  return { passwordMinLength, passwordRequireStrong };
}

function validatePassword(password: string): void {
  const policy = passwordPolicy();
  if (password.length < policy.passwordMinLength) throw new Error(`La contraseña debe tener al menos ${policy.passwordMinLength} caracteres`);
  if (password.length > 1024) throw new Error("La contraseña supera el tamaño permitido");
  if (policy.passwordRequireStrong && (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password))) {
    throw new Error("La contraseña segura requiere mayúscula, minúscula, número y símbolo");
  }
}

export function revokeSession(token: string): void {
  db().prepare("DELETE FROM vessel_sessions WHERE token_hash = ?").run(createHash("sha256").update(token).digest("hex"));
}

export function listSessions(currentToken: string | null) {
  const currentHash = currentToken ? createHash("sha256").update(currentToken).digest("hex") : "";
  return db().prepare(`SELECT s.session_id AS id, s.user_id AS userId, u.username, u.email,
    s.client_ip AS clientIp, s.user_agent AS userAgent, s.created_at AS createdAt,
    s.expires_at AS expiresAt,
    CASE WHEN julianday(s.expires_at) > julianday('now') THEN 'active' ELSE 'expired' END AS status,
    CASE WHEN s.token_hash = ? THEN 1 ELSE 0 END AS isCurrent
    FROM vessel_sessions s JOIN vessel_users u ON u.id = s.user_id
    ORDER BY s.created_at DESC LIMIT 500`).all(currentHash) as Array<{
      id: string; userId: string; username: string; email: string | null; clientIp: string | null;
      userAgent: string | null; createdAt: string; expiresAt: string; status: "active" | "expired"; isCurrent: number;
    }>;
}

export function revokeManagedSession(id: string, currentToken: string | null): { isCurrent: boolean } | null {
  const row = db().prepare("SELECT token_hash FROM vessel_sessions WHERE session_id = ?").get(id) as { token_hash: string } | undefined;
  if (!row) return null;
  const isCurrent = Boolean(currentToken && row.token_hash === createHash("sha256").update(currentToken).digest("hex"));
  db().prepare("DELETE FROM vessel_sessions WHERE session_id = ?").run(id);
  return { isCurrent };
}

export function endSession(token: string): string | null {
  const hash = createHash("sha256").update(token).digest("hex");
  const row = db().prepare("SELECT id_token AS idToken FROM vessel_sessions WHERE token_hash = ?").get(hash) as { idToken: string | null } | undefined;
  db().prepare("DELETE FROM vessel_sessions WHERE token_hash = ?").run(hash);
  if (!row?.idToken) return null;
  try { return decrypt(row.idToken); } catch { return null; }
}

function roleRecord(roleId: string): VesselRole {
  const row = db().prepare("SELECT id, name, description, permissions_json AS permissionsJson, is_system AS system FROM vessel_roles WHERE id = ?").get(roleId) as { id: string; name: string; description: string; permissionsJson: string; system: number } | undefined;
  if (!row) return roleSeeds.find((role) => role.id === "viewer")!;
  let permissions: string[] = [];
  try { permissions = JSON.parse(row.permissionsJson) as string[]; } catch { permissions = []; }
  return { id: row.id, name: row.name, description: row.description, permissions: permissions as PermissionId[], system: Boolean(row.system) };
}

export function listRoles(): VesselRole[] {
  const rows = db().prepare("SELECT id, name, description, permissions_json AS permissionsJson, is_system AS system FROM vessel_roles ORDER BY is_system DESC, name COLLATE NOCASE").all() as Array<{ id: string; name: string; description: string; permissionsJson: string; system: number }>;
  return rows.map((row) => {
    let permissions: string[] = [];
    try { permissions = JSON.parse(row.permissionsJson) as string[]; } catch { /* invalid persisted data grants no permissions */ }
    return { id: row.id, name: row.name, description: row.description, permissions: permissions as PermissionId[], system: Boolean(row.system) };
  });
}

export function saveCustomRole(input: { id?: string; name: string; description?: string; permissions: string[] }): VesselRole {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 48 || /[\u0000-\u001f]/.test(name)) throw new Error("Role name must contain 2–48 printable characters.");
  const description = (input.description ?? "").trim();
  if (description.length > 240) throw new Error("Role description must be 240 characters or fewer.");
  const allowed = new Set<string>(permissionCatalog.map((permission) => permission.id));
  const permissions = [...new Set(input.permissions)];
  if (permissions.length > permissionCatalog.length || permissions.some((permission) => !allowed.has(permission))) throw new Error("Choose valid permissions.");
  const id = input.id ?? randomUUID();
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid custom role id.");
  const database = db();
  const existing = database.prepare("SELECT is_system AS system FROM vessel_roles WHERE id = ?").get(id) as { system: number } | undefined;
  if (existing?.system) throw new Error("Built-in roles cannot be changed.");
  const duplicate = database.prepare("SELECT id FROM vessel_roles WHERE name = ? COLLATE NOCASE AND id <> ?").get(name, id);
  if (duplicate) throw new Error("A role with this name already exists.");
  database.prepare(`INSERT INTO vessel_roles (id, name, description, permissions_json, is_system)
    VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description,
    permissions_json=excluded.permissions_json, updated_at=CURRENT_TIMESTAMP WHERE vessel_roles.is_system=0`)
    .run(id, name, description, JSON.stringify(permissions));
  return listRoles().find((role) => role.id === id)!;
}

export function deleteCustomRole(id: string): void {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid custom role id.");
  const database = db();
  const role = database.prepare("SELECT is_system AS system FROM vessel_roles WHERE id = ?").get(id) as { system: number } | undefined;
  if (!role) throw new Error("Role not found.");
  if (role.system) throw new Error("Built-in roles cannot be deleted.");
  const assigned = Number((database.prepare("SELECT COUNT(*) AS count FROM vessel_users WHERE role = ?").get(id) as { count: number }).count);
  if (assigned) throw new Error("Reassign users before deleting this role.");
  database.prepare("DELETE FROM vessel_roles WHERE id = ?").run(id);
}

export function userHasPermission(user: { role: string } | null | undefined, permission: string): boolean {
  if (!user) return false;
  const role = roleRecord(user.role);
  if (role.permissions.includes("*" as PermissionId) || role.permissions.includes(permission as PermissionId)) return true;
  return permission.endsWith(".view") && role.permissions.includes(`${permission.slice(0, -5)}.manage` as PermissionId);
}

export function currentUser(token: string | null): { id: string; username: string; role: string; roleName: string; permissions: PermissionId[]; email: string | null; avatarUrl: string | null } | null {
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let row = db().prepare("SELECT u.id, u.username, u.role, u.email FROM vessel_sessions s JOIN vessel_users u ON u.id = s.user_id WHERE s.token_hash = ? AND julianday(s.expires_at) > julianday('now') AND u.enabled = 1").get(tokenHash) as { id: string; username: string; role: string; email: string | null } | undefined;
  if (!row) {
    const apiToken = db().prepare(`SELECT u.id, u.username, u.role, u.email, t.id AS tokenId FROM vessel_api_tokens t
      JOIN vessel_users u ON u.id = t.user_id WHERE t.token_hash = ? AND u.enabled = 1
      AND (t.expires_at IS NULL OR julianday(t.expires_at) > julianday('now'))`).get(tokenHash) as ({ id: string; username: string; role: string; email: string | null; tokenId: string } | undefined);
    if (!apiToken) return null;
    db().prepare("UPDATE vessel_api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(apiToken.tokenId);
    row = apiToken;
  }
  const avatarHash = row.email ? createHash("sha256").update(row.email.trim().toLowerCase()).digest("hex") : null;
  const assignedRole = roleRecord(row.role);
  return { ...row, roleName: assignedRole.name, permissions: assignedRole.permissions, avatarUrl: avatarHash ? `https://gravatar.com/avatar/${avatarHash}?s=128&d=identicon` : null };
}

export function mutationUser(request: Request): { id: string; username: string; role: string } | null {
  ensureInitialAdmin();
  return currentUser(requestTokenFromRequest(request));
}

export function authenticatedUser(request: Request): { id: string; username: string; role: string } | null {
  ensureInitialAdmin();
  return currentUser(requestTokenFromRequest(request));
}

export function requestTokenFromRequest(request: Request): string | null {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (bearer) return bearer;
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-token="));
  return cookie ? decodeURIComponent(cookie.slice("vessel-token=".length)) : null;
}

export type UserApiToken = { id: string; name: string; createdAt: string; expiresAt: string | null; lastUsedAt: string | null };

export function listUserApiTokens(userId: string): UserApiToken[] {
  return db().prepare(`SELECT id, name, created_at AS createdAt, expires_at AS expiresAt, last_used_at AS lastUsedAt
    FROM vessel_api_tokens WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as UserApiToken[];
}

export function createUserApiToken(userId: string, name: string, expiresInDays: number | null) {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 80 || /[\u0000-\u001f]/.test(normalizedName)) throw new Error("Token name must contain 1–80 printable characters.");
  if (expiresInDays !== null && ![30, 90, 365].includes(expiresInDays)) throw new Error("Choose a valid token expiration.");
  const id = randomUUID();
  const secret = `vsl_pat_${randomBytes(32).toString("base64url")}`;
  const expiresAt = expiresInDays === null ? null : new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
  db().prepare("INSERT INTO vessel_api_tokens (id, user_id, name, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, userId, normalizedName, createHash("sha256").update(secret).digest("hex"), expiresAt);
  return { token: secret, record: listUserApiTokens(userId).find((item) => item.id === id)! };
}

export function revokeUserApiToken(userId: string, id: string): boolean {
  return Number(db().prepare("DELETE FROM vessel_api_tokens WHERE id = ? AND user_id = ?").run(id, userId).changes) > 0;
}

export function listUsers() {
  return (db().prepare("SELECT id, username, email, role, enabled, created_at AS createdAt FROM vessel_users ORDER BY username").all() as Array<{ id: string; username: string; email: string | null; role: string; enabled: number; createdAt: string }>).map((user) => {
    const hash = user.email ? createHash("sha256").update(user.email.trim().toLowerCase()).digest("hex") : null;
    const assignedRole = roleRecord(user.role);
    return { ...user, roleName: assignedRole.name, avatarUrl: hash ? `https://gravatar.com/avatar/${hash}?s=128&d=identicon` : null };
  });
}

function normalizeEmail(email: string | undefined): string | null {
  const value = email?.trim().toLowerCase() ?? "";
  if (value && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || value.length > 254)) throw new Error("Email address is not valid");
  return value || null;
}

export function createUser(username: string, password: string, role: string, email?: string) {
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) throw new Error("El usuario debe tener 3-64 caracteres: letras, números, punto, guion o guion bajo");
  validatePassword(password);
  const id = randomUUID();
  const normalizedEmail = normalizeEmail(email);
  if (!db().prepare("SELECT 1 FROM vessel_roles WHERE id = ?").get(role)) throw new Error("Choose a valid user role.");
  db().prepare("INSERT INTO vessel_users (id, username, password_hash, role, email) VALUES (?, ?, ?, ?, ?)").run(id, username, hashPassword(password), role, normalizedEmail);
  const hash = normalizedEmail ? createHash("sha256").update(normalizedEmail).digest("hex") : null;
  return { id, username, role, email: normalizedEmail, avatarUrl: hash ? `https://gravatar.com/avatar/${hash}?s=128&d=identicon` : null };
}

export function updateUserEmail(userId: string, email: string) {
  const normalizedEmail = normalizeEmail(email);
  db().prepare("UPDATE vessel_users SET email = ? WHERE id = ?").run(normalizedEmail, userId);
  return normalizedEmail;
}

export function updateManagedUser(input: { userId: string; actorId: string; username: string; email?: string; role: string; enabled: boolean; password?: string }) {
  const username = input.username.trim();
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) throw new Error("Username must be 3–64 letters, numbers, dots, dashes, or underscores.");
  const role = input.role;
  if (!db().prepare("SELECT 1 FROM vessel_roles WHERE id = ?").get(role)) throw new Error("Choose a valid user role.");
  const normalizedEmail = normalizeEmail(input.email);
  const password = input.password?.trim() ?? "";
  if (password) validatePassword(password);

  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare("SELECT id, role, enabled FROM vessel_users WHERE id = ?").get(input.userId) as { id: string; role: string; enabled: number } | undefined;
    if (!existing) throw new Error("User not found.");
    if (existing.id === input.actorId && (role !== "administrator" || !input.enabled)) throw new Error("You cannot disable or demote your own administrator account.");
    const removesActiveAdmin = existing.enabled === 1 && existing.role === "administrator" && (role !== "administrator" || !input.enabled);
    if (removesActiveAdmin) {
      const count = Number((database.prepare("SELECT COUNT(*) AS count FROM vessel_users WHERE role = 'administrator' AND enabled = 1").get() as { count: number }).count);
      if (count <= 1) throw new Error("At least one active administrator is required.");
    }
    if (password) {
      database.prepare("UPDATE vessel_users SET username = ?, email = ?, role = ?, enabled = ?, password_hash = ? WHERE id = ?")
        .run(username, normalizedEmail, role, input.enabled ? 1 : 0, hashPassword(password), input.userId);
      database.prepare("DELETE FROM vessel_sessions WHERE user_id = ?").run(input.userId);
      database.prepare("DELETE FROM vessel_api_tokens WHERE user_id = ?").run(input.userId);
    } else {
      database.prepare("UPDATE vessel_users SET username = ?, email = ?, role = ?, enabled = ? WHERE id = ?")
        .run(username, normalizedEmail, role, input.enabled ? 1 : 0, input.userId);
      if (!input.enabled && existing.enabled === 1) {
        database.prepare("DELETE FROM vessel_sessions WHERE user_id = ?").run(input.userId);
        database.prepare("DELETE FROM vessel_api_tokens WHERE user_id = ?").run(input.userId);
      }
    }
    database.exec("COMMIT");
    return listUsers().find((user) => user.id === input.userId) ?? null;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function deleteManagedUser(userId: string, actorId: string) {
  const database = db();
  database.exec("BEGIN IMMEDIATE");
  try {
    const existing = database.prepare("SELECT id, role, enabled FROM vessel_users WHERE id = ?").get(userId) as { id: string; role: string; enabled: number } | undefined;
    if (!existing) throw new Error("User not found.");
    if (existing.id === actorId) throw new Error("You cannot delete your own account.");
    if (existing.role === "administrator" && existing.enabled === 1) {
      const count = Number((database.prepare("SELECT COUNT(*) AS count FROM vessel_users WHERE role = 'administrator' AND enabled = 1").get() as { count: number }).count);
      if (count <= 1) throw new Error("At least one active administrator is required.");
    }
    database.prepare("DELETE FROM vessel_sessions WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM vessel_api_tokens WHERE user_id = ?").run(userId);
    database.prepare("DELETE FROM vessel_users WHERE id = ?").run(userId);
    database.exec("COMMIT");
    return true;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function listRegistries() {
  return (db().prepare("SELECT id, name, url, base_url AS baseUrl, region, username, provider, created_at AS createdAt FROM vessel_registries ORDER BY name").all() as Array<{ provider: string; username: string } & Record<string, unknown>>)
    .map((registry) => registry.provider === "ecr" ? { ...registry, username: "AWS IAM" } : registry);
}
export function registryCredentialsForImage(image: string): { provider: RegistryProvider; url: string; baseUrl: string | null; region: string | null; username: string; password: string } | null {
  const firstPathPart = image.trim().split("/")[0];
  const imageHost = normalizeRegistryHost(firstPathPart.includes(".") || firstPathPart.includes(":") || firstPathPart === "localhost" ? firstPathPart : "docker.io");
  const imagePath = image.trim().split("/").slice(firstPathPart.includes(".") || firstPathPart.includes(":") || firstPathPart === "localhost" ? 1 : 0).join("/");
  const rows = db().prepare("SELECT url, base_url AS baseUrl, region, username, secret, provider FROM vessel_registries ORDER BY length(url) DESC").all() as Array<{ url: string; baseUrl: string | null; region: string | null; username: string; secret: string; provider: string }>;
  const row = rows.find((candidate) => {
    try {
      const registryUrl = new URL(candidate.baseUrl || candidate.url);
      if (normalizeRegistryHost(registryUrl.host) !== imageHost) return false;
      const pathPrefix = candidate.provider === "proget" ? new URL(candidate.url).pathname.replace(/^\/+|\/+$/g, "") : "";
      return !pathPrefix || imagePath === pathPrefix || imagePath.startsWith(`${pathPrefix}/`);
    } catch { return false; }
  });
  return row ? { provider: row.provider as RegistryProvider, url: row.url, baseUrl: row.baseUrl, region: row.region, username: row.username, password: decrypt(row.secret) } : null;
}
export function registryCredentialsById(id: string): { id: string; provider: RegistryProvider; name: string; url: string; baseUrl: string | null; region: string | null; username: string; password: string } | null {
  const row = db().prepare("SELECT id, provider, name, url, base_url AS baseUrl, region, username, secret FROM vessel_registries WHERE id = ?").get(id) as { id: string; provider: RegistryProvider; name: string; url: string; baseUrl: string | null; region: string | null; username: string; secret: string } | undefined;
  return row ? { id: row.id, provider: row.provider, name: row.name, url: row.url, baseUrl: row.baseUrl, region: row.region, username: row.username, password: decrypt(row.secret) } : null;
}
export function createRegistry(input: RegistryInput) {
  const { provider, name, url, baseUrl, region, username, password } = prepareRegistry(input);
  const id = randomUUID();
  db().prepare("INSERT INTO vessel_registries (id, name, url, base_url, region, username, secret, provider) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, name, url, baseUrl, region, username, encrypt(password), provider);
  return { id, name, url, baseUrl, region, username: provider === "ecr" ? "AWS IAM" : username, provider };
}
export function deleteRegistry(id: string) { db().prepare("DELETE FROM vessel_registries WHERE id = ?").run(id); }

export type GitProviderKind = "github" | "gitlab" | "bitbucket" | "gitea";
export type GitProviderRecord = {
  id: string; provider: GitProviderKind; name: string; baseUrl: string; accountName: string | null;
  clientId: string; appId: string | null; appSlug: string | null;
  shareWithOrganization: boolean; connected: boolean; connectedAt: string | null;
  hasClientSecret: boolean; hasAppPrivateKey: boolean; hasInstallation: boolean;
  hasWebhookSecret: boolean;
  createdAt: string; updatedAt: string;
};
export type GitProviderRuntime = GitProviderRecord & {
  clientId: string; clientSecret: string | null; appId: string | null; appSlug: string | null;
  appPrivateKey: string | null; installationId: string | null; accessToken: string | null;
  refreshToken: string | null; tokenExpiresAt: string | null; webhookSecret: string | null;
};
type GitProviderRow = {
  id: string; provider: GitProviderKind; name: string; baseUrl: string; clientId: string;
  clientSecret: string | null; appId: string | null; appSlug: string | null; appPrivateKey: string | null;
  webhookSecret: string | null;
  installationId: string | null; accessToken: string | null; refreshToken: string | null;
  tokenExpiresAt: string | null; accountName: string | null; shareWithOrg: number;
  connectedAt: string | null; createdAt: string; updatedAt: string;
};
const gitProviderSelect = `SELECT id, provider, name, base_url AS baseUrl, client_id AS clientId,
  client_secret AS clientSecret, app_id AS appId, app_slug AS appSlug,
  app_private_key AS appPrivateKey, webhook_secret AS webhookSecret, installation_id AS installationId,
  access_token AS accessToken, refresh_token AS refreshToken,
  token_expires_at AS tokenExpiresAt, account_name AS accountName,
  share_with_org AS shareWithOrg, connected_at AS connectedAt,
  created_at AS createdAt, updated_at AS updatedAt FROM vessel_git_providers`;

function mapGitProvider(row: GitProviderRow): GitProviderRecord {
  return {
    id: row.id, provider: row.provider, name: row.name, baseUrl: row.baseUrl,
    clientId: row.clientId, appId: row.appId, appSlug: row.appSlug,
    accountName: row.accountName, shareWithOrganization: row.shareWithOrg === 1,
    connected: Boolean(row.connectedAt && (row.provider === "github" ? row.installationId : row.accessToken)),
    connectedAt: row.connectedAt, hasClientSecret: Boolean(row.clientSecret),
    hasAppPrivateKey: Boolean(row.appPrivateKey), hasInstallation: Boolean(row.installationId), hasWebhookSecret: Boolean(row.webhookSecret),
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

function readGitProvider(id: string): GitProviderRow | undefined {
  return db().prepare(`${gitProviderSelect} WHERE id = ?`).get(id) as GitProviderRow | undefined;
}

export function listGitProviders(): GitProviderRecord[] {
  return (db().prepare(`${gitProviderSelect} ORDER BY provider, name`).all() as GitProviderRow[]).map(mapGitProvider);
}

export function gitProviderById(id: string): GitProviderRecord | null {
  const row = readGitProvider(id);
  return row ? mapGitProvider(row) : null;
}

export function gitProviderRuntimeData(id: string): GitProviderRuntime | null {
  const row = readGitProvider(id);
  if (!row) return null;
  const decryptOptional = (value: string | null) => value ? decrypt(value) : null;
  return {
    ...mapGitProvider(row), clientId: row.clientId,
    clientSecret: decryptOptional(row.clientSecret), appId: row.appId, appSlug: row.appSlug,
    appPrivateKey: decryptOptional(row.appPrivateKey), installationId: row.installationId,
    accessToken: decryptOptional(row.accessToken), refreshToken: decryptOptional(row.refreshToken),
    tokenExpiresAt: row.tokenExpiresAt, webhookSecret: decryptOptional(row.webhookSecret),
  };
}

export function gitHubWebhookSecrets() {
  return (db().prepare(`${gitProviderSelect} WHERE provider = 'github' AND webhook_secret IS NOT NULL`).all() as GitProviderRow[])
    .map((row) => ({ id: row.id, secret: decrypt(row.webhookSecret!), installationId: row.installationId }));
}

export function gitProviderWebhookSecrets() {
  return (db().prepare(`${gitProviderSelect} WHERE webhook_secret IS NOT NULL`).all() as GitProviderRow[])
    .map((row) => ({ id: row.id, provider: row.provider, secret: decrypt(row.webhookSecret!), installationId: row.installationId }));
}

export function recordGitWebhookDelivery(providerId: string, deliveryId: string) {
  const table = db();
  table.prepare("DELETE FROM vessel_git_webhook_deliveries WHERE received_at < datetime('now', '-30 days')").run();
  const result = table.prepare("INSERT OR IGNORE INTO vessel_git_webhook_deliveries (provider_id, delivery_id) VALUES (?, ?)").run(providerId, deliveryId);
  return result.changes === 1;
}

export function gitSourceEventBaselineExists(sourceId: string, eventType: "tag" | "release") {
  return Boolean(db().prepare("SELECT 1 FROM vessel_git_source_event_baselines WHERE source_id = ? AND event_type = ?").get(sourceId, eventType));
}

export function initializeGitSourceEventBaseline(sourceId: string, eventType: "tag" | "release", refs: Array<{ name: string; commit?: string }>) {
  const table = db();
  table.exec("BEGIN IMMEDIATE");
  try {
    table.prepare("INSERT OR IGNORE INTO vessel_git_source_event_baselines (source_id, event_type) VALUES (?, ?)").run(sourceId, eventType);
    const insert = table.prepare("INSERT OR IGNORE INTO vessel_git_source_event_refs (source_id, event_type, ref_name, commit_sha, status) VALUES (?, ?, ?, ?, 'baseline')");
    for (const ref of refs) insert.run(sourceId, eventType, ref.name, ref.commit ?? null);
    table.exec("COMMIT");
  } catch (error) { table.exec("ROLLBACK"); throw error; }
}

export function claimGitSourceEventRef(sourceId: string, eventType: "push" | "tag" | "release", refName: string, commit?: string) {
  const result = db().prepare(`INSERT OR IGNORE INTO vessel_git_source_event_refs
    (source_id, event_type, ref_name, commit_sha, status) VALUES (?, ?, ?, ?, 'pending')`).run(sourceId, eventType, refName, commit ?? null);
  if (result.changes === 1) return true;
  const retry = db().prepare(`UPDATE vessel_git_source_event_refs SET status = 'pending', commit_sha = COALESCE(?, commit_sha), updated_at = CURRENT_TIMESTAMP
    WHERE source_id = ? AND event_type = ? AND ref_name = ? AND status = 'failed' AND updated_at < datetime('now', '-1 minute')`)
    .run(commit ?? null, sourceId, eventType, refName);
  return retry.changes === 1;
}

export function updateGitSourceEventRef(sourceId: string, eventType: "push" | "tag" | "release", refName: string, status: "pending" | "deployed" | "failed", commit?: string) {
  db().prepare(`UPDATE vessel_git_source_event_refs SET status = ?, commit_sha = COALESCE(?, commit_sha), updated_at = CURRENT_TIMESTAMP
    WHERE source_id = ? AND event_type = ? AND ref_name = ?`).run(status, commit ?? null, sourceId, eventType, refName);
}

export function gitSourceEventRef(sourceId: string, eventType: "push" | "tag" | "release", refName: string) {
  return db().prepare('SELECT status, commit_sha AS "commit" FROM vessel_git_source_event_refs WHERE source_id = ? AND event_type = ? AND ref_name = ?')
    .get(sourceId, eventType, refName) as { status: string; commit: string | null } | undefined;
}

export function listGitSourceEventRefs(sourceId: string, eventType: "push" | "tag" | "release") {
  return (db().prepare('SELECT ref_name AS name, commit_sha AS "commit", status FROM vessel_git_source_event_refs WHERE source_id = ? AND event_type = ?')
    .all(sourceId, eventType) as Array<{ name: string; commit: string | null; status: string }>);
}

export function listPendingGitSourceEventRefs(sourceId: string, eventType: "push" | "tag" | "release") {
  return (db().prepare(`SELECT ref_name AS name, commit_sha AS "commit", status FROM vessel_git_source_event_refs
    WHERE source_id = ? AND event_type = ? AND status = 'pending' ORDER BY updated_at, ref_name`)
    .all(sourceId, eventType) as Array<{ name: string; commit: string | null; status: string }>);
}

export function saveGitProvider(input: {
  id?: string; provider: GitProviderKind; name: string; baseUrl: string; clientId: string;
  clientSecret?: string; appId?: string; appSlug?: string; appPrivateKey?: string;
  webhookSecret?: string;
  shareWithOrganization: boolean; createdBy: string;
}) {
  if (!secretStorageReady()) throw new Error("Configura VESSEL_SECRET_KEY con al menos 32 caracteres aleatorios antes de conectar un proveedor Git");
  const current = input.id ? readGitProvider(input.id) : undefined;
  if (input.id && !current) throw new Error("La conexión Git no existe");
  const name = input.name.trim();
  const clientId = input.clientId.trim() || current?.clientId || "";
  const baseUrl = input.baseUrl.trim().replace(/\/$/, "");
  if (!("github gitlab bitbucket gitea".split(" ").includes(input.provider))) throw new Error("El proveedor Git no es válido");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u.test(name)) throw new Error("El nombre de conexión debe tener entre 1 y 64 caracteres");
  if (!clientId || clientId.length > 512 || /[\r\n\0]/.test(clientId)) throw new Error("El Client ID es obligatorio y no puede superar 512 caracteres");
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error("La URL del proveedor debe ser válida"); }
  if (!(["https:"].includes(parsed.protocol) || parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname))) throw new Error("El proveedor Git debe usar HTTPS (HTTP solo se permite en localhost)");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("La URL del proveedor no debe contener credenciales, query ni fragmento");
  if (input.provider === "github" && (!/^[0-9]{1,20}$/.test(input.appId?.trim() || current?.appId || "") || !/^[A-Za-z0-9-]+$/.test(input.appSlug?.trim() || current?.appSlug || ""))) throw new Error("GitHub App requiere un App ID numérico y un slug válidos");
  const clientSecret = input.clientSecret?.trim() ? encrypt(input.clientSecret.trim()) : current?.clientSecret ?? null;
  const privateKeyInput = input.appPrivateKey?.trim();
  const appPrivateKey = privateKeyInput ? encrypt(privateKeyInput.replace(/\\n/g, "\n")) : current?.appPrivateKey ?? null;
  const webhookSecret = input.webhookSecret?.trim() ? encrypt(input.webhookSecret.trim()) : current?.webhookSecret ?? null;
  if (!clientSecret && input.provider !== "github") throw new Error("El Client Secret es obligatorio para este proveedor OAuth");
  if (input.provider === "github" && !appPrivateKey) throw new Error("GitHub App requiere su clave privada PEM");
  const id = current?.id ?? randomUUID();
  const appId = input.provider === "github" ? (input.appId?.trim() || current?.appId || "") : null;
  const appSlug = input.provider === "github" ? (input.appSlug?.trim() || current?.appSlug || "") : null;
  const authConfigurationChanged = Boolean(current && (
    current.provider !== input.provider || current.baseUrl !== baseUrl || current.clientId !== clientId || current.appId !== appId ||
    Boolean(input.clientSecret?.trim() && current.clientSecret && decrypt(current.clientSecret) !== input.clientSecret.trim())
  ));
  const table = db();
  if (current) {
    if (authConfigurationChanged) {
      table.prepare("DELETE FROM vessel_git_provider_states WHERE provider_id = ?").run(id);
      table.prepare(`UPDATE vessel_git_providers SET provider = ?, name = ?, base_url = ?, client_id = ?,
        client_secret = ?, app_id = ?, app_slug = ?, app_private_key = ?, webhook_secret = ?, share_with_org = ?,
        installation_id = NULL, access_token = NULL, refresh_token = NULL, token_expires_at = NULL,
        account_name = NULL, connected_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(input.provider, name, baseUrl, clientId, clientSecret, appId, appSlug, appPrivateKey, webhookSecret, input.shareWithOrganization ? 1 : 0, id);
    } else {
      table.prepare(`UPDATE vessel_git_providers SET provider = ?, name = ?, base_url = ?, client_id = ?,
        client_secret = ?, app_id = ?, app_slug = ?, app_private_key = ?, webhook_secret = ?, share_with_org = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(input.provider, name, baseUrl, clientId, clientSecret, appId, appSlug, appPrivateKey, webhookSecret, input.shareWithOrganization ? 1 : 0, id);
    }
  } else {
    table.prepare(`INSERT INTO vessel_git_providers (id, provider, name, base_url, client_id, client_secret,
      app_id, app_slug, app_private_key, webhook_secret, share_with_org, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.provider, name, baseUrl, clientId, clientSecret, appId, appSlug, appPrivateKey, webhookSecret, input.shareWithOrganization ? 1 : 0, input.createdBy);
  }
  return gitProviderById(id)!;
}

export function deleteGitProvider(id: string) {
  const table = db();
  const used = Number((table.prepare("SELECT COUNT(*) AS count FROM vessel_git_sources WHERE git_provider_id = ?").get(id) as { count: number }).count);
  if (used) throw new Error("Desvincula primero las fuentes de despliegue que usan esta conexión");
  table.prepare("DELETE FROM vessel_git_provider_states WHERE provider_id = ?").run(id);
  table.prepare("DELETE FROM vessel_git_providers WHERE id = ?").run(id);
}

export function createGitProviderState(providerId: string, userId: string, lifetimeMs = 10 * 60 * 1000) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const table = db();
  table.prepare("DELETE FROM vessel_git_provider_states WHERE expires_at <= ?").run(new Date().toISOString());
  table.prepare("INSERT INTO vessel_git_provider_states (state_hash, provider_id, user_id, verifier, expires_at) VALUES (?, ?, ?, ?, ?)")
    .run(createHash("sha256").update(state).digest("hex"), providerId, userId, encrypt(verifier), new Date(Date.now() + lifetimeMs).toISOString());
  return { state, verifier };
}

export function createGitManifestState(userId: string, browserOrigin: string, lifetimeMs = 10 * 60 * 1000) {
  const state = randomBytes(32).toString("base64url");
  const table = db();
  table.prepare("DELETE FROM vessel_git_manifest_states WHERE expires_at <= ?").run(new Date().toISOString());
  table.prepare("INSERT INTO vessel_git_manifest_states (state_hash, user_id, browser_origin, expires_at) VALUES (?, ?, ?, ?)")
    .run(createHash("sha256").update(state).digest("hex"), userId, browserOrigin, new Date(Date.now() + lifetimeMs).toISOString());
  return state;
}

export function consumeGitManifestState(state: string, userId: string): string | null {
  if (!state || state.length > 256) return null;
  const hash = createHash("sha256").update(state).digest("hex");
  const table = db();
  const row = table.prepare(`SELECT browser_origin AS browserOrigin FROM vessel_git_manifest_states
    WHERE state_hash = ? AND user_id = ? AND julianday(expires_at) > julianday('now')`).get(hash, userId) as { browserOrigin: string } | undefined;
  table.prepare("DELETE FROM vessel_git_manifest_states WHERE state_hash = ?").run(hash);
  return row?.browserOrigin || null;
}

export function gitProviderStateOwner(state: string, userId: string): string | null {
  if (!state || state.length > 256) return null;
  const hash = createHash("sha256").update(state).digest("hex");
  const row = db().prepare(`SELECT provider_id AS providerId FROM vessel_git_provider_states
    WHERE state_hash = ? AND user_id = ? AND julianday(expires_at) > julianday('now')`).get(hash, userId) as { providerId: string } | undefined;
  return row?.providerId ?? null;
}

export function consumeGitProviderState(state: string, providerId: string, userId: string) {
  if (!state || state.length > 256) return null;
  const hash = createHash("sha256").update(state).digest("hex");
  const table = db();
  const row = table.prepare(`SELECT verifier FROM vessel_git_provider_states
    WHERE state_hash = ? AND provider_id = ? AND user_id = ? AND julianday(expires_at) > julianday('now')`).get(hash, providerId, userId) as { verifier: string } | undefined;
  table.prepare("DELETE FROM vessel_git_provider_states WHERE state_hash = ?").run(hash);
  if (!row) return null;
  return decrypt(row.verifier);
}

export function saveGitProviderAuthorization(id: string, tokens: {
  accessToken: string; refreshToken?: string | null; expiresAt?: string | null;
  accountName?: string | null; installationId?: string | null;
}) {
  if (!secretStorageReady()) throw new Error("Configura VESSEL_SECRET_KEY antes de guardar tokens Git");
  const current = readGitProvider(id);
  if (!current) throw new Error("La conexión Git no existe");
  const accessToken = tokens.accessToken ? encrypt(tokens.accessToken) : current.accessToken;
  const refreshToken = tokens.refreshToken ? encrypt(tokens.refreshToken) : current.refreshToken;
  db().prepare(`UPDATE vessel_git_providers SET access_token = ?, refresh_token = ?,
    token_expires_at = ?, account_name = COALESCE(?, account_name),
    installation_id = COALESCE(?, installation_id), connected_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(accessToken, refreshToken, tokens.expiresAt ?? null, tokens.accountName ?? null, tokens.installationId ?? null, id);
}

export function updateGitProviderTokens(id: string, tokens: { accessToken: string; refreshToken?: string | null; expiresAt?: string | null }) {
  if (!secretStorageReady()) throw new Error("Configura VESSEL_SECRET_KEY antes de guardar tokens Git");
  db().prepare(`UPDATE vessel_git_providers SET access_token = ?, refresh_token = COALESCE(?, refresh_token), token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(encrypt(tokens.accessToken), tokens.refreshToken ? encrypt(tokens.refreshToken) : null, tokens.expiresAt ?? null, id);
}

export function disconnectGitProvider(id: string) {
  db().prepare("DELETE FROM vessel_git_provider_states WHERE provider_id = ?").run(id);
  db().prepare(`UPDATE vessel_git_providers SET installation_id = NULL, access_token = NULL,
    refresh_token = NULL, token_expires_at = NULL, account_name = NULL, connected_at = NULL,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
}

export type GitSourceRecord = {
  id: string;
  name: string;
  repository: string;
  providerId: string | null;
  providerType: GitProviderKind | null;
  providerName: string | null;
  branch: string;
  composePath: string;
  autoDeploy: boolean;
  triggerType: "push" | "tag" | "release" | "manual";
  pollIntervalSeconds: number;
  watchPaths: string[];
  enableSubmodules: boolean;
  hasToken: boolean;
  lastCommit: string | null;
  lastEventRef: string | null;
  lastCheckedAt: string | null;
  lastDeployedAt: string | null;
  lastStatus: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type GitSourceRow = Omit<GitSourceRecord, "autoDeploy" | "hasToken" | "watchPaths" | "enableSubmodules"> & { autoDeploy: number; watchPaths: string; enableSubmodules: number; accessToken: string | null };

function mapGitSource(row: GitSourceRow): GitSourceRecord {
  return {
    id: row.id, name: row.name, repository: row.repository, providerId: row.providerId,
    providerType: row.providerType, providerName: row.providerName, branch: row.branch,
    composePath: row.composePath, autoDeploy: row.autoDeploy === 1,
    triggerType: row.triggerType ?? "push",
    pollIntervalSeconds: row.pollIntervalSeconds,
    watchPaths: (() => { try { const parsed = JSON.parse(row.watchPaths); return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []; } catch { return []; } })(),
    enableSubmodules: row.enableSubmodules === 1, hasToken: Boolean(row.accessToken),
    lastCommit: row.lastCommit, lastEventRef: row.lastEventRef ?? null, lastCheckedAt: row.lastCheckedAt,
    lastDeployedAt: row.lastDeployedAt, lastStatus: row.lastStatus,
    lastError: row.lastError, createdAt: row.createdAt, updatedAt: row.updatedAt,
  };
}

const gitSourceSelect = `SELECT s.id, s.name, s.repository, s.git_provider_id AS providerId,
  p.provider AS providerType, p.name AS providerName, s.branch, s.compose_path AS composePath,
  s.access_token AS accessToken, s.auto_deploy AS autoDeploy,
  s.trigger_type AS triggerType, s.last_event_ref AS lastEventRef,
  s.poll_interval_seconds AS pollIntervalSeconds, s.watch_paths AS watchPaths,
  s.enable_submodules AS enableSubmodules, s.last_commit AS lastCommit,
  s.last_checked_at AS lastCheckedAt, s.last_deployed_at AS lastDeployedAt,
  s.last_status AS lastStatus, s.last_error AS lastError,
  s.created_at AS createdAt, s.updated_at AS updatedAt
  FROM vessel_git_sources s LEFT JOIN vessel_git_providers p ON p.id = s.git_provider_id`;

export function listGitSources(): GitSourceRecord[] {
  return (db().prepare(`${gitSourceSelect} ORDER BY s.name`).all() as GitSourceRow[]).map(mapGitSource);
}

export function gitSourceById(id: string): GitSourceRecord | null {
  const row = db().prepare(`${gitSourceSelect} WHERE s.id = ?`).get(id) as GitSourceRow | undefined;
  return row ? mapGitSource(row) : null;
}

export function createGitSource(input: { name: string; repository: string; providerId?: string | null; branch: string; composePath: string; autoDeploy: boolean; triggerType?: GitSourceRecord["triggerType"]; pollIntervalSeconds: number; watchPaths?: string[]; enableSubmodules?: boolean; accessToken?: string }) {
  const id = randomUUID();
  const accessToken = input.accessToken?.trim();
  const provider = input.providerId ? gitProviderRuntimeData(input.providerId) : null;
  if (input.providerId && !provider?.connected) throw new Error("Selecciona una conexión Git autorizada");
  if (accessToken && !secretStorageReady()) throw new Error("Configura una clave VESSEL_SECRET_KEY segura de al menos 32 caracteres antes de guardar credenciales");
  db().prepare(`INSERT INTO vessel_git_sources
    (id, name, repository, git_provider_id, branch, compose_path, access_token, auto_deploy, trigger_type, poll_interval_seconds, watch_paths, enable_submodules)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.name, input.repository, input.providerId ?? null, input.branch, input.composePath, accessToken ? encrypt(accessToken) : null, input.autoDeploy ? 1 : 0, input.triggerType ?? "push", input.pollIntervalSeconds, JSON.stringify(input.watchPaths ?? []), input.enableSubmodules ? 1 : 0);
  return gitSourceById(id)!;
}

export function updateGitSource(input: { id: string; name: string; repository: string; providerId?: string | null; branch: string; composePath: string; autoDeploy: boolean; triggerType?: GitSourceRecord["triggerType"]; pollIntervalSeconds: number; watchPaths?: string[]; enableSubmodules?: boolean; accessToken?: string; clearToken?: boolean }) {
  const current = db().prepare("SELECT access_token AS accessToken FROM vessel_git_sources WHERE id = ?").get(input.id) as { accessToken: string | null } | undefined;
  if (!current) return null;
  const provider = input.providerId ? gitProviderRuntimeData(input.providerId) : null;
  if (input.providerId && !provider?.connected) throw new Error("Selecciona una conexión Git autorizada");
  const newToken = input.accessToken?.trim();
  if ((newToken || input.clearToken) && !secretStorageReady()) throw new Error("Configura una clave VESSEL_SECRET_KEY segura de al menos 32 caracteres antes de guardar credenciales");
  const token = input.clearToken ? null : newToken ? encrypt(newToken) : current.accessToken;
  db().prepare(`UPDATE vessel_git_sources SET name = ?, repository = ?, git_provider_id = ?, branch = ?, compose_path = ?,
    access_token = ?, auto_deploy = ?, trigger_type = ?, poll_interval_seconds = ?, watch_paths = ?, enable_submodules = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(input.name, input.repository, input.providerId ?? null, input.branch, input.composePath, token, input.autoDeploy ? 1 : 0, input.triggerType ?? (input.autoDeploy ? "push" : "manual"), input.pollIntervalSeconds, JSON.stringify(input.watchPaths ?? []), input.enableSubmodules ? 1 : 0, input.id);
  return gitSourceById(input.id);
}

export function deleteGitSource(id: string) {
  const table = db();
  table.exec("BEGIN IMMEDIATE");
  try {
    table.prepare("DELETE FROM vessel_git_source_secrets WHERE source_id = ?").run(id);
    table.prepare("DELETE FROM vessel_git_sources WHERE id = ?").run(id);
    table.exec("COMMIT");
  } catch (error) {
    table.exec("ROLLBACK");
    throw error;
  }
}

export function gitSourceRuntimeData(id: string): { source: GitSourceRecord; accessToken: string | null; provider: GitProviderRuntime | null; secrets: Record<string, string> } | null {
  const row = db().prepare(`${gitSourceSelect} WHERE s.id = ?`).get(id) as GitSourceRow | undefined;
  if (!row) return null;
  const secretRows = db().prepare("SELECT secret_name AS name, encrypted_value AS value FROM vessel_git_source_secrets WHERE source_id = ? ORDER BY secret_name").all(id) as Array<{ name: string; value: string }>;
  return {
    source: mapGitSource(row),
    accessToken: row.accessToken ? decrypt(row.accessToken) : null,
    provider: row.providerId ? gitProviderRuntimeData(row.providerId) : null,
    secrets: Object.fromEntries(secretRows.map((secret) => [secret.name, decrypt(secret.value)])),
  };
}

export function gitSourceSecretNames(id: string): string[] {
  return (db().prepare("SELECT secret_name AS name FROM vessel_git_source_secrets WHERE source_id = ? ORDER BY secret_name").all(id) as Array<{ name: string }>).map((row) => row.name);
}

export function setGitSourceSecret(id: string, name: string, value: string) {
  if (!secretStorageReady()) throw new Error("Configura una clave VESSEL_SECRET_KEY segura de al menos 32 caracteres antes de guardar secretos");
  db().prepare(`INSERT INTO vessel_git_source_secrets (source_id, secret_name, encrypted_value)
    VALUES (?, ?, ?) ON CONFLICT(source_id, secret_name) DO UPDATE SET
    encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP`).run(id, name, encrypt(value));
}

export function deleteGitSourceSecret(id: string, name: string) {
  db().prepare("DELETE FROM vessel_git_source_secrets WHERE source_id = ? AND secret_name = ?").run(id, name);
}

export function updateGitSourceState(id: string, state: { lastCommit?: string | null; lastEventRef?: string | null; lastCheckedAt?: string | null; lastDeployedAt?: string | null; lastStatus?: string; lastError?: string | null }) {
  db().prepare(`UPDATE vessel_git_sources SET
    last_commit = COALESCE(?, last_commit), last_event_ref = COALESCE(?, last_event_ref), last_checked_at = COALESCE(?, last_checked_at),
    last_deployed_at = COALESCE(?, last_deployed_at), last_status = COALESCE(?, last_status),
    last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(state.lastCommit ?? null, state.lastEventRef ?? null, state.lastCheckedAt ?? null, state.lastDeployedAt ?? null, state.lastStatus ?? null, state.lastError ?? null, id);
}

export type GitDeploymentPhase = "queued" | "checking_remote" | "syncing_repository" | "validating_compose" | "cleaning_volumes" | "rebuilding" | "starting" | "stopping" | "building_and_deploying" | "completed" | "failed" | "cancelled";
export type GitDeploymentEvent = { phase: GitDeploymentPhase; at: string };
export type GitDeploymentRecord = {
  id: string; sourceId: string; sourceName: string; repository: string; branch: string;
  trigger: "manual" | "automatic"; commit: string | null; commitTitle: string | null; status: "queued" | "running" | "succeeded" | "failed";
  phase: GitDeploymentPhase; events: GitDeploymentEvent[]; logs: string; error: string | null;
  startedAt: string; updatedAt: string; finishedAt: string | null;
};

type GitDeploymentRow = Omit<GitDeploymentRecord, "trigger" | "status" | "phase" | "events"> & {
  trigger: string; status: string; phase: string; eventsJson: string;
};

function mapGitDeployment(row: GitDeploymentRow): GitDeploymentRecord {
  let events: GitDeploymentEvent[] = [];
  try {
    const parsed = JSON.parse(row.eventsJson);
    if (Array.isArray(parsed)) events = parsed.filter((event): event is GitDeploymentEvent =>
      event && typeof event === "object" && typeof event.at === "string" && typeof event.phase === "string");
  } catch { /* Keep a readable deployment record if legacy/corrupt event JSON is encountered. */ }
  const phases: GitDeploymentPhase[] = ["queued", "checking_remote", "syncing_repository", "validating_compose", "cleaning_volumes", "rebuilding", "starting", "stopping", "building_and_deploying", "completed", "failed", "cancelled"];
  return {
    id: row.id, sourceId: row.sourceId, sourceName: row.sourceName, repository: row.repository,
    branch: row.branch, trigger: row.trigger === "automatic" ? "automatic" : "manual",
    commit: row.commit, commitTitle: row.commitTitle ?? null, status: (["queued", "running", "succeeded", "failed", "cancelled"].includes(row.status) ? row.status : "failed") as GitDeploymentRecord["status"],
    phase: phases.includes(row.phase as GitDeploymentPhase) ? row.phase as GitDeploymentPhase : "failed",
    events, logs: row.logs ?? "", error: row.error, startedAt: row.startedAt, updatedAt: row.updatedAt, finishedAt: row.finishedAt,
  };
}

const gitDeploymentSelect = `SELECT id, source_id AS sourceId, source_name AS sourceName,
  repository, branch, trigger_kind AS "trigger", commit_sha AS "commit", commit_title AS commitTitle, status, phase,
  events_json AS eventsJson, logs_text AS logs, error, started_at AS startedAt, updated_at AS updatedAt,
  finished_at AS finishedAt FROM vessel_git_deployments`;

export function createGitDeployment(input: { source: GitSourceRecord; trigger: "manual" | "automatic" }): GitDeploymentRecord {
  const id = randomUUID();
  const now = new Date().toISOString();
  const events = [{ phase: "queued" as const, at: now }];
  db().prepare(`INSERT INTO vessel_git_deployments
    (id, source_id, source_name, repository, branch, trigger_kind, status, phase, events_json, started_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'queued', 'queued', ?, ?, ?)`)
    .run(id, input.source.id, input.source.name, input.source.repository, input.source.branch, input.trigger, JSON.stringify(events), now, now);
  // Bound SQLite growth while preserving a useful deployment history.
  db().prepare(`DELETE FROM vessel_git_deployments WHERE id IN (
    SELECT id FROM vessel_git_deployments ORDER BY started_at DESC LIMIT -1 OFFSET 500
  ) AND status IN ('succeeded', 'failed')`).run();
  return getGitDeployment(id)!;
}

export function getGitDeployment(id: string): GitDeploymentRecord | null {
  const row = db().prepare(`${gitDeploymentSelect} WHERE id = ?`).get(id) as GitDeploymentRow | undefined;
  return row ? mapGitDeployment(row) : null;
}

export function listGitDeployments(sourceId?: string, limit = 100): GitDeploymentRecord[] {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const rows = (sourceId
    ? db().prepare(`${gitDeploymentSelect} WHERE source_id = ? ORDER BY started_at DESC LIMIT ?`).all(sourceId, boundedLimit)
    : db().prepare(`${gitDeploymentSelect} ORDER BY started_at DESC LIMIT ?`).all(boundedLimit)) as GitDeploymentRow[];
  return rows.map(mapGitDeployment);
}

export function updateGitDeployment(id: string, input: {
  phase: GitDeploymentPhase; status?: GitDeploymentRecord["status"]; commit?: string | null; commitTitle?: string | null;
  error?: string | null; finished?: boolean;
}) {
  const existing = getGitDeployment(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const events = [...existing.events, { phase: input.phase, at: now }].slice(-80);
  db().prepare(`UPDATE vessel_git_deployments SET status = ?, phase = ?, commit_sha = COALESCE(?, commit_sha), commit_title = COALESCE(?, commit_title),
    events_json = ?, error = ?, updated_at = ?, finished_at = ? WHERE id = ?`)
    .run(input.status ?? "running", input.phase, input.commit ?? null, input.commitTitle ?? null, JSON.stringify(events), input.error ?? null, now, input.finished ? now : existing.finishedAt, id);
  return getGitDeployment(id);
}

export function appendGitDeploymentLog(id: string, text: string) {
  if (!text) return;
  db().prepare("UPDATE vessel_git_deployments SET logs_text = substr(COALESCE(logs_text, '') || ?, -262144) WHERE id = ?").run(text, id);
}

export function updateGitDeploymentCommitTitle(id: string, title: string) {
  const cleanTitle = title.trim().slice(0, 500);
  if (!cleanTitle) return;
  db().prepare("UPDATE vessel_git_deployments SET commit_title = ? WHERE id = ? AND (commit_title IS NULL OR commit_title = '')").run(cleanTitle, id);
}

export function cancelGitDeploymentRecord(id: string) {
  const now = new Date().toISOString();
  const row = getGitDeployment(id);
  if (!row || !["queued", "running"].includes(row.status)) return false;
  const events = [...row.events, { phase: "cancelled" as const, at: now }].slice(-80);
  db().prepare(`UPDATE vessel_git_deployments SET status = 'cancelled', phase = 'cancelled', error = NULL,
    logs_text = substr(COALESCE(logs_text, '') || ?, -262144), events_json = ?, updated_at = ?, finished_at = ? WHERE id = ?`)
    .run("\nDeployment cancelled by an operator.\n", JSON.stringify(events), now, now, id);
  return true;
}

export function clearGitDeploymentHistory(sourceId: string) {
  const result = db().prepare("DELETE FROM vessel_git_deployments WHERE source_id = ? AND status NOT IN ('queued', 'running')").run(sourceId);
  return Number(result.changes ?? 0);
}

export function recoverInterruptedGitDeployments() {
  const active = db().prepare(`${gitDeploymentSelect} WHERE status IN ('queued', 'running')`).all() as GitDeploymentRow[];
  for (const row of active) {
    const deployment = mapGitDeployment(row);
    updateGitDeployment(deployment.id, {
      phase: "failed", status: "failed", error: "Vessel reinició durante este despliegue. Verifica el estado del proyecto en Docker antes de volver a desplegar.", finished: true,
    });
    updateGitSourceState(deployment.sourceId, { lastStatus: "failed", lastError: "Vessel reinició durante el despliegue; verifica Docker antes de reintentar." });
  }
}

export type VesselProjectRecord = {
  id: string;
  name: string;
  description: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  serviceCount: number;
  tags: VesselProjectTag[];
};

export type VesselProjectTag = { id: string; name: string };

export function listVesselProjectTags(): VesselProjectTag[] {
  return db().prepare("SELECT id, name FROM vessel_project_tags ORDER BY name COLLATE NOCASE")
    .all() as VesselProjectTag[];
}

function projectTags(projectId: string): VesselProjectTag[] {
  return db().prepare(`SELECT t.id, t.name FROM vessel_project_tags t
    INNER JOIN vessel_project_tag_links l ON l.tag_id = t.id
    WHERE l.project_id = ? ORDER BY t.name COLLATE NOCASE`).all(projectId) as VesselProjectTag[];
}

export function createVesselProjectTag(name: string): VesselProjectTag {
  const id = randomUUID();
  db().prepare("INSERT INTO vessel_project_tags (id, name) VALUES (?, ?)").run(id, name.trim());
  return db().prepare("SELECT id, name FROM vessel_project_tags WHERE id = ?").get(id) as VesselProjectTag;
}

export function assignVesselProjectTags(projectId: string, tagIds: string[]) {
  const table = db();
  const uniqueIds = [...new Set(tagIds)];
  const validCount = Number((table.prepare(`SELECT COUNT(*) AS count FROM vessel_project_tags
    WHERE id IN (${uniqueIds.length ? uniqueIds.map(() => "?").join(",") : "NULL"})`).get(...uniqueIds) as { count: number }).count);
  if (validCount !== uniqueIds.length) throw new Error("A project tag was not found");
  table.exec("BEGIN IMMEDIATE");
  try {
    table.prepare("DELETE FROM vessel_project_tag_links WHERE project_id = ?").run(projectId);
    const insert = table.prepare("INSERT INTO vessel_project_tag_links (project_id, tag_id) VALUES (?, ?)");
    for (const tagId of uniqueIds) insert.run(projectId, tagId);
    table.prepare("UPDATE vessel_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
    table.exec("COMMIT");
  } catch (error) {
    table.exec("ROLLBACK");
    throw error;
  }
}

export type VesselProjectServiceKind = "application" | "database" | "compose" | "template" | "assistant" | "import" | "git";
export type VesselProjectServiceRecord = {
  id: string;
  projectId: string;
  kind: VesselProjectServiceKind;
  name: string;
  description: string;
  appName: string;
  targetType: "container" | "compose" | "git" | null;
  targetRef: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listVesselProjects(): VesselProjectRecord[] {
  const rows = db().prepare(`SELECT p.id, p.name, p.description, p.created_by AS createdBy,
    p.created_at AS createdAt, p.updated_at AS updatedAt,
    COUNT(s.id) AS serviceCount FROM vessel_projects p
    LEFT JOIN vessel_project_services s ON s.project_id = p.id
    GROUP BY p.id ORDER BY p.updated_at DESC, p.name COLLATE NOCASE`)
    .all() as Array<Omit<VesselProjectRecord, "tags">>;
  return rows.map((row) => ({ ...row, tags: projectTags(row.id) }));
}

export function vesselProjectById(id: string): VesselProjectRecord | null {
  const row = (db().prepare(`SELECT p.id, p.name, p.description, p.created_by AS createdBy,
    p.created_at AS createdAt, p.updated_at AS updatedAt,
    COUNT(s.id) AS serviceCount FROM vessel_projects p
    LEFT JOIN vessel_project_services s ON s.project_id = p.id
    WHERE p.id = ? GROUP BY p.id`).get(id) as VesselProjectRecord | undefined) ?? null;
  return row ? { ...row, tags: projectTags(row.id) } : null;
}

export function listVesselProjectServices(projectId: string): VesselProjectServiceRecord[] {
  return db().prepare(`SELECT id, project_id AS projectId, kind, name, description, app_name AS appName,
    target_type AS targetType, target_ref AS targetRef, created_at AS createdAt,
    updated_at AS updatedAt FROM vessel_project_services WHERE project_id = ?
    ORDER BY created_at, name COLLATE NOCASE`).all(projectId) as VesselProjectServiceRecord[];
}

export function vesselProjectIdForResource(targetType: "container" | "compose", targetRef: string): string | null {
  const row = db().prepare(`SELECT project_id AS projectId FROM vessel_project_services
    WHERE target_type = ? AND target_ref = ? ORDER BY updated_at DESC LIMIT 1`).get(targetType, targetRef) as { projectId: string } | undefined;
  return row?.projectId ?? null;
}

export function createVesselProject(input: { name: string; description?: string; createdBy?: string | null }): VesselProjectRecord {
  const id = randomUUID();
  db().prepare(`INSERT INTO vessel_projects (id, name, description, created_by)
    VALUES (?, ?, ?, ?)`).run(id, input.name, input.description?.trim() ?? "", input.createdBy ?? null);
  return vesselProjectById(id)!;
}

export function updateVesselProject(input: { id: string; name: string; description?: string }): VesselProjectRecord | null {
  const result = db().prepare(`UPDATE vessel_projects SET name = ?, description = ?,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(input.name, input.description?.trim() ?? "", input.id);
  return Number(result.changes) ? vesselProjectById(input.id) : null;
}

export function deleteVesselProject(id: string): "deleted" | "not_found" | "has_services" {
  const table = db();
  table.exec("BEGIN IMMEDIATE");
  try {
    const project = table.prepare("SELECT id FROM vessel_projects WHERE id = ?").get(id);
    if (!project) { table.exec("COMMIT"); return "not_found"; }
    const count = Number((table.prepare("SELECT COUNT(*) AS count FROM vessel_project_services WHERE project_id = ?").get(id) as { count: number }).count);
    if (count > 0) { table.exec("COMMIT"); return "has_services"; }
    table.prepare("DELETE FROM vessel_project_tag_links WHERE project_id = ?").run(id);
    table.prepare("DELETE FROM vessel_project_environment WHERE project_id = ?").run(id);
    const result = table.prepare("DELETE FROM vessel_projects WHERE id = ?").run(id);
    table.exec("COMMIT");
    return Number(result.changes) > 0 ? "deleted" : "not_found";
  } catch (error) {
    table.exec("ROLLBACK");
    throw error;
  }
}

export function listVesselProjectEnvironmentNames(projectId: string): string[] {
  return (db().prepare(`SELECT variable_name AS name FROM vessel_project_environment
    WHERE project_id = ? ORDER BY variable_name COLLATE NOCASE`).all(projectId) as Array<{ name: string }>).map((row) => row.name);
}

export function getVesselProjectEnvironment(projectId: string): Record<string, string> {
  const rows = db().prepare(`SELECT variable_name AS name, encrypted_value AS value
    FROM vessel_project_environment WHERE project_id = ?`).all(projectId) as Array<{ name: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.name, decrypt(row.value)]));
}

export function maskVesselProjectEnvironmentReferences(projectId: string, values: string[]): string[] {
  const variables = getVesselProjectEnvironment(projectId);
  return values.map((entry) => {
    const separator = entry.indexOf("=");
    if (separator < 1) return entry;
    const name = entry.slice(0, separator);
    if (!Object.hasOwn(variables, name) || entry.slice(separator + 1) !== variables[name]) return entry;
    return `${name}=\${{project.${name}}}`;
  });
}

export function setVesselProjectEnvironmentVariable(projectId: string, name: string, value: string) {
  db().prepare(`INSERT INTO vessel_project_environment (project_id, variable_name, encrypted_value)
    VALUES (?, ?, ?) ON CONFLICT(project_id, variable_name) DO UPDATE SET
    encrypted_value = excluded.encrypted_value, updated_at = CURRENT_TIMESTAMP`)
    .run(projectId, name, encrypt(value));
  db().prepare("UPDATE vessel_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
}

export function deleteVesselProjectEnvironmentVariable(projectId: string, name: string): boolean {
  const result = db().prepare("DELETE FROM vessel_project_environment WHERE project_id = ? AND variable_name = ?").run(projectId, name);
  if (Number(result.changes)) db().prepare("UPDATE vessel_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
  return Number(result.changes) > 0;
}

export function resolveVesselProjectReferences(projectId: string, values: string[]): string[] {
  const variables = getVesselProjectEnvironment(projectId);
  return values.map((value) => value.replace(/\$\{\{project\.([A-Za-z_][A-Za-z0-9_]*)\}\}/g, (_match, name: string) => {
    if (!Object.hasOwn(variables, name)) throw new Error(`Project environment variable ${name} is not configured`);
    return variables[name];
  }));
}

export function addVesselProjectService(input: {
  projectId: string; kind: VesselProjectServiceKind; name: string; description?: string;
  appName?: string;
  targetType?: "container" | "compose" | "git" | null; targetRef?: string | null;
}): VesselProjectServiceRecord {
  if (!vesselProjectById(input.projectId)) throw new Error("Project not found");
  const id = randomUUID();
  db().prepare(`INSERT INTO vessel_project_services
    (id, project_id, kind, name, description, app_name, target_type, target_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, name) DO UPDATE SET kind = excluded.kind,
      description = excluded.description, target_type = excluded.target_type,
      app_name = CASE WHEN excluded.app_name <> '' THEN excluded.app_name ELSE vessel_project_services.app_name END,
      target_ref = excluded.target_ref, updated_at = CURRENT_TIMESTAMP`)
    .run(id, input.projectId, input.kind, input.name, input.description?.trim() ?? "", input.appName?.trim() ?? "", input.targetType ?? null, input.targetRef ?? null);
  db().prepare("UPDATE vessel_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(input.projectId);
  return db().prepare(`SELECT id, project_id AS projectId, kind, name, description, app_name AS appName,
    target_type AS targetType, target_ref AS targetRef, created_at AS createdAt,
    updated_at AS updatedAt FROM vessel_project_services WHERE project_id = ? AND name = ?`)
    .get(input.projectId, input.name) as VesselProjectServiceRecord;
}

export function removeVesselProjectService(projectId: string, serviceId: string): boolean {
  const result = db().prepare("DELETE FROM vessel_project_services WHERE project_id = ? AND id = ?").run(projectId, serviceId);
  if (Number(result.changes)) db().prepare("UPDATE vessel_projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(projectId);
  return Number(result.changes) > 0;
}
