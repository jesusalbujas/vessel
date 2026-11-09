import { randomUUID } from "node:crypto";
import { controlPlaneDatabase, decryptControlPlaneSecret, encryptControlPlaneSecret } from "@/lib/control-plane";

export type RemoteServer = {
  id: string; name: string; host: string; port: number; username: string;
  fingerprint: string; knownHost: string; createdAt: string; lastTestedAt: string | null;
};
type StoredRemoteServer = RemoteServer & { encryptedPrivateKey: string };

function ensureTable() {
  controlPlaneDatabase().exec(`CREATE TABLE IF NOT EXISTS vessel_remote_servers (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, host TEXT NOT NULL, port INTEGER NOT NULL,
    username TEXT NOT NULL, encrypted_private_key TEXT NOT NULL, fingerprint TEXT NOT NULL, known_host TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_tested_at TEXT
  )`);
}

export function listRemoteServers(): RemoteServer[] {
  ensureTable();
  return controlPlaneDatabase().prepare(`SELECT id, name, host, port, username, fingerprint, known_host AS knownHost,
    created_at AS createdAt, last_tested_at AS lastTestedAt FROM vessel_remote_servers ORDER BY name COLLATE NOCASE`).all() as RemoteServer[];
}

export function remoteServerWithKey(id: string): (RemoteServer & { privateKey: string }) | null {
  ensureTable();
  const row = controlPlaneDatabase().prepare(`SELECT id, name, host, port, username, fingerprint, known_host AS knownHost,
    encrypted_private_key AS encryptedPrivateKey, created_at AS createdAt, last_tested_at AS lastTestedAt
    FROM vessel_remote_servers WHERE id = ?`).get(id) as StoredRemoteServer | undefined;
  if (!row) return null;
  const { encryptedPrivateKey, ...server } = row;
  return { ...server, privateKey: decryptControlPlaneSecret(encryptedPrivateKey) };
}

export function saveRemoteServer(input: { name: string; host: string; port: number; username: string; privateKey: string; fingerprint: string; knownHost: string }): RemoteServer {
  ensureTable();
  const id = randomUUID();
  controlPlaneDatabase().prepare(`INSERT INTO vessel_remote_servers
    (id, name, host, port, username, encrypted_private_key, fingerprint, known_host, last_tested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).run(
    id, input.name.trim(), input.host.trim(), input.port, input.username.trim(), encryptControlPlaneSecret(input.privateKey), input.fingerprint, input.knownHost,
  );
  return listRemoteServers().find((server) => server.id === id)!;
}

export function markRemoteServerTested(id: string): void {
  ensureTable();
  controlPlaneDatabase().prepare("UPDATE vessel_remote_servers SET last_tested_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

export function deleteRemoteServer(id: string): boolean {
  ensureTable();
  return Number(controlPlaneDatabase().prepare("DELETE FROM vessel_remote_servers WHERE id = ?").run(id).changes) > 0;
}
