"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
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

  return <main className="module-main ssh-keys-page"><header className="module-header"><div><span className="module-kicker">VESSEL / {es ? "ACCESO REMOTO" : "REMOTE ACCESS"}</span><h1>{es ? "Claves SSH" : "SSH Keys"}</h1><p>{es ? "Administra las identidades SSH que Vessel usa para conectar servidores." : "Manage the SSH identities Vessel uses to connect to servers."}</p></div></header>
    <nav className="remote-section-nav"><a href="/servers">{es ? "Servidores" : "Servers"}</a><a className="active" href="/ssh-keys"><KeyRound size={15} />{es ? "Claves SSH" : "SSH keys"}</a></nav>
    {error ? <div className="ai-feedback is-error" role="alert"><CircleAlert size={16} />{error}</div> : null}
    <section className="module-panel ssh-key-create-panel"><div className="ai-section-head"><div><span className="ai-section-icon"><KeyRound size={19} /></span><div><h2>{es ? "Añadir una clave SSH" : "Add an SSH key"}</h2><p>{es ? "Genera una identidad dedicada o importa una clave OpenSSH sin frase de contraseña." : "Generate a dedicated identity or import an unencrypted OpenSSH key."}</p></div></div></div>
      <div className="ssh-key-form-fields"><label className="ai-field"><span>{es ? "Nombre" : "Name"}<b>*</b></span><input value={name} onChange={(event) => setName(event.target.value)} placeholder={es ? "Proyectos personales" : "Personal projects"} maxLength={80} /></label><label className="ai-field"><span>{es ? "Descripción" : "Description"}</span><input value={description} onChange={(event) => setDescription(event.target.value)} placeholder={es ? "Uso en mi servidor remoto" : "Used on my remote server"} maxLength={500} /></label></div>
      <div className="ssh-key-create-actions"><button className="primary-button ai-compact-button" type="button" onClick={() => void create("generate", "ed25519")} disabled={Boolean(busy) || !name.trim()}>{busy === "generate" ? <LoaderCircle size={15} className="spinning" /> : <Plus size={15} />}{es ? "Generar Ed25519" : "Generate Ed25519"}</button><button className="secondary-button ai-compact-button" type="button" onClick={() => void create("generate", "rsa")} disabled={Boolean(busy) || !name.trim()}>{busy === "generate" ? <LoaderCircle size={15} className="spinning" /> : <Plus size={15} />}{es ? "Generar RSA 3072" : "Generate RSA 3072"}</button><button className="secondary-button ai-compact-button" type="button" onClick={() => setImportOpen((open) => !open)}><KeyRound size={15} />{es ? "Importar clave" : "Import key"}</button></div>
      {importOpen ? <div className="ssh-key-import"><label className="ai-field"><span>{es ? "Clave privada OpenSSH" : "OpenSSH private key"}</span><textarea value={privateKey} onChange={(event) => setPrivateKey(event.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" autoComplete="off" spellCheck={false} /></label><button className="primary-button ai-compact-button" type="button" onClick={() => void create("import")} disabled={Boolean(busy) || !name.trim() || !privateKey.trim()}>{busy === "import" ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{es ? "Cifrar y guardar" : "Encrypt and save"}</button></div> : null}
    </section>
    <section className="ssh-key-list-section"><header className="ai-section-head"><div><span className="ai-section-icon"><ShieldCheck size={19} /></span><div><h2>{es ? "Claves disponibles" : "Available keys"}</h2><p>{es ? "Las claves privadas se cifran localmente y nunca se devuelven por la API." : "Private keys are encrypted locally and never returned by the API."}</p></div></div><span className="count-badge">{keys.length}</span></header>
      {loading ? <ContentLoadingSkeleton rows={2} label={es ? "Cargando claves SSH…" : "Loading SSH keys…"} /> : keys.length ? <div className="ssh-key-list">{keys.map((key) => <article className="ssh-key-card" key={key.id}><span className="ai-config-mark"><KeyRound size={18} /></span><div className="ssh-key-card-main"><div><strong>{key.name}</strong><span className="ssh-key-type">{key.keyType.toUpperCase()}</span></div>{key.description ? <small>{key.description}</small> : null}<code title={key.publicKey}>{key.publicKey}</code></div>{confirmId === key.id ? <><button className="danger-button" type="button" onClick={() => void remove(key.id)} disabled={busy === key.id}><Trash2 size={14} />{es ? "Confirmar" : "Confirm"}</button><button className="secondary-button" type="button" onClick={() => setConfirmId("")}>{es ? "Cancelar" : "Cancel"}</button></> : <button className="remote-icon-button is-danger" type="button" onClick={() => void remove(key.id)} aria-label={es ? "Eliminar clave" : "Delete key"}><Trash2 size={15} /></button>}</article>)}</div> : <div className="ai-empty-state"><KeyRound size={20} /><strong>{es ? "No hay claves SSH" : "No SSH keys found"}<span>{es ? "Genera o importa una para conectar servidores remotos." : "Generate or import one to connect remote servers."}</span></strong></div>}
    </section>
    <p className="ai-privacy-note"><ShieldCheck size={16} />{es ? "La clave privada se cifra con VESSEL_SECRET_KEY. Si pierdes esa clave maestra, las identidades guardadas no podrán recuperarse." : "Private keys are encrypted with VESSEL_SECRET_KEY. If that master key is lost, saved identities cannot be recovered."}</p>
  </main>;
}
