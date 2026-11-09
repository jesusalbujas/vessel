import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { authenticatedUser, mutationUser } from "@/lib/control-plane";
import { deleteSSHKey, listSSHKeys, saveSSHKey } from "@/lib/ssh-keys";

const execFileAsync = promisify(execFile);
function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } }); }

export function getSSHKeys(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return json({ error: "Authentication required" }, 401);
  if (user.role !== "administrator") return json({ error: "Administrator access required" }, 403);
  return json({ data: listSSHKeys() });
}

export async function postSSHKeys(request: Request) {
  const user = mutationUser(request);
  if (!user) return json({ error: "Authentication required" }, 401);
  if (user.role !== "administrator") return json({ error: "Administrator access required" }, 403);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || body.name.length > 80) return json({ error: "Enter a key name." }, 400);
  const directory = await mkdtemp(join(tmpdir(), "vessel-ssh-key-"));
  const path = join(directory, "identity");
  try {
    let keyType = "ed25519";
    if (body.action === "generate") {
      if (body.keyType !== "ed25519" && body.keyType !== "rsa") return json({ error: "Select Ed25519 or RSA." }, 400);
      keyType = body.keyType;
      const args = keyType === "rsa" ? ["-q", "-t", "rsa", "-b", "3072", "-N", "", "-C", body.name.trim(), "-f", path] : ["-q", "-t", "ed25519", "-N", "", "-C", body.name.trim(), "-f", path];
      await execFileAsync("ssh-keygen", args, { timeout: 10_000 });
    } else if (body.action === "import") {
      if (typeof body.privateKey !== "string" || body.privateKey.length < 80 || body.privateKey.length > 64_000 || !body.privateKey.includes("PRIVATE KEY")) return json({ error: "Enter a valid OpenSSH private key." }, 400);
      await writeFile(path, body.privateKey, { mode: 0o600 });
      const keyCheck = await execFileAsync("ssh-keygen", ["-y", "-P", "", "-f", path], { timeout: 10_000 });
      if (keyCheck.stdout.startsWith("ssh-rsa ")) keyType = "rsa";
      else if (keyCheck.stdout.startsWith("ssh-ed25519 ")) keyType = "ed25519";
      else keyType = "other";
    } else return json({ error: "Unknown SSH key action." }, 400);
    const privateKey = await readFile(path, "utf8");
    const publicKey = (await readFile(`${path}.pub`, "utf8").catch(async () => {
      const result = await execFileAsync("ssh-keygen", ["-y", "-P", "", "-f", path], { timeout: 10_000 });
      return result.stdout;
    })).trim();
    try {
      const data = saveSSHKey({ name: body.name, description: typeof body.description === "string" ? body.description.slice(0, 500) : "", publicKey, privateKey, keyType });
      return json({ data }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "An SSH key with that name already exists." }, 409);
      throw error;
    }
  } catch (error) {
    return json({ error: error instanceof Error && error.message.includes("passphrase") ? "Encrypted keys are not supported; use an unencrypted dedicated key." : "Could not generate or read the SSH key. Check that it is a valid unencrypted OpenSSH key." }, 400);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function deleteSSHKeys(request: Request) {
  const user = mutationUser(request);
  if (!user) return json({ error: "Authentication required" }, 401);
  if (user.role !== "administrator") return json({ error: "Administrator access required" }, 403);
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-f0-9-]{36}$/i.test(id)) return json({ error: "Invalid SSH key ID." }, 400);
  return json({ ok: deleteSSHKey(id) });
}
