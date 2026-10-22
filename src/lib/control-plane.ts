import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.DOCKPILOT_DB_PATH ?? "/app/data/dockpilot.sqlite";
let database: DatabaseSync | null = null;

function db(): DatabaseSync {
  if (!database) {
    mkdirSync(dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    database.exec(`CREATE TABLE IF NOT EXISTS vessel_users (
      id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator', enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_registries (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, username TEXT NOT NULL,
      secret TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vessel_compose_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, compose_yaml TEXT NOT NULL,
      directory TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
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
  db().prepare("INSERT INTO vessel_users (id, username, password_hash, role) VALUES (?, ?, ?, 'administrator')").run(randomUUID(), process.env.VESSEL_ADMIN_USERNAME ?? "admin", hashPassword(password));
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
  db().prepare("INSERT INTO vessel_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(createHash("sha256").update(token).digest("hex"), userId, new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString());
  return token;
}

export function revokeSession(token: string): void {
  db().prepare("DELETE FROM vessel_sessions WHERE token_hash = ?").run(createHash("sha256").update(token).digest("hex"));
}

export function currentUser(token: string | null): { id: string; username: string; role: string } | null {
  if (!token) return null;
  const row = db().prepare("SELECT u.id, u.username, u.role FROM vessel_sessions s JOIN vessel_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.enabled = 1").get(createHash("sha256").update(token).digest("hex")) as { id: string; username: string; role: string } | undefined;
  return row ?? null;
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

export function listUsers() { return db().prepare("SELECT id, username, role, enabled, created_at AS createdAt FROM vessel_users ORDER BY username").all(); }

export function createUser(username: string, password: string, role: string) {
  if (!/^[a-zA-Z0-9._-]{3,64}$/.test(username) || password.length < 10) throw new Error("Username or password does not meet the minimum policy");
  const id = randomUUID();
  db().prepare("INSERT INTO vessel_users (id, username, password_hash, role) VALUES (?, ?, ?, ?)").run(id, username, hashPassword(password), ["administrator", "operator", "viewer"].includes(role) ? role : "operator");
  return { id, username, role };
}

export function listRegistries() { return db().prepare("SELECT id, name, url, username, created_at AS createdAt FROM vessel_registries ORDER BY name").all(); }
export function createRegistry(name: string, url: string, username: string, password: string) {
  if (!name || !/^https?:\/\//i.test(url) || !username || !password) throw new Error("Registry data is incomplete");
  const id = randomUUID();
  db().prepare("INSERT INTO vessel_registries (id, name, url, username, secret) VALUES (?, ?, ?, ?, ?)").run(id, name.trim().slice(0, 120), url.trim().replace(/\/$/, ""), username.trim(), encrypt(password));
  return { id, name, url, username };
}
export function deleteRegistry(id: string) { db().prepare("DELETE FROM vessel_registries WHERE id = ?").run(id); }
