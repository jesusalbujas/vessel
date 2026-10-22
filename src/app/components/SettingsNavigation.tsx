"use client";

import Link from "next/link";
import { FileText, Settings2, ShieldCheck } from "lucide-react";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";

export function SettingsNavigation() {
  const pathname = usePathname();
  const { language } = useI18n();
  const links = [
    { href: "/settings", icon: Settings2, en: "General", es: "General" },
    { href: "/settings/authentication", icon: ShieldCheck, en: "Authentication", es: "Autenticación" },
    { href: "/terms", icon: FileText, en: "Terms & conditions", es: "Términos y condiciones" },
  ];
  return <nav className="settings-navigation" aria-label={language === "es" ? "Configuración" : "Settings"}>{links.map(({ href, icon: Icon, en, es }) => <Link href={href} key={href} className={pathname === href ? "active" : ""} aria-current={pathname === href ? "page" : undefined}><Icon size={16} />{language === "es" ? es : en}</Link>)}</nav>;
}
