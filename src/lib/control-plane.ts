import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeRegistryHost, prepareRegistry, type RegistryInput, type RegistryProvider } from "./registries";

export type PlatformSettings = {
  refreshIntervalSeconds: number;
  sessionLifetimeHours: number;
  passwordMinLength: number;
  passwordRequireStrong: boolean;
};

const defaultSettings: PlatformSettings = {
  refreshIntervalSeconds: 15,
  sessionLifetimeHours: 8,
  passwordMinLength: 10,
  passwordRequireStrong: false,
};

const databasePath = process.env.DOCKPILOT_DB_PATH ?? "/app/data/dockpilot.sqlite";
let database: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!database) {
    mkdirSync(dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    database.exec(`CREATE TABLE IF NOT EXISTS vessel_users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator', email TEXT, enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
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
    CREATE TABLE IF NOT EXISTS vessel_settings (
      setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    const userColumns = database.prepare("PRAGMA table_info(vessel_users)").all() as Array<{ name: string }>;
    if (!userColumns.some((column) => column.name === "email")) database.exec("ALTER TABLE vessel_users ADD COLUMN email TEXT");
    const registryColumns = database.prepare("PRAGMA table_info(vessel_registries)").all() as Array<{ name: string }>;
    if (!registryColumns.some((column) => column.name === "provider")) database.exec("ALTER TABLE vessel_registries ADD COLUMN provider TEXT NOT NULL DEFAULT 'generic'");
    if (!registryColumns.some((column) => column.name === "base_url")) database.exec("ALTER TABLE vessel_registries ADD COLUMN base_url TEXT");
    if (!registryColumns.some((column) => column.name === "region")) database.exec("ALTER TABLE vessel_registries ADD COLUMN region TEXT");
  }
  return database;
}

function secretKey(): Buffer {
  return createHash("sha256").update(process.env.VESSEL_SECRET_KEY ?? "change-this-vessel-secret-key").digest();
}

function encrypt(value: string): string {
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
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

export function ensureInitialAdmin(): void {
  const count = (db().prepare("SELECT COUNT(*) AS count FROM vessel_users").get() as { count: number }).count;
  if (count > 0) return;
  const password = process.env.VESSEL_ADMIN_PASSWORD;
  if (!password) return;
  const username = process.env.VESSEL_ADMIN_USERNAME ?? "admin";
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) return;
  try { validatePassword(password); } catch { return; }
  db().prepare("INSERT INTO vessel_users (id, username, password_hash, role) VALUES (?, ?, ?, 'administrator')").run(randomUUID(), username, hashPassword(password));
}

export function userCount(): number {
  return Number((db().prepare("SELECT COUNT(*) AS count FROM vessel_users").get() as { count: number }).count);
}

export function createInitialAdmin(username: string, password: string) {
  if (userCount() > 0) throw new Error("Initial administrator already exists");
  return createUser(username, password, "administrator");
}

export function authenticate(username: string, password: string): { id: string; username: string; role: string } | null {
  ensureInitialAdmin();
  const row = db().prepare("SELECT id, username, role, password_hash FROM vessel_users WHERE username = ? AND enabled = 1").get(username) as { id: string; username: string; role: string; password_hash: string } | undefined;
  return row && verifyPassword(password, row.password_hash) ? { id: row.id, username: row.username, role: row.role } : null;
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString("base64url");
  db().prepare("INSERT INTO vessel_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(createHash("sha256").update(token).digest("hex"), userId, new Date(Date.now() + sessionLifetimeSeconds() * 1000).toISOString());
  return token;
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
  };
}

export function updatePlatformSettings(input: Partial<PlatformSettings>): PlatformSettings {
  const allowed = new Set<keyof PlatformSettings>(["refreshIntervalSeconds", "sessionLifetimeHours", "passwordMinLength", "passwordRequireStrong"]);
  if (Object.keys(input).some((key) => !allowed.has(key as keyof PlatformSettings))) throw new Error("La solicitud incluye una opción desconocida");
  const current = getPlatformSettings();
  const next = { ...current, ...input };
  if (![5, 10, 15, 30, 60].includes(next.refreshIntervalSeconds)) throw new Error("El intervalo debe ser 5, 10, 15, 30 o 60 segundos");
  if (![1, 2, 4, 8, 12, 24].includes(next.sessionLifetimeHours)) throw new Error("La sesión debe durar 1, 2, 4, 8, 12 o 24 horas");
  if (!Number.isInteger(next.passwordMinLength) || next.passwordMinLength < 8 || next.passwordMinLength > 64) throw new Error("La longitud mínima debe estar entre 8 y 64 caracteres");
  if (typeof next.passwordRequireStrong !== "boolean") throw new Error("La opción de contraseña segura debe ser verdadera o falsa");
  const statement = db().prepare("INSERT INTO vessel_settings (setting_key, setting_value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP");
  for (const [key, value] of Object.entries(next)) statement.run(key, String(value));
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

export function currentUser(token: string | null): { id: string; username: string; role: string; email: string | null; avatarUrl: string | null } | null {
  if (!token) return null;
  const row = db().prepare("SELECT u.id, u.username, u.role, u.email FROM vessel_sessions s JOIN vessel_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.enabled = 1").get(createHash("sha256").update(token).digest("hex")) as { id: string; username: string; role: string; email: string | null } | undefined;
  if (!row) return null;
  const avatarHash = row.email ? createHash("sha256").update(row.email.trim().toLowerCase()).digest("hex") : null;
  return { ...row, avatarUrl: avatarHash ? `https://gravatar.com/avatar/${avatarHash}?s=128&d=identicon` : null };
}

export function mutationUser(request: Request): { id: string; username: string; role: string } | null {
  ensureInitialAdmin();
  return currentUser(requestToken(request));
}

export function authenticatedUser(request: Request): { id: string; username: string; role: string } | null {
  ensureInitialAdmin();
  return currentUser(requestToken(request));
}

function requestToken(request: Request): string | null {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-token="));
  return cookie ? decodeURIComponent(cookie.slice("vessel-token=".length)) : null;
}

export function listUsers() {
  return (db().prepare("SELECT id, username, email, role, enabled, created_at AS createdAt FROM vessel_users ORDER BY username").all() as Array<{ id: string; username: string; email: string | null; role: string; enabled: number; createdAt: string }>).map((user) => {
    const hash = user.email ? createHash("sha256").update(user.email.trim().toLowerCase()).digest("hex") : null;
    return { ...user, avatarUrl: hash ? `https://gravatar.com/avatar/${hash}?s=128&d=identicon` : null };
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
  db().prepare("INSERT INTO vessel_users (id, username, password_hash, role, email) VALUES (?, ?, ?, ?, ?)").run(id, username, hashPassword(password), ["administrator", "operator", "viewer"].includes(role) ? role : "operator", normalizedEmail);
  const hash = normalizedEmail ? createHash("sha256").update(normalizedEmail).digest("hex") : null;
  return { id, username, role, email: normalizedEmail, avatarUrl: hash ? `https://gravatar.com/avatar/${hash}?s=128&d=identicon` : null };
}

export function updateUserEmail(userId: string, email: string) {
  const normalizedEmail = normalizeEmail(email);
  db().prepare("UPDATE vessel_users SET email = ? WHERE id = ?").run(normalizedEmail, userId);
  return normalizedEmail;
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
