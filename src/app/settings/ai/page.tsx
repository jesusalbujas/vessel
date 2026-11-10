"use client";
import VesselSelect from "@/app/components/VesselSelect";

import { useEffect, useState } from "react";
import { Activity, Check, CircleAlert, ExternalLink, KeyRound, LoaderCircle, Plus, Power, RefreshCw, Settings2, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { SettingsNavigation } from "@/app/components/SettingsNavigation";
import { notifyVessel } from "@/app/components/ToastNotice";
import { useI18n } from "@/lib/i18n";
import { ContentLoadingSkeleton } from "@/app/components/LoadingSkeletons";
import "../../globals.css";

type Preset = { id: string; name: string; baseUrl: string };
type CustomProvider = { id: string; name: string; baseUrl: string; createdAt: string };
type Config = { id: string; name: string; provider: string; customProviderId: string | null; baseUrl: string; model: string; enabled: boolean; hasApiKey: boolean };
type ConfigForm = { name: string; provider: string; customProviderId: string; baseUrl: string; apiKey: string; model: string; enabled: boolean };
const blank: ConfigForm = { name: "", provider: "", customProviderId: "", baseUrl: "", apiKey: "", model: "", enabled: true };

export default function AISettingsPage() {
  const { language } = useI18n();
  const es = language === "es";
  const [presets, setPresets] = useState<Preset[]>([]);
  const [customProviders, setCustomProviders] = useState<CustomProvider[]>([]);
  const [configs, setConfigs] = useState<Config[]>([]);
  const [loading, setLoading] = useState(true);
  const [canManage, setCanManage] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [form, setForm] = useState<ConfigForm>(blank);
  const [customForm, setCustomForm] = useState({ name: "", baseUrl: "" });
  const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/ai", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setPresets(data.presets ?? []); setCustomProviders(data.customProviders ?? []); setConfigs(data.configurations ?? []); setCanManage(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo cargar la configuración de IA." : "Could not load AI settings."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  function choosePreset(provider: string) {
    const preset = presets.find((item) => item.id === provider);
    const custom = customProviders.find((item) => item.id === provider);
    setForm({ ...form, provider: custom ? "custom" : provider, customProviderId: custom?.id ?? "", name: custom?.name ?? preset?.name ?? "", baseUrl: custom?.baseUrl ?? preset?.baseUrl ?? "", model: "" });
    setModelSuggestions([]);
  }

  async function loadModels() {
    setModelsBusy(true); setError("");
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "list_models", provider: form.provider, baseUrl: form.baseUrl, apiKey: form.apiKey }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setModelSuggestions(data.models ?? []);
      if (!(data.models ?? []).length) notifyVessel({ kind: "info", title: es ? "El proveedor no devolvió modelos" : "Provider returned no models", detail: es ? "Puedes escribir el identificador manualmente." : "You can type the model identifier manually." });
      else notifyVessel({ kind: "success", title: es ? "Modelos cargados" : "Models loaded", detail: `${data.models.length} ${es ? "modelos disponibles" : "models available"}` });
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo consultar el catálogo de modelos." : "Could not load the model catalog."); }
    finally { setModelsBusy(false); }
  }

  async function saveCustomProvider() {
    setBusy("custom"); setError("");
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save_custom_provider", ...customForm }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setCustomForm({ name: "", baseUrl: "" }); setCustomOpen(false); await load();
      notifyVessel({ kind: "success", title: es ? "Proveedor personalizado guardado" : "Custom provider saved" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo guardar el proveedor." : "Could not save provider."); }
    finally { setBusy(""); }
  }

  async function testConnection() {
    setBusy("test"); setError("");
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "test", provider: form.provider, baseUrl: form.baseUrl, apiKey: form.apiKey, model: form.model }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      notifyVessel({ kind: "success", title: es ? "Conexión correcta" : "Connection successful", detail: data.message || undefined });
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo conectar con el proveedor." : "Could not connect to the provider."); }
    finally { setBusy(""); }
  }

  async function saveConfiguration() {
    setBusy("save"); setError("");
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save_configuration", ...form }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setConfigs((current) => [data.data, ...current.filter((item) => item.id !== data.data.id)]); setForm(blank); setFormOpen(false);
      notifyVessel({ kind: "success", title: es ? "Configuración de IA creada" : "AI configuration created" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : es ? "No se pudo guardar." : "Could not save configuration."); }
    finally { setBusy(""); }
  }

  async function deleteItem(action: "delete_configuration" | "delete_custom_provider", id: string) {
    const key = `${action}:${id}`;
    if (confirmDelete !== key) { setConfirmDelete(key); return; }
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setConfirmDelete(""); await load(); notifyVessel({ kind: "success", title: es ? "Elemento eliminado" : "Item removed" });
    } catch (cause) { notifyVessel({ kind: "error", title: es ? "No se pudo eliminar" : "Could not remove", detail: cause instanceof Error ? cause.message : undefined }); }
  }

  async function testSaved(id: string) {
    setBusy(`test:${id}`);
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "test_saved", id }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      notifyVessel({ kind: "success", title: es ? "Conexión correcta" : "Connection successful", detail: data.message || undefined });
    } catch (cause) { notifyVessel({ kind: "error", title: es ? "Falló la conexión" : "Connection failed", detail: cause instanceof Error ? cause.message : undefined }); }
    finally { setBusy(""); }
  }

  async function toggleEnabled(config: Config) {
    const nextEnabled = !config.enabled; setBusy(`toggle:${config.id}`);
    try {
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "set_enabled", id: config.id, enabled: nextEnabled }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setConfigs((current) => current.map((item) => item.id === config.id ? { ...item, enabled: nextEnabled } : item));
      notifyVessel({ kind: "success", title: nextEnabled ? (es ? "Funciones de IA habilitadas" : "AI features enabled") : (es ? "Funciones de IA deshabilitadas" : "AI features disabled") });
    } catch (cause) { notifyVessel({ kind: "error", title: es ? "No se pudo cambiar el estado" : "Could not change status", detail: cause instanceof Error ? cause.message : undefined }); }
    finally { setBusy(""); }
  }

  const providerOptions = customProviders.length ? customProviders.map((provider) => ({ id: provider.id, name: provider.name, baseUrl: provider.baseUrl, custom: true })) : presets.map((preset) => ({ ...preset, custom: false }));
  return <main className="module-main ai-settings-page">
    <header className="module-header"><div><span className="module-kicker">VESSEL / {es ? "PLATAFORMA" : "PLATFORM"}</span><h1>{es ? "Configuración de IA" : "AI settings"}</h1><p>{es ? "Configura proveedores para funciones asistidas y análisis de logs." : "Configure providers for AI features and deployment log analysis."}</p></div></header>
    <SettingsNavigation />
    {error ? <div className="ai-feedback is-error" role="alert"><CircleAlert size={16} />{error}</div> : null}
    {loading ? <ContentLoadingSkeleton rows={4} label={es ? "Cargando proveedores de IA…" : "Loading AI providers…"} /> : <>
      <section className="module-panel ai-configurations-panel"><header className="ai-section-head"><div><span className="ai-section-icon"><Sparkles size={19} /></span><div><h2>{es ? "Configuraciones de IA" : "AI configurations"}</h2><p>{es ? "Guarda una configuración por modelo o finalidad. Las claves API se cifran en SQLite." : "Save a configuration per model or use case. API keys are encrypted in SQLite."}</p></div></div><button type="button" className="primary-button ai-compact-button" onClick={() => { setFormOpen((open) => !open); setError(""); }} disabled={!canManage}><Plus size={16} />{es ? "Añadir IA" : "Add AI"}</button></header>
        {formOpen ? <div className="ai-form-card"><div className="ai-form-title"><div><h3>{es ? "Añadir IA" : "Add AI"}</h3><p>{es ? "Configura el endpoint, las credenciales y el modelo." : "Configure the endpoint, credentials, and model."}</p></div><button className="remote-icon-button" type="button" onClick={() => { setFormOpen(false); setForm(blank); }} aria-label={es ? "Cerrar" : "Close"}><X size={17} /></button></div>
          <label className="ai-field"><span>{es ? "Proveedor" : "Provider"}</span><VesselSelect value={form.customProviderId || form.provider} onChange={(event) => choosePreset(event.target.value)}><option value="">{es ? "Selecciona un proveedor…" : "Select a provider…"}</option>{providerOptions.map((provider) => <option value={provider.custom ? provider.id : provider.id} key={provider.id}>{provider.name}</option>)}</VesselSelect>{customProviders.length ? <small>{es ? "Hay proveedores personalizados; solo se pueden usar esos endpoints." : "Custom providers are defined; only those endpoints can be used."}</small> : <small>{es ? "La selección completa el nombre y la URL; puedes ajustarlos manualmente." : "This fills in the name and URL; you can edit them below."}</small>}</label>
          <div className="ai-form-grid"><label className="ai-field"><span>{es ? "Nombre" : "Name"}</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={es ? "Mi configuración OpenAI" : "My OpenAI config"} /></label><label className="ai-field"><span>{es ? "URL de API" : "API URL"}</span><input value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" autoCapitalize="off" spellCheck={false} /></label><label className="ai-field"><span><KeyRound size={14} />{es ? "Clave API" : "API key"}</span><input type="password" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="sk-…" autoComplete="new-password" /></label><div className="ai-model-field"><label className="ai-field"><span>{es ? "Modelo" : "Model"}</span><input list="vessel-ai-model-suggestions" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder={es ? "Escribe o selecciona un modelo" : "Type or select a model"} /><datalist id="vessel-ai-model-suggestions">{modelSuggestions.map((model) => <option value={model} key={model} />)}</datalist><small>{modelSuggestions.length ? es ? `${modelSuggestions.length} modelos leídos desde el proveedor; también puedes escribir otro.` : `${modelSuggestions.length} models loaded from provider; you can also type another.` : es ? "Puedes escribir un identificador o cargar el catálogo del proveedor." : "Type a model identifier or load the provider catalog."}</small></label><button className="secondary-button ai-compact-button" type="button" onClick={() => void loadModels()} disabled={modelsBusy || !form.provider || !form.baseUrl || !form.apiKey}>{modelsBusy ? <LoaderCircle size={14} className="spinning" /> : <RefreshCw size={14} />}{es ? "Cargar modelos" : "Load models"}</button></div></div>
          <label className="ai-toggle"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /><span><strong>{es ? "Habilitar funciones de IA" : "Enable AI features"}</strong><small>{es ? "Permite usar esta configuración para analizar logs." : "Allow this configuration to analyze deployment logs."}</small></span></label>
          {error ? <div className="ai-feedback is-error"><CircleAlert size={15} />{error}</div> : null}
          <div className="ai-form-actions"><button type="button" className="secondary-button" onClick={() => void testConnection()} disabled={busy !== "" || !form.provider || !form.apiKey || !form.model}>{busy === "test" ? <LoaderCircle size={15} className="spinning" /> : <Activity size={15} />}{es ? "Probar conexión" : "Test connection"}</button><button type="button" className="primary-button ai-compact-button" onClick={() => void saveConfiguration()} disabled={busy !== "" || !form.provider || !form.name.trim() || !form.baseUrl.trim() || !form.model.trim() || !form.apiKey}>{busy === "save" ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{es ? "Crear" : "Create"}</button></div>
        </div> : null}
        {configs.length ? <div className="ai-config-list">{configs.map((config) => { const deleteKey = `delete_configuration:${config.id}`; return <article className="ai-config-card" key={config.id}><span className="ai-config-mark"><Sparkles size={18} /></span><div className="ai-config-info"><strong>{config.name}</strong><span>{config.provider === "custom" ? customProviders.find((provider) => provider.id === config.customProviderId)?.name ?? (es ? "Personalizado" : "Custom") : presets.find((provider) => provider.id === config.provider)?.name ?? config.provider} · {config.model}</span><small>{config.baseUrl}</small></div><span className={`ai-config-state ${config.enabled ? "is-enabled" : ""}`}>{config.enabled ? es ? "Habilitada" : "Enabled" : es ? "Deshabilitada" : "Disabled"}</span><button className="secondary-button" type="button" onClick={() => void toggleEnabled(config)} disabled={busy !== ""} data-tooltip={config.enabled ? (es ? "Deshabilitar análisis con esta configuración." : "Disable analysis with this configuration.") : (es ? "Habilitar análisis con esta configuración." : "Enable analysis with this configuration.")}>{busy === `toggle:${config.id}` ? <LoaderCircle size={14} className="spinning" /> : <Power size={14} />}{config.enabled ? (es ? "Deshabilitar" : "Disable") : (es ? "Habilitar" : "Enable")}</button><button className="secondary-button" type="button" onClick={() => void testSaved(config.id)} disabled={busy !== ""}>{busy === `test:${config.id}` ? <LoaderCircle size={14} className="spinning" /> : <Activity size={14} />}{es ? "Probar" : "Test"}</button>{confirmDelete === deleteKey ? <><button className="danger-button" type="button" onClick={() => void deleteItem("delete_configuration", config.id)}>{es ? "Confirmar" : "Confirm"}</button><button className="remote-icon-button" type="button" onClick={() => setConfirmDelete("")} aria-label={es ? "Cancelar" : "Cancel"}><X size={15} /></button></> : <button className="remote-icon-button is-danger" type="button" onClick={() => void deleteItem("delete_configuration", config.id)} aria-label={es ? "Eliminar configuración" : "Delete configuration"}><Trash2 size={15} /></button>}</article>; })}</div> : <div className="ai-empty-state"><Sparkles size={20} /><strong>{es ? "No hay configuraciones de IA" : "You don't have any AI configurations"}<span>{es ? "Añade una para habilitar el análisis de logs." : "Add one to enable log analysis."}</span></strong></div>}
      </section>
      <section className="module-panel ai-custom-panel"><header className="ai-section-head"><div><span className="ai-section-icon"><Settings2 size={19} /></span><div><h2>{es ? "Proveedores de IA personalizados" : "Custom AI providers"}</h2><p>{es ? "Define endpoints propios, como una plataforma LLM interna. Si agregas uno, las nuevas configuraciones usarán solo estos proveedores." : "Define your own AI endpoints, such as an internal LLM platform. When at least one is defined, new AI configurations can use only these providers."}</p></div></div><button type="button" className="secondary-button ai-compact-button" onClick={() => setCustomOpen((open) => !open)}><Plus size={15} />{es ? "Añadir proveedor" : "Add provider"}</button></header>
        {customOpen ? <div className="ai-custom-form"><label className="ai-field"><span>{es ? "Nombre del proveedor" : "Provider name"}</span><input value={customForm.name} onChange={(event) => setCustomForm({ ...customForm, name: event.target.value })} placeholder={es ? "LLM interno" : "Internal LLM"} /></label><label className="ai-field"><span>{es ? "URL base de API compatible con OpenAI" : "OpenAI-compatible API base URL"}</span><input value={customForm.baseUrl} onChange={(event) => setCustomForm({ ...customForm, baseUrl: event.target.value })} placeholder="https://llm.internal.example/v1" autoCapitalize="off" /></label><button type="button" className="primary-button ai-compact-button" onClick={() => void saveCustomProvider()} disabled={busy !== "" || !customForm.name.trim() || !customForm.baseUrl.trim()}>{busy === "custom" ? <LoaderCircle size={15} className="spinning" /> : <Check size={15} />}{es ? "Guardar" : "Save"}</button></div> : null}
        {customProviders.length ? <div className="ai-custom-list">{customProviders.map((provider) => { const deleteKey = `delete_custom_provider:${provider.id}`; return <article key={provider.id}><span className="ai-config-mark"><ExternalLink size={17} /></span><div><strong>{provider.name}</strong><small>{provider.baseUrl}</small></div>{confirmDelete === deleteKey ? <><button className="danger-button" type="button" onClick={() => void deleteItem("delete_custom_provider", provider.id)}>{es ? "Confirmar" : "Confirm"}</button><button className="remote-icon-button" type="button" onClick={() => setConfirmDelete("")} aria-label={es ? "Cancelar" : "Cancel"}><X size={15} /></button></> : <button className="remote-icon-button is-danger" type="button" onClick={() => void deleteItem("delete_custom_provider", provider.id)} aria-label={es ? "Eliminar proveedor" : "Delete provider"}><Trash2 size={15} /></button>}</article>; })}</div> : <div className="ai-custom-empty"><ShieldCheck size={18} /><span><strong>{es ? "No hay proveedores personalizados" : "No custom providers defined"}</strong><small>{es ? "Se utilizará la lista integrada de proveedores." : "The built-in provider list will be used."}</small></span></div>}
      </section>
      <p className="ai-privacy-note"><ShieldCheck size={16} />{es ? "Las claves API no se muestran después de guardar. Al solicitar un análisis, solo se enviarán al proveedor los logs de esa ejecución, con patrones comunes de credenciales redactados." : "API keys are never shown again after saving. When you request an analysis, only that deployment's logs are sent to the provider, with common credential patterns redacted."}</p>
    </>}
  </main>;
}
