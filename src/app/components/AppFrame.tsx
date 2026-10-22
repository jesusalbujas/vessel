"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Languages, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { Sidebar } from "./Sidebar";
import { ToastNotice, type Notice } from "./ToastNotice";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { language, setLanguage } = useI18n();
  const [dark, setDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
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
  const closeNotice = useCallback(() => setNotice(null), []);

  if (pathname === "/login") return <>{children}</>;

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
      <div key={pathname} className="app-page-transition">{children}</div>
    </div>
    <ToastNotice notice={notice} onClose={closeNotice} />
  </div>;
}
