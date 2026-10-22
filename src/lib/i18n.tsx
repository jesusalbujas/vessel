"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Language = "es" | "en";

const messages = {
  es: {
    language: "Idioma", english: "English", spanish: "Español", new_service: "Nuevo servicio",
    light: "Claro", dark: "Oscuro", find_environment: "Encuentra un ambiente sin recordar puertos",
    search_hint: "Busca por nombre, puerto o imagen.", registered_services: "servicios registrados", search: "Buscar",
    search_placeholder: "nombre, puerto o imagen...", clear_search: "Limpiar búsqueda", environment: "Ambiente", status: "Estado",
    all: "Todos", test: "Prueba", candidate: "Candidato", active: "Activos", inactive: "Inactivos",
    result: "resultado", results: "resultados", containers: "Contenedores", images: "Imágenes", volumes: "Volúmenes",
    networks: "Redes", download_image: "Descargar una imagen", download_image_help: "Agrega una imagen al inventario sin crear un contenedor.",
    docker_image: "Imagen Docker", download: "Descargar", applications: "Aplicaciones", databases: "Bases de datos",
    external_tools: "Herramientas externas", unknown: "Desconocido", checking: "Verificando salud", running: "Activo",
    stopped: "Inactivo", unhealthy: "Healthcheck fallido", no_available: "No disponible", starting: "Iniciando…",
    stop: "Detener", stopping: "Deteniendo…", restart: "Reiniciar", restarting: "Reiniciando…", recreate: "Recrear",
    recreating: "Recreando…", duplicate: "Duplicar", delete: "Borrar", logs: "Logs", labels: "Etiquetas",
    image: "Imagen", port: "Puerto", version: "Versión", database: "Base de datos", edit: "Editar", cancel: "Cancelar",
    confirm: "Confirmar", close: "Cerrar", variables: "Variables", container: "Contenedor", add_variable: "Agregar variable",
    fields: "Campos", paste_text: "Pegar texto", environment_variables: "Variables de entorno", optional_key_value: "Opcional · formato CLAVE=VALOR", no_variables: "No hay variables configuradas.",
    add_first_variable: "Agregar primera variable", clear: "Limpiar", vessel_action: "Acción de Vessel", confirm_action: "Confirmar acción",
    confirm_start: "iniciar", confirm_stop: "detener", confirm_restart: "reiniciar", confirm_recreate: "recrear",
    open_service: "Abrir servicio", unavailable: "No disponible", service_off: "Servicio apagado", initializing: "Iniciando…",
    stopping_action: "Deteniendo…", restarting_action: "Reiniciando…", recreating_action: "Recreando…", creating: "Creando…",
    applying_changes: "Aplicar cambios", copy_image: "Copiar imagen", no_database: "No configurada", no_network: "Sin red",
    no_tag: "Sin tag", policy: "Política de reinicio", max_retries: "Máximo de reintentos", registry: "Registry",
    image_tag: "Imagen / tag", public_port: "Puerto publicado", internal_port: "Puerto interno", container_name: "Nombre del contenedor",
    new_container_name: "Nombre del contenedor nuevo", preserve_current: "Conservar configuración actual", preserve_policy: "Conservar política actual",
    connected: "Conectando…", connect_container: "Conectar contenedor", disconnect_container: "Desconectar contenedor",
    no_images: "No hay imágenes que coincidan con el filtro.", no_networks: "No hay redes Docker disponibles.", loading_resources: "Cargando recursos Docker…",
    all_images: "Todas", untagged: "Sin tag", unused: "Sin uso", filter: "Filtro", total_images: "Total imágenes",
    select_results: "Seleccionar resultados", remove_selection: "Quitar selección", selected: "seleccionada(s)", delete_selected: "Borrar seleccionadas",
    action: "Acción de Vessel", retry_download: "Reintentar descarga",
  },
  en: {
    language: "Language", english: "English", spanish: "Español", new_service: "New service",
    light: "Light", dark: "Dark", find_environment: "Find an environment without remembering ports",
    search_hint: "Search by name, port, or image.", registered_services: "registered services", search: "Search",
    search_placeholder: "name, port, or image...", clear_search: "Clear search", environment: "Environment", status: "Status",
    all: "All", test: "Test", candidate: "Candidate", active: "Active", inactive: "Inactive",
    result: "result", results: "results", containers: "Containers", images: "Images", volumes: "Volumes",
    networks: "Networks", download_image: "Download an image", download_image_help: "Add an image to the inventory without creating a container.",
    docker_image: "Docker image", download: "Download", applications: "Applications", databases: "Databases",
    external_tools: "External tools", unknown: "Unknown", checking: "Checking health", running: "Running",
    stopped: "Stopped", unhealthy: "Healthcheck failed", no_available: "Unavailable", starting: "Starting…",
    stop: "Stop", stopping: "Stopping…", restart: "Restart", restarting: "Restarting…", recreate: "Recreate",
    recreating: "Recreating…", duplicate: "Duplicate", delete: "Delete", logs: "Logs", labels: "Labels",
    image: "Image", port: "Port", version: "Version", database: "Database", edit: "Edit", cancel: "Cancel",
    confirm: "Confirm", close: "Close", variables: "Variables", container: "Container", add_variable: "Add variable",
    fields: "Fields", paste_text: "Paste text", environment_variables: "Environment variables", optional_key_value: "Optional · KEY=VALUE format", no_variables: "No environment variables configured.",
    add_first_variable: "Add the first variable", clear: "Clear", vessel_action: "Vessel action", confirm_action: "Confirm action",
    confirm_start: "start", confirm_stop: "stop", confirm_restart: "restart", confirm_recreate: "recreate",
    open_service: "Open service", unavailable: "Unavailable", service_off: "Service stopped", initializing: "Starting…",
    stopping_action: "Stopping…", restarting_action: "Restarting…", recreating_action: "Recreating…", creating: "Creating…",
    applying_changes: "Apply changes", copy_image: "Copy image", no_database: "Not configured", no_network: "No network",
    no_tag: "Untagged", policy: "Restart policy", max_retries: "Maximum retries", registry: "Registry",
    image_tag: "Image / tag", public_port: "Published port", internal_port: "Internal port", container_name: "Container name",
    new_container_name: "New container name", preserve_current: "Keep current configuration", preserve_policy: "Keep current policy",
    connected: "Connecting…", connect_container: "Connect container", disconnect_container: "Disconnect container",
    no_images: "No images match the filter.", no_networks: "No Docker networks available.", loading_resources: "Loading Docker resources…",
    all_images: "All", untagged: "Untagged", unused: "Unused", filter: "Filter", total_images: "Total images",
    select_results: "Select results", remove_selection: "Remove selection", selected: "selected", delete_selected: "Delete selected",
    action: "Vessel action", retry_download: "Retry download",
  },
} as const;

export type TranslationKey = keyof typeof messages.en;
type I18nContextValue = { language: Language; setLanguage: (language: Language) => void; t: (key: TranslationKey) => string };
const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");
  useEffect(() => {
    const saved = window.localStorage.getItem("vessel-language") as Language | null;
    const browser = window.navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
    setLanguageState(saved === "es" || saved === "en" ? saved : browser);
  }, []);
  useEffect(() => {
    window.localStorage.setItem("vessel-language", language);
    document.documentElement.lang = language;
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage: (next: Language) => setLanguageState(next), t: (key: TranslationKey) => messages[language][key] }), [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
