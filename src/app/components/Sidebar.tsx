"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Activity, BellRing, Bot, Boxes, CalendarClock, ChevronUp, Container, Database, FolderKanban, GitBranch, Home, Images, KeyRound, LogIn, LogOut, Mail, Network, PanelLeftClose, PanelLeftOpen, Server, Settings2, ShieldCheck, UserRound, Users, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { VesselMark } from "./VesselMark";
import { UserAvatar } from "./UserAvatar";
import packageInfo from "../../../package.json";

const sections: Array<{ en: string; es: string; items: Array<[string, LucideIcon, string, string]> }> = [
  { en: "WORKSPACE", es: "ESPACIO DE TRABAJO", items: [["/", Home, "Overview", "Resumen"], ["/projects", FolderKanban, "Projects", "Proyectos"], ["/compose", Boxes, "Compose projects", "Proyectos Compose"], ["/monitoring", BellRing, "Monitoring & alerts", "Monitoreo y alertas"]] },
  { en: "DOCKER RESOURCES", es: "RECURSOS DOCKER", items: [["/containers", Container, "Containers", "Contenedores"], ["/images", Images, "Images", "Imágenes"], ["/volumes", Database, "Volumes", "Volúmenes"], ["/networks", Network, "Networks", "Redes"]] },
  { en: "AUTOMATION", es: "AUTOMATIZACIÓN", items: [["/jobs", CalendarClock, "Vessel Run", "Vessel Run"]] },
  { en: "ADMINISTRATION", es: "ADMINISTRACIÓN", items: [["/servers", Server, "Servers", "Servidores"], ["/ssh-keys", KeyRound, "SSH keys", "Claves SSH"], ["/registries", Container, "Registries", "Registries"], ["/git-providers", GitBranch, "Git providers", "Proveedores Git"], ["/users", Users, "Users", "Usuarios"], ["/sessions", ShieldCheck, "Sessions", "Sesiones"], ["/audit", Activity, "Audit log", "Auditoría"], ["/settings/ai", Bot, "AI", "IA"], ["/settings", Settings2, "Settings", "Configuración"]] },
];

export function Sidebar({ engineLabel = "Engine Local" }: { engineLabel?: string }) {
  const pathname = usePathname();
  const { language } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<{ username: string; role: string; roleName?: string; permissions?: string[]; email?: string | null; avatarUrl?: string | null } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.localStorage.removeItem("vessel-token");
    setCollapsed(window.localStorage.getItem("vessel-sidebar-collapsed") === "true");
    setHydrated(true);
  }, []);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setUser(data.user ?? null))
      .catch(() => setUser(null));
  }, [pathname]);

  useEffect(() => {
    const refreshUser = () => fetch("/api/auth", { cache: "no-store" }).then((response) => response.json()).then((data) => setUser(data.user ?? null)).catch(() => setUser(null));
    window.addEventListener("vessel-user-updated", refreshUser);
    return () => window.removeEventListener("vessel-user-updated", refreshUser);
  }, []);

  useEffect(() => {
    setAccountOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!accountOpen) return;
    const close = (event: MouseEvent) => { if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [accountOpen]);

  function toggle() {
    setCollapsed((current) => {
      window.localStorage.setItem("vessel-sidebar-collapsed", String(!current));
      return !current;
    });
  }

  async function logout() {
    window.localStorage.removeItem("vessel-token");
    window.sessionStorage.removeItem("vessel-show-active-alerts-after-login");
    window.location.assign("/api/auth/logout");
  }

  return <aside className={`vessel-sidebar${collapsed && !hovered ? " is-collapsed" : ""}${hydrated ? "" : " sidebar-pending"}`}
    onMouseEnter={() => { if (collapsed) setHovered(true); }}
    onMouseLeave={() => { if (!accountOpen) setHovered(false); }}>
    <div className="sidebar-top">
      <Link href="/" className="sidebar-brand" aria-label="Vessel">
        <VesselMark size={36} />
        <span className="sidebar-copy"><strong>Vessel</strong></span>
      </Link>
      <button className="sidebar-toggle" type="button" onClick={toggle}
        aria-label={collapsed ? (language === "es" ? "Expandir menú" : "Expand sidebar") : (language === "es" ? "Contraer menú" : "Collapse sidebar")}
        aria-expanded={!collapsed || hovered}>
        {collapsed ? <PanelLeftOpen size={19} strokeWidth={1.8} /> : <PanelLeftClose size={19} strokeWidth={1.8} />}
      </button>
    </div>

    <div className="sidebar-navigation">
      <nav aria-label={language === "es" ? "Navegación principal" : "Main navigation"}>
        {sections.map((section) => {
          const requiredPermission: Record<string, string> = { "/": "overview.view", "/projects": "projects.view", "/compose": "compose.view", "/monitoring": "monitoring.view", "/containers": "containers.view", "/images": "images.view", "/volumes": "volumes.view", "/networks": "networks.view", "/jobs": "automation.view", "/servers": "servers.view", "/ssh-keys": "ssh_keys.manage", "/registries": "registries.view", "/git-providers": "git.manage", "/users": "users.manage", "/sessions": "sessions.manage", "/audit": "audit.view", "/settings/ai": "ai.manage", "/settings": "settings.manage" };
          const visibleItems = section.items.filter(([href]) => {
            if (!user) return false;
            if (href === "/users") return user.role === "administrator";
            const permission = requiredPermission[href];
            return !permission || user.permissions?.includes("*") || user.permissions?.includes(permission) || (permission.endsWith(".view") && user.permissions?.includes(`${permission.slice(0, -5)}.manage`));
          });
          if (!visibleItems.length) return null;
          return <div className="sidebar-nav-section" key={section.en}><span className="sidebar-section-title">{language === "es" ? section.es : section.en}</span>{visibleItems.map(([href, Icon, en, es]) => {
          const label = language === "es" ? es : en;
          const active = pathname === href || (href !== "/" && pathname.startsWith(`${href}/`) && !(href === "/settings" && pathname.startsWith("/settings/ai")));
          return <Link className={active ? "active" : ""} href={href} key={href} title={collapsed ? label : undefined} aria-current={active ? "page" : undefined}>
            <Icon className="sidebar-icon" size={22} strokeWidth={1.8} />
            <span className="sidebar-label">{label}</span>
          </Link>;
        })}</div>;
        })}
      </nav>
    </div>

    <div className="sidebar-bottom">
      <div className="sidebar-footer" title={engineLabel}><span className="sidebar-engine-status"><span className="sidebar-status" /><span className="sidebar-label">{engineLabel}</span></span><span className="sidebar-version">{language === "es" ? "Versión" : "Version"} v{process.env.NEXT_PUBLIC_VESSEL_VERSION || packageInfo.version}</span></div>
      {user ? <div className="sidebar-account" ref={accountRef}>
        <button type="button" className="sidebar-person" onClick={() => { setAccountOpen((value) => !value); setHovered(true); }} aria-expanded={accountOpen} aria-label={language === "es" ? "Abrir menú de cuenta" : "Open account menu"}><UserAvatar className="account-avatar" username={user.username} avatarUrl={user.avatarUrl} /><span className="account-copy"><strong>{user.username}</strong><small>{user.roleName ?? user.role}</small>{user.email ? <small className="account-email"><Mail size={12} />{user.email}</small> : null}</span><ChevronUp size={16} className={`account-chevron${accountOpen ? " is-open" : ""}`} /></button>
        {accountOpen ? <div className="account-menu"><div className="account-menu-heading"><UserAvatar className="account-avatar" username={user.username} avatarUrl={user.avatarUrl} /><div><strong>{language === "es" ? "Cuenta" : "Account"}</strong><small className="account-menu-email"><Mail size={12} />{user.email || user.role}</small></div></div><Link href="/profile"><UserRound size={17} />{language === "es" ? "Mi perfil" : "My profile"}</Link>{user.role === "administrator" ? <Link href="/users"><Users size={17} />{language === "es" ? "Gestionar usuarios" : "Manage users"}</Link> : null}<button type="button" onClick={logout}><LogOut size={17} />{language === "es" ? "Cerrar sesión" : "Sign out"}</button></div> : null}
      </div> : <Link href="/login" className="sidebar-login"><LogIn size={18} /><span className="sidebar-label">{language === "es" ? "Iniciar sesión" : "Sign in"}</span></Link>}
    </div>
  </aside>;
}
