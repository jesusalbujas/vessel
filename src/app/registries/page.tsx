"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Check, CircleAlert, CircleCheck, CircleHelp, Container, Eye, EyeOff, KeyRound, LoaderCircle, Plus, Search, ShieldCheck, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { RegistryProvider } from "@/lib/registries";
import "../globals.css";

type Registry = { id: string; name: string; url: string; baseUrl?: string | null; region?: string | null; username: string; provider: RegistryProvider; createdAt?: string };
type Feedback = { kind: "success" | "error" | "info"; text: string };
type Provider = { id: RegistryProvider; label: string; url?: string; description: { en: string; es: string }; username: { en: string; es: string }; secret: { en: string; es: string }; hint: { en: string; es: string } };

const providers: Provider[] = [
  { id: "dockerhub", label: "Docker Hub", url: "https://index.docker.io/v1/", description: { en: "Authenticate pulls from private Docker Hub repositories.", es: "Autentica descargas desde repositorios privados de Docker Hub." }, username: { en: "Docker Hub username", es: "Usuario de Docker Hub" }, secret: { en: "Personal access token", es: "Token de acceso personal" }, hint: { en: "Use a Docker Hub access token; avoid your account password.", es: "Usa un access token de Docker Hub; evita la contraseña de tu cuenta." } },
  { id: "ecr", label: "Amazon ECR", description: { en: "Vessel exchanges AWS IAM credentials for a short-lived ECR token when testing or pulling an image.", es: "Vessel intercambia las credenciales IAM de AWS por un token ECR temporal al probar o descargar una imagen." }, username: { en: "AWS access key ID", es: "AWS access key ID" }, secret: { en: "AWS secret access key", es: "AWS secret access key" }, hint: { en: "Use an IAM credential with ecr:GetAuthorizationToken and image pull permissions. Static IAM keys only; MFA/STS session tokens are not supported here.", es: "Usa una credencial IAM con ecr:GetAuthorizationToken y permisos para descargar imágenes. Solo claves IAM estáticas; no se admiten MFA ni tokens de sesión STS." } },
  { id: "digitalocean", label: "DigitalOcean Container Registry", url: "https://registry.digitalocean.com", description: { en: "Use your DigitalOcean account email and an API token.", es: "Usa el correo de DigitalOcean y un token de API." }, username: { en: "Email or registry username", es: "Correo o usuario del registry" }, secret: { en: "DigitalOcean API token", es: "Token de API de DigitalOcean" }, hint: { en: "The token must have permission to read the registry.", es: "El token debe tener permiso para leer el registry." } },
  { id: "github", label: "GitHub Container Registry", url: "https://ghcr.io", description: { en: "Authenticate to ghcr.io with a GitHub user and package token.", es: "Autentica en ghcr.io con un usuario de GitHub y token de paquetes." }, username: { en: "GitHub username", es: "Usuario de GitHub" }, secret: { en: "Personal access token", es: "Personal access token" }, hint: { en: "The token needs read:packages for image pulls.", es: "El token requiere read:packages para descargar imágenes." } },
  { id: "gitlab", label: "GitLab Container Registry", description: { en: "GitLab.com or a self-managed GitLab registry endpoint.", es: "Registry de GitLab.com o de una instalación propia." }, username: { en: "GitLab username or deploy-token name", es: "Usuario GitLab o nombre del deploy token" }, secret: { en: "Personal or deploy token", es: "Personal access token o deploy token" }, hint: { en: "Use read_registry permission. For self-managed GitLab, enter its registry host.", es: "Usa el permiso read_registry. Para GitLab propio, indica el host del registry." } },
  { id: "quay", label: "Quay.io", url: "https://quay.io", description: { en: "Use a Quay user or robot account and its token.", es: "Usa un usuario o robot de Quay y su token." }, username: { en: "Username or robot account", es: "Usuario o cuenta robot" }, secret: { en: "Robot token", es: "Token del robot" }, hint: { en: "For robot accounts, use the full robot username.", es: "Para una cuenta robot, escribe el nombre completo del robot." } },
  { id: "proget", label: "ProGet", description: { en: "Configure a Docker feed URL and its base server URL separately.", es: "Configura por separado la URL del feed Docker y la URL base del servidor." }, username: { en: "ProGet username", es: "Usuario de ProGet" }, secret: { en: "Password or API key", es: "Contraseña o API key" }, hint: { en: "Use credentials that can read the selected Docker feed.", es: "Usa credenciales con permiso de lectura sobre el feed Docker seleccionado." } },
  { id: "azure", label: "Azure Container Registry", description: { en: "Connect an Azure registry using service-principal credentials.", es: "Conecta Azure usando credenciales de un service principal." }, username: { en: "Application (client) ID", es: "Application (client) ID" }, secret: { en: "Client secret", es: "Client secret" }, hint: { en: "The service principal needs AcrPull (or equivalent read access).", es: "El service principal requiere AcrPull (o permiso equivalente de lectura)." } },
  { id: "generic", label: "Generic OCI / Docker registry", description: { en: "For private registries that accept standard username/password authentication.", es: "Para registries privados compatibles con autenticación estándar usuario/contraseña." }, username: { en: "Username", es: "Usuario" }, secret: { en: "Password or access token", es: "Contraseña o token de acceso" }, hint: { en: "Use an HTTPS endpoint. Self-signed certificates or custom CA trust must be configured in Docker Engine.", es: "Usa un endpoint HTTPS. Certificados propios requieren configurar la CA en Docker Engine." } },
];

const words = {
  en: { title: "Registries", subtitle: "Connect private image registries and reuse credentials in image pulls and container operations.", encryption: "Credentials encrypted at rest", add: "Add a registry", intro: "Choose the provider to show the credentials it needs.", name: "Connection name", nameHint: "A label to recognize this credential", endpoint: "Registry endpoint", feedUrl: "Docker feed URL", baseUrl: "ProGet base URL", region: "AWS region", registryHost: "Registry host", username: "Username", secret: "Token or password", showSecret: "Show secret", hideSecret: "Hide secret", test: "Test connection", testing: "Testing…", save: "Save registry", saving: "Saving…", available: "Available registries", builtIn: "Built-in", publicHub: "Docker Hub public access", publicHubHint: "Available for public images; no saved credentials.", configured: "Configured", testSaved: "Test", remove: "Delete", deleteTitle: "Delete registry?", deleteBody: "This removes the encrypted credentials from Vessel. It does not delete images or registry data.", cancel: "Cancel", confirmDelete: "Delete registry", noRegistries: "No private registry credentials have been saved.", noPermission: "Only administrators can add, test, or remove registry credentials.", loading: "Loading registries…", ecrNote: "ECR login tokens are short-lived. Vessel requests a fresh token from AWS when testing credentials or pulling an image; AWS credentials stay encrypted in Vessel.", success: "Credentials accepted by Docker Engine.", saveSuccess: "Registry saved securely.", deleteSuccess: "Registry deleted.", needDocker: "Docker Engine must be connected to test credentials.", testScope: "Tests whether Docker Engine accepts the credentials; it does not verify access to every repository.", tested: "Credentials accepted", failed: "Connection test failed", noMatch: "No registry matches this search.", actions: "Actions", provider: "Provider", account: "Account", endpointHint: "Used by Docker when matching image names", gitlabUrl: "Defaults to registry.gitlab.com; you can enter a self-managed host.", duplicateName: "Connection name is required." },
  es: { title: "Registries", subtitle: "Conecta registries privados y reutiliza sus credenciales al descargar imágenes y operar contenedores.", encryption: "Credenciales cifradas en reposo", add: "Añadir registry", intro: "Elige el proveedor para mostrar los datos que requiere.", name: "Nombre de la conexión", nameHint: "Una etiqueta para identificar estas credenciales", endpoint: "Endpoint del registry", feedUrl: "URL del feed Docker", baseUrl: "URL base de ProGet", region: "Región de AWS", registryHost: "Host del registry", username: "Usuario", secret: "Token o contraseña", showSecret: "Mostrar secreto", hideSecret: "Ocultar secreto", test: "Probar conexión", testing: "Probando…", save: "Guardar registry", saving: "Guardando…", available: "Registries disponibles", builtIn: "Integrado", publicHub: "Acceso público a Docker Hub", publicHubHint: "Disponible para imágenes públicas; no guarda credenciales.", configured: "Configurado", testSaved: "Probar", remove: "Eliminar", deleteTitle: "¿Eliminar registry?", deleteBody: "Se borrarán las credenciales cifradas de Vessel. No se eliminan imágenes ni datos del registry.", cancel: "Cancelar", confirmDelete: "Eliminar registry", noRegistries: "No hay credenciales de registries privados guardadas.", noPermission: "Solo los administradores pueden añadir, probar o eliminar credenciales.", loading: "Cargando registries…", ecrNote: "Los tokens ECR son temporales. Vessel solicita uno nuevo a AWS al probar credenciales o descargar una imagen; las credenciales AWS permanecen cifradas en Vessel.", success: "Docker Engine aceptó las credenciales.", saveSuccess: "Registry guardado de forma segura.", deleteSuccess: "Registry eliminado.", needDocker: "Docker Engine debe estar conectado para probar credenciales.", testScope: "Comprueba si Docker Engine acepta las credenciales; no verifica el acceso a cada repositorio.", tested: "Credenciales aceptadas", failed: "Falló la prueba de conexión", noMatch: "No hay registries que coincidan con la búsqueda.", actions: "Acciones", provider: "Proveedor", account: "Cuenta", endpointHint: "Docker lo usa para asociar credenciales al nombre de la imagen", gitlabUrl: "Por defecto usa registry.gitlab.com; puedes indicar un host propio.", duplicateName: "El nombre de la conexión es obligatorio." },
};

function token() { return typeof window === "undefined" ? "" : window.localStorage.getItem("vessel-token") ?? ""; }

export default function RegistriesPage() {
  const { language } = useI18n();
  const text = words[language];
  const [registries, setRegistries] = useState<Registry[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"test" | "save" | string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [providerId, setProviderId] = useState<RegistryProvider>("dockerhub");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Registry | null>(null);
  const provider = providers.find((item) => item.id === providerId) ?? providers[0];
  const hasCustomEndpoint = ["ecr", "gitlab", "azure", "generic", "proget"].includes(providerId);
  const hasProgetBase = providerId === "proget";
  const needsRegion = providerId === "ecr";
  const endpoint = hasCustomEndpoint ? url : provider.url ?? "";

  async function request(path: string, init?: RequestInit) {
    const response = await fetch(path, { ...init, headers: { ...(init?.body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token()}`, ...init?.headers }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error ?? `HTTP ${response.status}`);
    return payload;
  }

  async function load() {
    setLoading(true);
    try {
      const payload = await request("/api/registries");
      setRegistries(payload.data ?? []);
      setCanManage(Boolean(payload.canManage));
    } catch (error) {
      setFeedback({ kind: "error", text: error instanceof Error ? error.message : text.failed });
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => { setUrl(providerId === "gitlab" ? "https://registry.gitlab.com" : providerId === "generic" ? "https://" : ""); setBaseUrl(""); setRegion(""); }, [providerId]);

  const visibleRegistries = useMemo(() => registries.filter((item) => `${item.name} ${item.url} ${item.username} ${item.provider}`.toLowerCase().includes(search.toLowerCase())), [registries, search]);
  const canSubmit = canManage && Boolean(name.trim() && username.trim() && password && (!hasCustomEndpoint || url.trim()) && (!needsRegion || region.trim()) && (!hasProgetBase || baseUrl.trim()));
  const credentials = () => ({ provider: providerId, name: name.trim(), url: endpoint, baseUrl: hasProgetBase ? baseUrl : undefined, region: needsRegion ? region : undefined, username: username.trim(), password });

  async function testCurrent() {
    setBusy("test"); setFeedback(null);
    try { await request("/api/registries", { method: "POST", body: JSON.stringify({ action: "test", ...credentials() }) }); setFeedback({ kind: "success", text: text.success }); }
    catch (error) { setFeedback({ kind: "error", text: error instanceof Error ? error.message : text.failed }); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!name.trim()) { setFeedback({ kind: "error", text: text.duplicateName }); return; }
    setBusy("save"); setFeedback(null);
    try {
      const payload = await request("/api/registries", { method: "POST", body: JSON.stringify({ action: "save", ...credentials() }) });
      setRegistries((items) => [...items, payload.data]); setName(""); setUsername(""); setPassword("");
      setFeedback({ kind: "success", text: text.saveSuccess });
    } catch (error) { setFeedback({ kind: "error", text: error instanceof Error ? error.message : text.failed }); }
    finally { setBusy(null); }
  }

  async function testSaved(item: Registry) {
    setBusy(item.id); setFeedback(null);
    try { await request("/api/registries", { method: "POST", body: JSON.stringify({ action: "test_saved", id: item.id }) }); setFeedback({ kind: "success", text: `${item.name}: ${text.success}` }); }
    catch (error) { setFeedback({ kind: "error", text: `${item.name}: ${error instanceof Error ? error.message : text.failed}` }); }
    finally { setBusy(null); }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(deleteTarget.id); setFeedback(null);
    try { await request("/api/registries", { method: "DELETE", body: JSON.stringify({ id: deleteTarget.id }) }); setRegistries((items) => items.filter((item) => item.id !== deleteTarget.id)); setFeedback({ kind: "success", text: text.deleteSuccess }); setDeleteTarget(null); }
    catch (error) { setFeedback({ kind: "error", text: error instanceof Error ? error.message : text.failed }); }
    finally { setBusy(null); }
  }

  return <main className="module-main registries-page">
    <header className="module-header"><div><span className="module-kicker">DOCKER / {text.title.toUpperCase()}</span><h1>{text.title}</h1><p>{text.subtitle}</p></div><span className="module-header-badge"><ShieldCheck size={15} />{text.encryption}</span></header>
    <section className="module-panel registry-create-panel">
      <div className="module-section-title"><div><strong><Plus size={17} />{text.add}</strong><small>{text.intro}</small></div></div>
      {!canManage && !loading ? <div className="registry-permission"><ShieldCheck size={18} /><span>{text.noPermission}</span></div> : null}
      <div className="registry-provider-list" role="group" aria-label={text.provider}>{providers.map((item) => <button type="button" key={item.id} className={`registry-provider-option ${providerId === item.id ? "selected" : ""}`} onClick={() => { setProviderId(item.id); setFeedback(null); }} disabled={!canManage}><span className="registry-provider-icon">{item.id === "dockerhub" ? <Container size={17} /> : item.id === "generic" ? <CircleHelp size={17} /> : <KeyRound size={17} />}</span><span>{item.label}</span>{providerId === item.id ? <Check size={15} /> : null}</button>)}</div>
      <p className="registry-provider-description">{provider.description[language]}</p>
      {providerId === "ecr" ? <p className="registry-ecr-note"><CircleAlert size={14} />{text.ecrNote}</p> : null}
      <div className="registry-form-grid">
        <label>{text.name}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={language === "es" ? "Ej. Registry de producción" : "e.g. Production registry"} maxLength={120} disabled={!canManage} /><small>{text.nameHint}</small></label>
        {hasCustomEndpoint ? <label>{providerId === "azure" ? text.registryHost : hasProgetBase ? text.feedUrl : text.endpoint}<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder={providerId === "azure" ? "mycompany.azurecr.io" : providerId === "ecr" ? "123456789012.dkr.ecr.us-east-1.amazonaws.com" : providerId === "gitlab" ? "https://registry.gitlab.com" : providerId === "proget" ? "https://packages.example.com/v2/docker-feed" : "https://registry.example.com"} disabled={!canManage} /><small>{providerId === "gitlab" ? text.gitlabUrl : providerId === "proget" ? text.endpointHint : text.endpointHint}</small></label> : <div className="registry-endpoint-readonly"><span>{text.endpoint}</span><strong>{provider.url}</strong><small>{text.endpointHint}</small></div>}
        {hasProgetBase ? <label>{text.baseUrl}<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://packages.example.com" disabled={!canManage} /><small>{language === "es" ? "Mismo host que el feed, sin ruta." : "Same host as the feed, without a path."}</small></label> : null}
        {needsRegion ? <label>{text.region}<input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="us-east-1" autoComplete="off" disabled={!canManage} /><small>{language === "es" ? "Debe coincidir con la región incluida en el endpoint ECR." : "Must match the region in the ECR endpoint."}</small></label> : null}
        <label>{provider.username[language]}<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="off" placeholder={providerId === "quay" ? "my-robot+pull" : providerId === "azure" ? "00000000-0000-0000-0000-000000000000" : language === "es" ? "Usuario o robot" : "Username or robot"} disabled={!canManage} /></label>
        <label>{provider.secret[language]}<div className="registry-secret-field"><input value={password} onChange={(event) => setPassword(event.target.value)} type={showSecret ? "text" : "password"} autoComplete="new-password" placeholder={language === "es" ? "Pega el token de acceso" : "Paste access token"} disabled={!canManage} /><button type="button" aria-label={showSecret ? text.hideSecret : text.showSecret} onClick={() => setShowSecret((value) => !value)}>{showSecret ? <EyeOff size={16} /> : <Eye size={16} />}</button></div><small>{provider.hint[language]}</small></label>
      </div>
      <div className="registry-actions"><button className="secondary-button" type="button" onClick={testCurrent} disabled={!canSubmit || busy !== null}>{busy === "test" ? <LoaderCircle size={15} className="spinning" /> : <Activity size={15} />}{busy === "test" ? text.testing : text.test}</button><button className="primary-button" type="button" onClick={save} disabled={!canSubmit || busy !== null}>{busy === "save" ? <LoaderCircle size={15} className="spinning" /> : <Plus size={15} />}{busy === "save" ? text.saving : text.save}</button></div>
      <p className="registry-test-note"><CircleAlert size={14} />{text.testScope}</p>
    </section>

    {feedback ? <div className={`registry-feedback is-${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.kind === "success" ? <CircleCheck size={17} /> : feedback.kind === "error" ? <CircleAlert size={17} /> : <Activity size={17} />}{feedback.text}<button type="button" aria-label={text.cancel} onClick={() => setFeedback(null)}><X size={15} /></button></div> : null}

    <section className="module-panel registry-list-panel"><div className="module-section-title"><div><strong>{text.available}</strong><small>{registries.length} · {language === "es" ? "conexiones privadas guardadas" : "saved private connections"}</small></div><label className="registry-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={language === "es" ? "Buscar registry…" : "Search registries…"} /></label></div>
      <div className="registry-table-wrap"><table className="registry-table"><thead><tr><th>{text.name}</th><th>{text.provider}</th><th>URL</th><th>{text.account}</th><th>{text.actions}</th></tr></thead><tbody>
        <tr className="registry-public-row"><td><div className="registry-table-name"><span className="registry-table-icon"><Container size={16} /></span><span><strong>Docker Hub</strong><small>{text.publicHubHint}</small></span></div></td><td><span className="registry-provider-badge">{text.builtIn}</span></td><td>docker.io</td><td><span className="registry-public-state"><CircleCheck size={14} />{text.publicHub}</span></td><td>—</td></tr>
        {visibleRegistries.map((item) => <tr key={item.id}><td><div className="registry-table-name"><span className="registry-table-icon"><KeyRound size={16} /></span><span><strong>{item.name}</strong><small>{text.configured}</small></span></div></td><td><span className="registry-provider-badge">{providers.find((candidate) => candidate.id === item.provider)?.label ?? item.provider}</span></td><td className="registry-url-cell" title={item.url}>{item.url.replace(/^https?:\/\//, "")}</td><td>{item.provider === "ecr" ? (language === "es" ? `IAM · ${item.region ?? ""}` : `IAM · ${item.region ?? ""}`) : item.username}</td><td><div className="registry-row-actions"><button type="button" className="icon-action" title={text.testSaved} aria-label={`${text.testSaved}: ${item.name}`} onClick={() => void testSaved(item)} disabled={!canManage || busy !== null}>{busy === item.id ? <LoaderCircle size={15} className="spinning" /> : <Activity size={15} />}</button><button type="button" className="icon-action danger" title={text.remove} aria-label={`${text.remove}: ${item.name}`} onClick={() => setDeleteTarget(item)} disabled={!canManage || busy !== null}><Trash2 size={15} /></button></div></td></tr>)}
      </tbody></table></div>
      {loading ? <div className="registry-empty"><LoaderCircle size={18} className="spinning" />{text.loading}</div> : registries.length === 0 ? <div className="registry-empty"><KeyRound size={20} /><span>{text.noRegistries}</span></div> : visibleRegistries.length === 0 ? <div className="registry-empty"><Search size={18} />{text.noMatch}</div> : null}
    </section>

    {deleteTarget ? <div className="registry-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteTarget(null); }}><section className="registry-dialog" role="alertdialog" aria-modal="true" aria-labelledby="registry-delete-title"><span className="registry-dialog-icon"><Trash2 size={20} /></span><h2 id="registry-delete-title">{text.deleteTitle}</h2><p>{text.deleteBody}</p><strong>{deleteTarget.name}</strong><div><button className="secondary-button" type="button" onClick={() => setDeleteTarget(null)} disabled={busy !== null}><X size={15} />{text.cancel}</button><button className="danger-button registry-confirm-delete" type="button" onClick={() => void remove()} disabled={busy !== null}>{busy === deleteTarget.id ? <LoaderCircle size={15} className="spinning" /> : <Trash2 size={15} />}{text.confirmDelete}</button></div></section></div> : null}
  </main>;
}
