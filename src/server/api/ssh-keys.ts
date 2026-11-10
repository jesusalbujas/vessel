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
  let stage: "generate" | "import" | "validate" | "read" | "save" = body.action === "import" ? "import" : "generate";
  try {
    let keyType = "ed25519";
    if (body.action === "generate") {
      if (body.keyType !== "ed25519" && body.keyType !== "rsa") return json({ error: "Select Ed25519 or RSA." }, 400);
      keyType = body.keyType;
      const args = keyType === "rsa" ? ["-q", "-t", "rsa", "-b", "3072", "-N", "", "-C", body.name.trim(), "-f", path] : ["-q", "-t", "ed25519", "-N", "", "-C", body.name.trim(), "-f", path];
      await execFileAsync("ssh-keygen", args, { timeout: 10_000 });
    } else if (body.action === "import") {
      if (typeof body.privateKey !== "string" || body.privateKey.length < 80 || body.privateKey.length > 64_000 || !body.privateKey.includes("PRIVATE KEY")) return json({ error: "Enter a valid OpenSSH private key." }, 400);
      await writeFile(path, `${body.privateKey.replace(/\r\n?/g, "\n").trim()}\n`, { mode: 0o600 });
      stage = "validate";
      const keyCheck = await execFileAsync("ssh-keygen", ["-y", "-P", "", "-f", path], { timeout: 10_000 });
      if (keyCheck.stdout.startsWith("ssh-rsa ")) keyType = "rsa";
      else if (keyCheck.stdout.startsWith("ssh-ed25519 ")) keyType = "ed25519";
      else keyType = "other";
    } else return json({ error: "Unknown SSH key action." }, 400);
    stage = "read";
    const privateKey = await readFile(path, "utf8");
    const publicKey = (await readFile(`${path}.pub`, "utf8").catch(async () => {
      const result = await execFileAsync("ssh-keygen", ["-y", "-P", "", "-f", path], { timeout: 10_000 });
      return result.stdout;
    })).trim();
    stage = "save";
    try {
      const data = saveSSHKey({ name: body.name, description: typeof body.description === "string" ? body.description.slice(0, 500) : "", publicKey, privateKey, keyType });
      return json({ data }, 201);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return json({ error: "An SSH key with that name already exists." }, 409);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const stderr = error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string" ? error.stderr.toLowerCase() : "";
    const diagnostic = `${message}\n${stderr}`;
    if (/passphrase|incorrect passphrase/i.test(diagnostic)) return json({ error: "Encrypted keys are not supported; use an unencrypted dedicated key." }, 400);
    if (message.includes("VESSEL_SECRET_KEY")) return json({ error: message }, 400);
    if (stage === "validate" && /invalid format|error in libcrypto|not a key file/.test(stderr)) {
      return json({ error: "The imported key is incomplete or not a valid OpenSSH private key. Copy the full text from BEGIN to END, without prompt text." }, 400);
    }
    const errorMessage = stage === "generate"
      ? "Could not generate the SSH key. Verify ssh-keygen is installed in the Vessel runtime."
      : stage === "import"
        ? "Could not write the imported SSH key to temporary storage. Check Vessel's temporary directory permissions."
        : stage === "validate"
          ? "Could not validate the imported SSH key. Use a valid, unencrypted OpenSSH private key."
        : stage === "read"
          ? "The SSH key was created, but Vessel could not read its key files."
          : "The SSH key was created, but Vessel could not encrypt or store it. Check the data volume and database permissions.";
    return json({ error: errorMessage }, 400);
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
