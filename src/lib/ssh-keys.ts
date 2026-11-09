import { randomUUID } from "node:crypto";
import { controlPlaneDatabase, decryptControlPlaneSecret, encryptControlPlaneSecret } from "@/lib/control-plane";

export type SSHKeyRecord = { id: string; name: string; description: string; publicKey: string; keyType: string; createdAt: string };
type StoredSSHKey = SSHKeyRecord & { encryptedPrivateKey: string };

function ensureTable() {
  controlPlaneDatabase().exec(`CREATE TABLE IF NOT EXISTS vessel_ssh_keys (
    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE, description TEXT NOT NULL DEFAULT '',
    public_key TEXT NOT NULL, key_type TEXT NOT NULL, encrypted_private_key TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

export function listSSHKeys(): SSHKeyRecord[] {
  ensureTable();
  return controlPlaneDatabase().prepare("SELECT id, name, description, public_key AS publicKey, key_type AS keyType, created_at AS createdAt FROM vessel_ssh_keys ORDER BY name COLLATE NOCASE").all() as SSHKeyRecord[];
}

export function getSSHKeyPrivate(id: string): string | null {
  ensureTable();
  const row = controlPlaneDatabase().prepare("SELECT encrypted_private_key AS encryptedPrivateKey FROM vessel_ssh_keys WHERE id = ?").get(id) as Pick<StoredSSHKey, "encryptedPrivateKey"> | undefined;
  return row ? decryptControlPlaneSecret(row.encryptedPrivateKey) : null;
}

export function saveSSHKey(input: { name: string; description: string; publicKey: string; privateKey: string; keyType: string }): SSHKeyRecord {
  ensureTable();
  const id = randomUUID();
  controlPlaneDatabase().prepare(`INSERT INTO vessel_ssh_keys(id, name, description, public_key, key_type, encrypted_private_key)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, input.name.trim(), input.description.trim(), input.publicKey.trim(), input.keyType, encryptControlPlaneSecret(input.privateKey));
  return listSSHKeys().find((key) => key.id === id)!;
}

export function deleteSSHKey(id: string): boolean {
  ensureTable();
  return Number(controlPlaneDatabase().prepare("DELETE FROM vessel_ssh_keys WHERE id = ?").run(id).changes) > 0;
}
