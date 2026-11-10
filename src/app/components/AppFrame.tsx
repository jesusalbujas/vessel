"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Languages, LoaderCircle, Moon, Server, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import VesselSelect from "@/app/components/VesselSelect";
import { Sidebar } from "./Sidebar";
import { ToastNotice, VESSEL_NOTICE_EVENT, type Notice } from "./ToastNotice";
import { VesselTooltipLayer } from "./VesselTooltipLayer";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { language, setLanguage } = useI18n();
  const [dark, setDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [remoteServers, setRemoteServers] = useState<Array<{ id: string; name: string; host: string }>>([]);
  const [engineId, setEngineId] = useState("local");
  const [localEngineName, setLocalEngineName] = useState("Engine Local");
  const [engineSwitching, setEngineSwitching] = useState(false);
  const engineSwitchTimer = useRef<number | null>(null);

  useEffect(() => {
    // Remove tokens stored by older versions; browser sessions now use HttpOnly cookies.
    window.localStorage.removeItem("vessel-token");
    if (pathname !== "/login") {
      const savedEngine = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-engine-id="))?.slice("vessel-engine-id=".length);
      fetch("/api/engines", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("No se pudieron cargar los servidores");
        const payload = await response.json() as { data?: Array<{ id: string; name: string; host: string }>; localEngineName?: string };
        const servers = payload.data ?? [];
        if (payload.localEngineName) setLocalEngineName(payload.localEngineName);
        setRemoteServers(servers);
        const selected = savedEngine ? decodeURIComponent(savedEngine) : "local";
        if (selected !== "local" && servers.some((server) => server.id === selected)) setEngineId(selected);
        else if (selected !== "local") document.cookie = `vessel-engine-id=local; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      }).catch(() => {
        setRemoteServers([]);
        setEngineId("local");
        document.cookie = `vessel-engine-id=local; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
        setNotice({ kind: "error", title: language === "es" ? "No se pudieron cargar los servidores; se usará el Engine local." : "Could not load servers; the local Engine will be used." });
      });
    }
    const saved = window.localStorage.getItem("vessel-theme");
    const enabled = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(enabled);
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
    setThemeReady(true);
  }, [pathname, language]);
  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    window.localStorage.setItem("vessel-theme", dark ? "dark" : "light");
  }, [dark, themeReady]);
  useEffect(() => {
    if (pathname === "/login") return;
    const message = window.sessionStorage.getItem("vessel-auth-notice");
    if (message) {
      window.sessionStorage.removeItem("vessel-auth-notice");
      setNotice({ kind: "success", title: message });
    }
  }, [pathname]);
  useEffect(() => {
    const showNotice = (event: Event) => {
      const notice = (event as CustomEvent<Notice>).detail;
      if (notice?.title && (notice.kind === "success" || notice.kind === "error" || notice.kind === "info" || notice.kind === "progress")) setNotice(notice);
    };
    window.addEventListener(VESSEL_NOTICE_EVENT, showNotice);
    return () => window.removeEventListener(VESSEL_NOTICE_EVENT, showNotice);
  }, []);
  useEffect(() => {
    const handleEngineChange = (event: Event) => {
      const nextEngineId = (event as CustomEvent<string>).detail;
      if (!nextEngineId) return;
      setEngineId(nextEngineId);
      setEngineSwitching(true);
      if (engineSwitchTimer.current !== null) window.clearTimeout(engineSwitchTimer.current);
      engineSwitchTimer.current = window.setTimeout(() => {
        setEngineSwitching(false);
        engineSwitchTimer.current = null;
      }, 1200);
    };
    window.addEventListener("vessel-engine-changed", handleEngineChange);
    return () => {
      window.removeEventListener("vessel-engine-changed", handleEngineChange);
      if (engineSwitchTimer.current !== null) window.clearTimeout(engineSwitchTimer.current);
    };
  }, []);
  const closeNotice = useCallback(() => setNotice(null), []);
  const selectedServer = remoteServers.find((server) => server.id === engineId);
  const engineLabel = selectedServer ? `${selectedServer.name} · ${selectedServer.host}` : localEngineName;
  const selectEngine = useCallback((nextEngineId: string) => {
    if (nextEngineId === engineId) return;
    document.cookie = `vessel-engine-id=${encodeURIComponent(nextEngineId)}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    window.dispatchEvent(new CustomEvent("vessel-engine-changed", { detail: nextEngineId }));
  }, [engineId]);

  if (pathname === "/login") return <>{children}<VesselTooltipLayer /></>;

  return <div className="app-shell">
    <Sidebar engineLabel={engineLabel} />
    <div className="app-view">
      <div className="app-utilities">
        <div className="app-engine-switcher"><span><Server size={16} />Engine</span><VesselSelect aria-label={language === "es" ? "Engine Docker activo" : "Active Docker Engine"} value={engineId} onChange={(event) => selectEngine(event.target.value)}><option value="local">{localEngineName}</option>{remoteServers.map((server) => <option key={server.id} value={server.id}>{server.name} · {server.host}</option>)}</VesselSelect></div>
        <div className="app-utility-actions">
          <button type="button" onClick={() => setDark((value) => !value)} aria-label={dark ? (language === "es" ? "Modo claro" : "Light mode") : (language === "es" ? "Modo oscuro" : "Dark mode")}><span>{dark ? <Sun size={17} /> : <Moon size={17} />}</span>{dark ? (language === "es" ? "Claro" : "Light") : (language === "es" ? "Oscuro" : "Dark")}</button>
          <button type="button" onClick={() => setLanguage(language === "es" ? "en" : "es")} aria-label={language === "es" ? "Change to English" : "Cambiar a español"}><Languages size={17} />{language.toUpperCase()}</button>
        </div>
      </div>
      {engineSwitching ? <div className="app-engine-switch-status" role="status" aria-live="polite"><LoaderCircle size={16} className="spinning" /><span>{language === "es" ? `Cambiando al Engine ${engineLabel}…` : `Switching to ${engineLabel} Engine…`}</span></div> : null}
      <div key={`${pathname.startsWith("/jobs") ? "/jobs-workspace" : pathname}:${engineId}`} className="app-page-transition">
        {pathname.startsWith("/jobs") ? <div key={pathname} className="vessel-run-tab-transition">{children}</div> : children}
      </div>
    </div>
    <ToastNotice notice={notice} onClose={closeNotice} />
    <VesselTooltipLayer />
  </div>;
}
