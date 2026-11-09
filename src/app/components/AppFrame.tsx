"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Languages, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Sidebar } from "./Sidebar";
import { ToastNotice, VESSEL_NOTICE_EVENT, type Notice } from "./ToastNotice";
import { VesselTooltipLayer } from "./VesselTooltipLayer";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { language, setLanguage } = useI18n();
  const [dark, setDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    // Remove tokens stored by older versions; browser sessions now use HttpOnly cookies.
    window.localStorage.removeItem("vessel-token");
    const saved = window.localStorage.getItem("vessel-theme");
    const enabled = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    setDark(enabled);
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
    setThemeReady(true);
  }, []);
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
  const closeNotice = useCallback(() => setNotice(null), []);

  if (pathname === "/login") return <>{children}<VesselTooltipLayer /></>;

  return <div className="app-shell">
    <Sidebar />
    <div className="app-view">
      <div className="app-utilities">
        <span className="app-utility-context">Docker Engine</span>
        <div className="app-utility-actions">
          <button type="button" onClick={() => setDark((value) => !value)} aria-label={dark ? (language === "es" ? "Modo claro" : "Light mode") : (language === "es" ? "Modo oscuro" : "Dark mode")}><span>{dark ? <Sun size={17} /> : <Moon size={17} />}</span>{dark ? (language === "es" ? "Claro" : "Light") : (language === "es" ? "Oscuro" : "Dark")}</button>
          <button type="button" onClick={() => setLanguage(language === "es" ? "en" : "es")} aria-label={language === "es" ? "Change to English" : "Cambiar a español"}><Languages size={17} />{language.toUpperCase()}</button>
        </div>
      </div>
      <div key={pathname.startsWith("/jobs") ? "/jobs-workspace" : pathname} className="app-page-transition">
        {pathname.startsWith("/jobs") ? <div key={pathname} className="vessel-run-tab-transition">{children}</div> : children}
      </div>
    </div>
    <ToastNotice notice={notice} onClose={closeNotice} />
    <VesselTooltipLayer />
  </div>;
}
