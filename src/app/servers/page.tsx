"use client";
import VesselSelect from "@/app/components/VesselSelect";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, CircleAlert, CircleCheck, Fingerprint, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Server, ShieldCheck, Trash2, X } from "lucide-react";
import { notifyVessel } from "@/app/components/ToastNotice";
import { useI18n } from "@/lib/i18n";

type RemoteServer = { id: string; name: string; host: string; port: number; username: string; fingerprint: string; createdAt: string; lastTestedAt: string | null };
type EngineInfo = { name: string; serverVersion: string; operatingSystem: string; architecture: string; nCPU: number; memTotal: number };
type ServerForm = { name: string; host: string; port: string; username: string; privateKey: string; sshKeyId: string; fingerprint: string; knownHost: string };
type SSHKey = { id: string; name: string; keyType: string; publicKey: string };
const emptyForm: ServerForm = { name: "", host: "", port: "22", username: "", privateKey: "", sshKeyId: "", fingerprint: "", knownHost: "" };

function localizedServerError(message: string, es: boolean) {
  const translations: Record<string, { es: string; en: string }> = {
    "SSH host fingerprint changed or does not match the verified fingerprint": { es: "La huella SSH cambió o no coincide con la que verificaste. Comprueba la identidad del servidor antes de continuar.", en: "The SSH fingerprint changed or does not match the one you verified. Check the server identity before continuing." },
    "SSH private key is invalid, encrypted, or unsupported; use an unencrypted OpenSSH private key": { es: "La clave privada no es válida, tiene frase de contraseña o no es compatible. Usa una clave OpenSSH dedicada sin frase de contraseña.", en: "The private key is invalid, encrypted, or unsupported. Use a dedicated unencrypted OpenSSH key." },
    "SSH host is unreachable or no SSH host key was returned": { es: "No se pudo alcanzar el host SSH o no devolvió una clave. Revisa host, puerto y conectividad desde el equipo de Vessel.", en: "The SSH host is unreachable or returned no host key. Check the host, port, and connectivity from the Vessel machine." },
    "SSH login failed or the user cannot access the remote Docker Engine": { es: "Falló la autenticación SSH o el usuario no tiene acceso al socket Docker remoto.", en: "SSH authentication failed or the user cannot access the remote Docker socket." },
    "could not read SSH host key": { es: "No se pudo consultar la huella SSH. Revisa el host, el puerto y la conexión desde el equipo de Vessel.", en: "Could not retrieve the SSH fingerprint. Check the host, port, and connectivity from the Vessel machine." },
    "Ya existe un servidor con ese nombre": { es: "Ya existe un servidor con ese nombre.", en: "A server with that name already exists." },
  };
  return translations[message]?.[es ? "es" : "en"] ?? message;
}

export default function ServersPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [sshKeys, setSSHKeys] = useState<SSHKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [fingerprinting, setFingerprinting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState("");
  const [removeId, setRemoveId] = useState("");
  const [error, setError] = useState("");
  const [localEngineName, setLocalEngineName] = useState("Engine Local");
  const [localEngineNameDraft, setLocalEngineNameDraft] = useState("Engine Local");
  const [editingLocalEngineName, setEditingLocalEngineName] = useState(false);
  const [savingLocalEngineName, setSavingLocalEngineName] = useState(false);
  const [canManage, setCanManage] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/servers", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudieron cargar los servidores." : "Could not load servers."));
      setServers(payload.data ?? []);
      const enginesResponse = await fetch("/api/engines", { cache: "no-store" });
      const enginesPayload = await enginesResponse.json();
      if (enginesResponse.ok) {
        const name = typeof enginesPayload.localEngineName === "string" ? enginesPayload.localEngineName : "Engine Local";
        setLocalEngineName(name);
        setLocalEngineNameDraft(name);
        setCanManage(enginesPayload.canManage === true);
      }
      const keysResponse = await fetch("/api/ssh-keys", { cache: "no-store" });
      const keysPayload = await keysResponse.json();
      if (keysResponse.ok) setSSHKeys(keysPayload.data ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (es ? "No se pudieron cargar los servidores." : "Could not load servers."));
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function saveLocalEngineName() {
    setSavingLocalEngineName(true);
    try {
      const response = await fetch("/api/engines", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ localEngineName: localEngineNameDraft }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudo cambiar el nombre." : "Could not update the name."));
      const name = payload.localEngineName as string;
      setLocalEngineName(name);
      setLocalEngineNameDraft(name);
      setEditingLocalEngineName(false);
      notifyVessel({ kind: "success", title: es ? "Nombre actualizado" : "Name updated" });
    } catch (cause) {
      notifyVessel({ kind: "error", title: cause instanceof Error ? cause.message : (es ? "No se pudo cambiar el nombre." : "Could not update the name.") });
    } finally {
      setSavingLocalEngineName(false);
    }
  }

  async function getFingerprint() {
    setFingerprinting(true); setError("");
    try {
      const response = await fetch("/api/servers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "fingerprint", host: form.host.trim(), port: Number(form.port) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudo consultar la huella SSH." : "Could not retrieve the SSH fingerprint."));
      setForm((current) => ({ ...current, fingerprint: payload.fingerprint, knownHost: payload.knownHost }));
    } catch (cause) { setError(cause instanceof Error ? localizedServerError(cause.message, es) : (es ? "Falló la consulta de la huella SSH." : "SSH fingerprint lookup failed.")); }
    finally { setFingerprinting(false); }
  }

  async function connect() {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/servers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "test", ...form, port: Number(form.port) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudo conectar con el servidor." : "Could not connect to the server."));
      setServers((current) => [...current.filter((server) => server.id !== payload.data.id), payload.data].sort((a, b) => a.name.localeCompare(b.name)));
      setForm(emptyForm); setFormOpen(false);
      const engine = payload.engine as EngineInfo;
      notifyVessel({ kind: "success", title: es ? "Servidor conectado" : "Server connected", detail: `${engine.name} · Docker ${engine.serverVersion}` });
    } catch (cause) { setError(cause instanceof Error ? localizedServerError(cause.message, es) : (es ? "No se pudo conectar con el servidor." : "Could not connect to the server.")); }
    finally { setSaving(false); }
  }

  async function retest(server: RemoteServer) {
    setTestingId(server.id);
    try {
      const response = await fetch("/api/servers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "retest", id: server.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "Falló la prueba SSH." : "SSH test failed."));
      await load();
      const engine = payload.engine as EngineInfo;
      notifyVessel({ kind: "success", title: es ? "Conexión verificada" : "Connection verified", detail: `${engine.name} · Docker ${engine.serverVersion}` });
    } catch (cause) { notifyVessel({ kind: "error", title: es ? "No se pudo conectar" : "Connection failed", detail: cause instanceof Error ? localizedServerError(cause.message, es) : undefined }); }
    finally { setTestingId(""); }
  }

  async function remove(server: RemoteServer) {
    if (removeId !== server.id) { setRemoveId(server.id); return; }
    try {
      const response = await fetch(`/api/servers?id=${encodeURIComponent(server.id)}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? (es ? "No se pudo quitar el servidor." : "Could not remove the server."));
      setServers((current) => current.filter((item) => item.id !== server.id)); setRemoveId("");
      notifyVessel({ kind: "success", title: es ? "Conexión eliminada" : "Connection removed" });
    } catch (cause) { notifyVessel({ kind: "error", title: es ? "No se pudo eliminar" : "Could not remove", detail: cause instanceof Error ? cause.message : undefined }); }
  }

  return <main className="module-main remote-servers-page">
    <header className="module-header"><div><span className="module-kicker">VESSEL · DOCKER ENGINES</span><h1>{es ? "Servidores" : "Servers"}</h1><p>{es ? "Conecta y verifica Engines Docker independientes mediante SSH." : "Connect and verify independent Docker Engines over SSH."}</p></div><div className="remote-header-actions"><Link className="secondary-button" href="/ssh-keys"><KeyRound size={15} />{es ? "Claves SSH" : "SSH keys"}</Link><button className="primary-button" type="button" onClick={() => { setFormOpen((value) => !value); setError(""); }}><Plus size={16} />{es ? "Conectar servidor" : "Connect server"}</button></div></header>
    <nav className="remote-section-nav"><a className="active" href="/servers"><Server size={15} />{es ? "Servidores" : "Servers"}</a><a href="/ssh-keys"><KeyRound size={15} />{es ? "Claves SSH" : "SSH keys"}</a></nav>

    <section className="remote-engine-local module-panel"><span className="remote-engine-icon"><Server size={22} /></span><div className="remote-engine-copy">{editingLocalEngineName ? <label className="local-engine-name-edit"><span>{es ? "Nombre del Engine local" : "Local Engine name"}</span><input autoFocus maxLength={80} value={localEngineNameDraft} onChange={(event) => setLocalEngineNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveLocalEngineName(); if (event.key === "Escape") { setLocalEngineNameDraft(localEngineName); setEditingLocalEngineName(false); } }} /></label> : <strong>{localEngineName}</strong>}<p>{es ? "El Docker Engine donde se ejecuta Vessel." : "The Docker Engine where Vessel is running."}</p></div>{editingLocalEngineName ? <span className="local-engine-edit-actions"><button className="remote-icon-button" type="button" onClick={() => { setLocalEngineNameDraft(localEngineName); setEditingLocalEngineName(false); }} disabled={savingLocalEngineName} aria-label={es ? "Cancelar edición" : "Cancel editing"}><X size={16} /></button><button className="remote-icon-button" type="button" onClick={() => void saveLocalEngineName()} disabled={savingLocalEngineName || !localEngineNameDraft.trim()} aria-label={es ? "Guardar nombre" : "Save name"}>{savingLocalEngineName ? <LoaderCircle size={16} className="spinning" /> : <Check size={16} />}</button></span> : canManage ? <button className="remote-icon-button" type="button" onClick={() => { setLocalEngineNameDraft(localEngineName); setEditingLocalEngineName(true); }} aria-label={es ? "Editar nombre del Engine local" : "Edit local Engine name"} title={es ? "Editar nombre" : "Edit name"}><Pencil size={15} /></button> : null}<span className="remote-engine-status"><i />{es ? "Predeterminado" : "Default"}</span></section>

    {formOpen ? <section className="module-panel remote-server-form-panel"><div className="remote-form-heading"><div><h2><Server size={19} />{es ? "Añadir servidor remoto" : "Add remote server"}</h2><p>{es ? "La clave privada se cifra antes de guardarse y nunca vuelve a mostrarse." : "The private key is encrypted before storage and is never shown again."}</p></div><button type="button" className="remote-icon-button" onClick={() => { setFormOpen(false); setForm(emptyForm); setError(""); }} aria-label={es ? "Cerrar" : "Close"}><X size={18} /></button></div>
      <div className="remote-server-fields">
        <label>{es ? "Nombre" : "Name"}<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={es ? "Producción · Este" : "Production · East"} maxLength={80} /></label>
        <label>{es ? "Host o dirección IP" : "Host or IP address"}<input value={form.host} onChange={(event) => setForm({ ...form, host: event.target.value })} placeholder="docker.example.net" autoCapitalize="off" spellCheck={false} /></label>
        <label>{es ? "Puerto SSH" : "SSH port"}<input type="number" min={1} max={65535} value={form.port} onChange={(event) => setForm({ ...form, port: event.target.value })} /></label>
        <label>{es ? "Usuario SSH" : "SSH user"}<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="deploy" autoCapitalize="off" spellCheck={false} /></label>
      </div>
      <div className="remote-fingerprint-row"><label><span><Fingerprint size={15} />{es ? "Huella de clave del host SSH" : "SSH host key fingerprint"}</span><input value={form.fingerprint} onChange={(event) => setForm({ ...form, fingerprint: event.target.value, knownHost: "" })} placeholder="SHA256:…" autoCapitalize="off" spellCheck={false} /></label><button className="secondary-button" type="button" onClick={() => void getFingerprint()} disabled={fingerprinting || !form.host.trim() || !form.port}>{fingerprinting ? <LoaderCircle size={15} className="spinning" /> : <Fingerprint size={15} />}{es ? "Obtener huella" : "Get fingerprint"}</button></div>
      {form.knownHost ? <div className="remote-trust-note"><ShieldCheck size={17} /><span>{es ? "Compara esta huella con la clave del servidor obtenida por un canal confiable antes de continuar:" : "Compare this fingerprint with the server key obtained through a trusted channel before continuing:"} <code>{form.fingerprint}</code><small>{es ? "En el servidor: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256 (compara con la huella obtenida)." : "On the server: ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub -E sha256 (compare it with the fingerprint above)."}</small></span></div> : null}
      {sshKeys.length ? <label className="remote-private-key"><span><KeyRound size={15} />{es ? "Clave SSH" : "SSH key"}</span><VesselSelect value={form.sshKeyId} onChange={(event) => setForm({ ...form, sshKeyId: event.target.value, privateKey: "" })}><option value="">{es ? "Selecciona una clave guardada…" : "Select a saved key…"}</option>{sshKeys.map((key) => <option key={key.id} value={key.id}>{key.name} · {key.keyType}</option>)}</VesselSelect></label> : <div className="remote-trust-note"><KeyRound size={16} /><span>{es ? "Primero agrega o genera una clave desde" : "Add or generate a key first in"} <Link href="/ssh-keys">{es ? "Claves SSH" : "SSH Keys"}</Link>.</span></div>}
      <p className="remote-ssh-hint">{es ? "El usuario SSH debe poder acceder al socket Docker remoto. Vessel no abre el puerto TCP de Docker." : "The SSH user must be able to access the remote Docker socket. Vessel does not expose Docker's TCP port."}</p>
      {error ? <div className="remote-server-error" role="alert"><CircleAlert size={16} />{error}</div> : null}
      <div className="remote-form-actions"><button className="secondary-button" type="button" onClick={() => { setFormOpen(false); setForm(emptyForm); setError(""); }} disabled={saving}>{es ? "Cancelar" : "Cancel"}</button><button className="primary-button" type="button" onClick={() => void connect()} disabled={saving || !form.name.trim() || !form.host.trim() || !form.username.trim() || (!form.privateKey.trim() && !form.sshKeyId) || !form.fingerprint || !form.knownHost}>{saving ? <LoaderCircle size={16} className="spinning" /> : <ShieldCheck size={16} />}{saving ? (es ? "Verificando SSH y Docker…" : "Verifying SSH and Docker…") : (es ? "Verificar y guardar" : "Verify and save")}</button></div>
    </section> : null}

    <section className="remote-servers-section"><div className="remote-servers-heading"><div><h2>{es ? "Servidores conectados" : "Connected servers"}</h2><p>{es ? "Cada conexión apunta a un Engine Docker independiente." : "Each connection points to an independent Docker Engine."}</p></div><span className="count-badge">{servers.length}</span></div>
      {loading ? <div className="remote-server-empty"><LoaderCircle size={18} className="spinning" />{es ? "Cargando conexiones…" : "Loading connections…"}</div> : !servers.length ? <div className="remote-server-empty"><Server size={20} /><strong>{es ? "Aún no hay servidores remotos" : "No remote servers yet"}</strong><span>{es ? "Conecta un host Docker por SSH para registrar su Engine." : "Connect a Docker host over SSH to register its Engine."}</span></div> : <div className="remote-server-grid">{servers.map((server) => <article className="remote-server-card" key={server.id}><div className="remote-server-card-head"><span className="remote-server-icon"><Server size={19} /></span><div><h3>{server.name}</h3><span>{server.username}@{server.host}:{server.port}</span></div><span className="remote-server-chip"><CircleCheck size={13} />{es ? "Verificado" : "Verified"}</span></div><div className="remote-server-fingerprint"><Fingerprint size={14} /><code title={server.fingerprint}>{server.fingerprint}</code></div><div className="remote-server-card-actions"><button className="secondary-button" type="button" onClick={() => void retest(server)} disabled={testingId === server.id}>{testingId === server.id ? <LoaderCircle size={15} className="spinning" /> : <RefreshCw size={15} />}{es ? "Probar conexión" : "Test connection"}</button>{removeId === server.id ? <><button className="danger-button" type="button" onClick={() => void remove(server)}><Trash2 size={14} />{es ? "Confirmar" : "Confirm"}</button><button className="remote-icon-button" type="button" onClick={() => setRemoveId("")} aria-label={es ? "Cancelar" : "Cancel"}><X size={16} /></button></> : <button className="remote-icon-button is-danger" type="button" onClick={() => void remove(server)} title={es ? "Quitar conexión" : "Remove connection"} aria-label={es ? "Quitar conexión" : "Remove connection"}><Trash2 size={16} /></button>}</div></article>)}</div>}
    </section>
    <p className="remote-server-roadmap"><CircleAlert size={15} />{es ? "Esta primera etapa registra y verifica Engines remotos. La selección del host para contenedores, Compose y despliegues se habilitará después de completar el enrutamiento de operaciones." : "This first stage registers and verifies remote Engines. Selecting a host for containers, Compose, and deployments will follow after operation routing is complete."}</p>
  </main>;
}
