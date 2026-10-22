"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Boxes, ChevronUp, Container, Database, Home, Images, LogIn, LogOut, Network, PanelLeftClose, PanelLeftOpen, Settings2, UserRound, Users, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { VesselMark } from "./VesselMark";

const sections: Array<{ en: string; es: string; items: Array<[string, LucideIcon, string, string]> }> = [
  { en: "WORKSPACE", es: "ESPACIO DE TRABAJO", items: [["/", Home, "Overview", "Resumen"], ["/compose", Boxes, "Compose projects", "Proyectos Compose"]] },
  { en: "DOCKER RESOURCES", es: "RECURSOS DOCKER", items: [["/containers", Container, "Containers", "Contenedores"], ["/images", Images, "Images", "Imágenes"], ["/volumes", Database, "Volumes", "Volúmenes"], ["/networks", Network, "Networks", "Redes"]] },
  { en: "ADMINISTRATION", es: "ADMINISTRACIÓN", items: [["/registries", Container, "Registries", "Registries"], ["/users", Users, "Users", "Usuarios"], ["/jobs", Settings2, "Jobs & scripts", "Trabajos y scripts"]] },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { language } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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
    await fetch("/api/auth", { method: "DELETE" }).catch(() => undefined);
    window.localStorage.removeItem("vessel-token");
    setUser(null);
    router.push("/login");
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
        {sections.map((section) => <div className="sidebar-nav-section" key={section.en}><span className="sidebar-section-title">{language === "es" ? section.es : section.en}</span>{section.items.map(([href, Icon, en, es]) => {
          const label = language === "es" ? es : en;
          return <Link className={pathname === href ? "active" : ""} href={href} key={href} title={collapsed ? label : undefined} aria-current={pathname === href ? "page" : undefined}>
            <Icon className="sidebar-icon" size={22} strokeWidth={1.8} />
            <span className="sidebar-label">{label}</span>
          </Link>;
        })}</div>)}
      </nav>
    </div>

    <div className="sidebar-bottom">
      <div className="sidebar-footer" title="Docker Engine"><span className="sidebar-status" /><span className="sidebar-label">Docker Engine</span></div>
      {user ? <div className="sidebar-account" ref={accountRef}>
        <button type="button" className="sidebar-person" onClick={() => { setAccountOpen((value) => !value); setHovered(true); }} aria-expanded={accountOpen} aria-label={language === "es" ? "Abrir menú de cuenta" : "Open account menu"}><span className="account-avatar">{user.username.slice(0, 1).toUpperCase()}</span><span className="account-copy"><strong>{user.username}</strong><small>{user.role}</small></span><ChevronUp size={16} className={`account-chevron${accountOpen ? " is-open" : ""}`} /></button>
        {accountOpen ? <div className="account-menu"><div className="account-menu-heading"><span className="account-avatar">{user.username.slice(0, 1).toUpperCase()}</span><div><strong>{user.username}</strong><small>{user.role}</small></div></div><Link href="/profile"><UserRound size={17} />{language === "es" ? "Mi perfil" : "My profile"}</Link>{user.role === "administrator" ? <Link href="/users"><Users size={17} />{language === "es" ? "Gestionar usuarios" : "Manage users"}</Link> : null}<button type="button" onClick={logout}><LogOut size={17} />{language === "es" ? "Cerrar sesión" : "Sign out"}</button></div> : null}
      </div> : <Link href="/login" className="sidebar-login"><LogIn size={18} /><span className="sidebar-label">{language === "es" ? "Iniciar sesión" : "Sign in"}</span></Link>}
    </div>
  </aside>;
}
