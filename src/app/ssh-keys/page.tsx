"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Copy, Download, HelpCircle, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { notifyVessel } from "@/app/components/ToastNotice";
import { useI18n } from "@/lib/i18n";
import { ContentLoadingSkeleton } from "@/app/components/LoadingSkeletons";
import "../globals.css";

type SSHKey = { id: string; name: string; description: string; publicKey: string; keyType: string; createdAt: string };

export default function SSHKeysPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [keys, setKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [busy, setBusy] = useState("");
  const [confirmId, setConfirmId] = useState("");
  const [error, setError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [localKeyName, setLocalKeyName] = useState("vessel-server");
  const [remoteUser, setRemoteUser] = useState("vessel");
  const [remoteHost, setRemoteHost] = useState("");
  const [remotePort, setRemotePort] = useState("22");
  const safeKeyName = localKeyName.trim();
  const validKeyName = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(safeKeyName);
  const validPort = /^\d+$/.test(remotePort) && Number(remotePort) >= 1 && Number(remotePort) <= 65535;
  const target = remoteUser.trim() && remoteHost.trim() ? shellQuote(`${remoteUser.trim()}@${remoteHost.trim()}`) : "";
  const keyPath = `~/.ssh/${safeKeyName}`;
  const sshPortArgs = `-p ${validPort ? remotePort : "22"}`;
  const generatedCommands = validKeyName ? [
    { title: es ? "1. Crear una clave Ed25519 en tu equipo" : "1. Create an Ed25519 key on your computer", command: `ssh-keygen -t ed25519 -f ${keyPath} -C ${shellQuote(safeKeyName)}` },
    { title: es ? "2. Instalar la clave pública en el servidor" : "2. Install the public key on the server", command: target && validPort ? `ssh-copy-id -i ${keyPath}.pub ${sshPortArgs} ${target}` : "" },
    { title: es ? "3. Mostrar solo la clave pública" : "3. Display only the public key", command: `cat ${keyPath}.pub` },
    { title: es ? "4. Consultar la huella del servidor" : "4. Read the server fingerprint", command: target && validPort ? `ssh ${sshPortArgs} ${target} 'for f in /etc/ssh/ssh_host_*_key.pub; do [ -f "$f" ] && ssh-keygen -lf "$f" -E sha256; done'` : "" },
    { title: es ? "5. Comprobar acceso al Engine Docker" : "5. Check Docker Engine access", command: target && validPort ? `ssh -i ${keyPath} ${sshPortArgs} ${target} 'docker info'` : "" },
  ].filter((item) => item.command) : [];

  function shellQuote(value: string) { return `'${value.replace(/'/g, `'\\''`)}'`; }
  async function copyText(value: string, title: string) {
    try { await navigator.clipboard.writeText(value); notifyVessel({ kind: "success", title }); }
    catch { notifyVessel({ kind: "error", title: es ? "No se pudo copiar" : "Could not copy" }); }
  }
  function downloadCommands() {
    if (!generatedCommands.length) return;
    const content = ["#!/usr/bin/env bash", "# Run each command in order from your local terminal.", ...generatedCommands.map((item) => `\n# ${item.title}\n${item.command}`)].join("\n");
    const url = URL.createObjectURL(new Blob([content, "\n"], { type: "text/x-shellscript;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `vessel-ssh-${safeKeyName}.sh`; anchor.click(); URL.revokeObjectURL(url);
    notifyVessel({ kind: "success", title: es ? "Comandos descargados" : "Commands downloaded" });
  }

  async function load() {
    setLoading(true);
    try { const response = await fetch("/api/ssh-keys", { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setKeys(data.data ?? []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudieron cargar las claves." : "Could not load SSH keys."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  async function create(action: "generate" | "import", keyType?: "ed25519" | "rsa") {
    setBusy(action); setError("");
    try {
      const response = await fetch("/api/ssh-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, name, description, keyType, privateKey }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setKeys((current) => [...current.filter((key) => key.id !== data.data.id), data.data].sort((a, b) => a.name.localeCompare(b.name)));
      setName(""); setDescription(""); setPrivateKey(""); setImportOpen(false);
      notifyVessel({ kind: "success", title: es ? "Clave SSH guardada" : "SSH key saved", detail: es ? "La clave privada quedó cifrada y no se volverá a mostrar." : "The private key is encrypted and will not be shown again." });
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo guardar la clave." : "Could not save the key."); }
    finally { setBusy(""); }
  }

  async function remove(id: string) {
    if (confirmId !== id) { setConfirmId(id); return; }
    setBusy(id);
    try { const response = await fetch(`/api/ssh-keys?id=${encodeURIComponent(id)}`, { method: "DELETE" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setKeys((current) => current.filter((key) => key.id !== id)); setConfirmId(""); notifyVessel({ kind: "success", title: es ? "Clave SSH eliminada" : "SSH key removed" }); }
    catch (cause) { notifyVessel({ kind: "error", title: es ? "No se pudo eliminar" : "Could not remove", detail: cause instanceof Error ? cause.message : undefined }); }
    finally { setBusy(""); }
  }

  return <main className="module-main ssh-keys-page"><header className="module-header"><div><span className="module-kicker">VESSEL / {es ? "ACCESO REMOTO" : "REMOTE ACCESS"}</span><h1>{es ? "Claves SSH" : "SSH Keys"}</h1><p>{es ? "Administra las identidades SSH que Vessel usa para conectar servidores." : "Manage the SSH identities Vessel uses to connect to servers."}</p></div><button className="secondary-button" type="button" onClick={() => setHelpOpen(true)}><HelpCircle size={15} />{es ? "Ayuda de conexión" : "Connection help"}</button></header>
    <nav className="remote-section-nav"><a href="/servers">{es ? "Servidores" : "Servers"}</a><a className="active" href="/ssh-keys"><KeyRound size={15} />{es ? "Claves SSH" : "SSH keys"}</a></nav>
    {error ? <div className="ai-feedback is-error" role="alert"><CircleAlert size={16} />{error}</div> : null}
    <section className="module-panel ssh-key-create-panel"><div className="ai-section-head"><div><span className="ai-section-icon"><KeyRound size={19} /></span><div><h2>{es ? "Añadir una clave SSH" : "Add an SSH key"}</h2><p>{es ? "Genera una identidad dedicada o importa una clave OpenSSH sin frase de contraseña." : "Generate a dedicated identity or import an unencrypted OpenSSH key."}</p></div></div></div>
      <div className="ssh-key-form-fields"><label className="ai-field"><span>{es ? "Nombre" : "Name"}<b>*</b></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={es ? "Proyectos personales" : "Personal projects"} maxLength={80} /></label><label className="ai-field"><span>{es ? "Descripción" : "Description"}</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={es ? "Uso en mi servidor remoto" : "Used on my remote server"} maxLength={500} /></label></div>
      <div className="ssh-key-create-actions"><button className="primary-button ai-compact-button" type="button" onClick={() => void create("generate", "ed25519")} disabled={Boolean(busy) || !name.trim()}>{busy === "generate" ? <LoaderCircle size={15} className="spinning" /> : <Plus size={15} />}{es ? "Generar Ed25519" : "Generate Ed25519"}</button><button className="secondary-button ai-compact-button" type="button" onClick={() => void create("generate", "rsa")} disabled={Boolean(busy) || !name.trim()}>{busy === "generate" ? <LoaderCircle size={15} className="spinning" /> : <Plus size={15} />}{es ? "Generar RSA 3072" : "Generate RSA 3072"}</button><button className="secondary-button ai-compact-button" type="button" onClick={() => setImportOpen((open) => !open)}><KeyRound size={15} />{es ? "Importar clave" : "Import key"}</button></div>
      {importOpen ? <div className="ssh-key-import"><label className="ai-field"><span>{es ? "Clave privada OpenSSH" : "OpenSSH private key"}</span><textarea value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" autoComplete="off" spellCheck={false} /></label><button className="primary-button ai-compact-button" type="button" onClick={() => void create("import")} disabled={Boolean(busy) || !name.trim() || !privateKey.trim()}>{busy === "import" ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{es ? "Cifrar y guardar" : "Encrypt and save"}</button></div> : null}
    </section>
    <section className="ssh-key-list-section"><header className="ai-section-head"><div><span className="ai-section-icon"><ShieldCheck size={19} /></span><div><h2>{es ? "Claves disponibles" : "Available keys"}</h2><p>{es ? "Las claves privadas se cifran localmente y nunca se devuelven por la API." : "Private keys are encrypted locally and never returned by the API."}</p></div></div><span className="count-badge">{keys.length}</span></header>
      {loading ? <ContentLoadingSkeleton rows={2} label={es ? "Cargando claves SSH…" : "Loading SSH keys…"} /> : keys.length ? <div className="ssh-key-list">{keys.map((key) => <article className="ssh-key-card" key={key.id}><span className="ai-config-mark"><KeyRound size={18} /></span><div className="ssh-key-card-main"><div><strong>{key.name}</strong><span className="ssh-key-type">{key.keyType.toUpperCase()}</span></div>{key.description ? <small>{key.description}</small> : null}<code title={key.publicKey}>{key.publicKey}</code></div><button className="secondary-button ssh-key-copy-button" type="button" onClick={() => void copyText(key.publicKey, es ? "Clave pública copiada" : "Public key copied")}><Copy size={14} />{es ? "Copiar pública" : "Copy public key"}</button>{confirmId === key.id ? <><button className="danger-button" type="button" onClick={() => void remove(key.id)} disabled={busy === key.id}><Trash2 size={14} />{es ? "Confirmar" : "Confirm"}</button><button className="secondary-button" type="button" onClick={() => setConfirmId("")}>{es ? "Cancelar" : "Cancel"}</button></> : <button className="remote-icon-button is-danger" type="button" onClick={() => void remove(key.id)} aria-label={es ? "Eliminar clave" : "Delete key"}><Trash2 size={15} /></button>}</article>)}</div> : <div className="ai-empty-state"><KeyRound size={20} /><strong>{es ? "No hay claves SSH" : "No SSH keys found"}<span>{es ? "Genera o importa una para conectar servidores remotos." : "Generate or import one to connect remote servers."}</span></strong></div>}
    </section>
    <p className="ai-privacy-note"><ShieldCheck size={16} />{es ? "La clave privada se cifra con VESSEL_SECRET_KEY. Si pierdes esa clave maestra, las identidades guardadas no podrán recuperarse." : "Private keys are encrypted with VESSEL_SECRET_KEY. If that master key is lost, saved identities cannot be recovered."}</p>
    {helpOpen ? <div className="modal-backdrop remote-help-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}><section className="confirm-modal remote-help-modal" role="dialog" aria-modal="true" aria-labelledby="ssh-help-title"><header className="remote-help-modal-heading"><div><span className="modal-kicker"><HelpCircle size={15} />{es ? "ACCESO REMOTO" : "REMOTE ACCESS"}</span><h2 id="ssh-help-title">{es ? "Comandos para conectar por SSH" : "Commands to connect over SSH"}</h2><p>{es ? "Genera los comandos para tu terminal local. La clave privada queda en tu equipo; solo se envía la clave pública al servidor." : "Generate commands for your local terminal. The private key stays on your computer; only the public key is sent to the server."}</p></div><button type="button" className="remote-icon-button" onClick={() => setHelpOpen(false)} aria-label={es ? "Cerrar" : "Close"}><X size={18} /></button></header>
      <div className="ssh-help-fields ssh-help-command-fields"><label>{es ? "Nombre del archivo de clave local" : "Local key file name"}<input value={localKeyName} onChange={(event) => setLocalKeyName(event.target.value)} placeholder="vessel-server" autoCapitalize="off" spellCheck={false} /><small>{es ? "Se guardará en ~/.ssh/" : "Saved under ~/.ssh/"}</small></label><label>{es ? "Usuario SSH remoto" : "Remote SSH user"}<input value={remoteUser} onChange={(event) => setRemoteUser(event.target.value)} placeholder="vessel" autoCapitalize="off" spellCheck={false} /></label><label>{es ? "Host o IP" : "Host or IP"}<input value={remoteHost} onChange={(event) => setRemoteHost(event.target.value)} placeholder="docker.example.test" autoCapitalize="off" spellCheck={false} /></label><label>{es ? "Puerto SSH" : "SSH port"}<input type="number" min="1" max="65535" value={remotePort} onChange={(event) => setRemotePort(event.target.value)} /></label></div>
      <div className="ssh-command-list">{generatedCommands.map((item) => <article className="ssh-command-card" key={item.title}><div><strong>{item.title}</strong><button className="secondary-button" type="button" onClick={() => void copyText(item.command, es ? "Comando copiado" : "Command copied")}><Copy size={14} />{es ? "Copiar" : "Copy"}</button></div><code>{item.command}</code></article>)}</div>
      <div className="remote-setup-warning"><ShieldCheck size={15} /><span>{es ? "Nunca compartas ni copies el archivo privado ~/.ssh/" : "Never share or copy the private file ~/.ssh/"}<code>{safeKeyName}</code>{es ? ". Solo el archivo .pub se instala en el servidor. Compara la huella del host por un canal confiable antes de aceptar la conexión." : ". Only the .pub file is installed on the server. Verify the host fingerprint through a trusted channel before accepting the connection."}</span></div>
      <footer className="modal-actions"><button type="button" onClick={() => setHelpOpen(false)}><X size={14} />{es ? "Cerrar" : "Close"}</button><button className="secondary-button" type="button" onClick={downloadCommands} disabled={!generatedCommands.length}><Download size={14} />{es ? "Descargar comandos" : "Download commands"}</button></footer>
    </section></div> : null}
  </main>;
}
