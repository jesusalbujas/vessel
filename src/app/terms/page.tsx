"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, Container, FileText, KeyRound, Network, Scale, Server, ShieldAlert, ShieldCheck } from "lucide-react";
import { SettingsNavigation } from "@/app/components/SettingsNavigation";
import { useI18n } from "@/lib/i18n";
import "../globals.css";

export default function TermsPage() {
  const { language } = useI18n();
  const es = language === "es";
  const sections = es ? [
    { title: "1. Alcance", icon: <BookOpen size={18} />, body: "Vessel es un plano de control autoalojado para consultar y administrar recursos Docker del Engine configurado. Las funciones disponibles dependen de la versión de Vessel, Docker Engine y los permisos del usuario." },
    { title: "2. Acciones y datos", icon: <Container size={18} />, body: "Iniciar, detener, recrear, duplicar o eliminar contenedores, imágenes, volúmenes y proyectos puede interrumpir servicios o borrar datos. Antes de ejecutar acciones destructivas, confirma el objetivo y conserva respaldos verificables. Quien opera Vessel es responsable de validar el impacto." },
    { title: "3. Acceso al Engine", icon: <Server size={18} />, body: "El acceso al socket o API de Docker concede capacidades administrativas muy amplias sobre el host. Limita el acceso a Vessel a personas autorizadas, protege el servidor y no expongas la interfaz directamente a Internet sin controles de red y HTTPS." },
    { title: "4. Credenciales y configuración", icon: <KeyRound size={18} />, body: "Vessel guarda credenciales de registry, tokens GitHub y valores de despliegue cifrados en su base SQLite. La protección depende de mantener privada la clave VESSEL_SECRET_KEY, el archivo SQLite y sus respaldos. Si se pierde o cambia la clave, los secretos cifrados existentes pueden dejar de ser recuperables. Los valores inyectados al entorno de un contenedor pueden quedar visibles mediante Docker inspect; para datos sensibles en runtime, utiliza Docker Compose secrets y configura la aplicación para leerlos desde archivos." },
    { title: "5. Servicios de terceros", icon: <Network size={18} />, body: "Los registries, imágenes, extensiones, sistemas de identidad y demás servicios externos tienen sus propios términos, licencias y políticas. El administrador debe verificar el origen, permisos y licencias de las imágenes y credenciales utilizadas." },
    { title: "6. Disponibilidad y garantía", icon: <ShieldCheck size={18} />, body: "Vessel se ofrece como software autoalojado. Salvo acuerdo escrito independiente, no se garantiza disponibilidad continua, compatibilidad con toda configuración Docker ni recuperación automática ante fallos. Mantén copias de seguridad y procedimientos de recuperación." },
    { title: "7. Uso aceptable", icon: <Scale size={18} />, body: "Usa Vessel únicamente en hosts y recursos para los que tengas autorización. No lo utilices para evadir controles de acceso, interferir con sistemas ajenos o ejecutar actividades ilícitas." },
  ] : [
    { title: "1. Scope", icon: <BookOpen size={18} />, body: "Vessel is a self-hosted control plane for viewing and managing Docker resources on the configured Engine. Available features depend on the Vessel release, Docker Engine, and the user's permissions." },
    { title: "2. Actions and data", icon: <Container size={18} />, body: "Starting, stopping, recreating, duplicating, or deleting containers, images, volumes, and projects may interrupt services or destroy data. Before destructive actions, verify the target and keep tested backups. The operator is responsible for validating impact." },
    { title: "3. Engine access", icon: <Server size={18} />, body: "Access to the Docker socket or API grants broad administrative capabilities over the host. Restrict Vessel to authorized users, secure its server, and do not expose the interface directly to the Internet without network controls and HTTPS." },
    { title: "4. Credentials and configuration", icon: <KeyRound size={18} />, body: "Vessel stores registry credentials, GitHub tokens, and deployment values encrypted in its SQLite database. Protection depends on keeping VESSEL_SECRET_KEY, the SQLite file, and its backups private. Losing or changing the key may make existing encrypted secrets unrecoverable. Values injected into a container environment may be visible through Docker inspect; for sensitive runtime data, use Docker Compose secrets and configure the application to read mounted files." },
    { title: "5. Third-party services", icon: <Network size={18} />, body: "Registries, images, extensions, identity providers, and other external services have their own terms, licenses, and policies. Administrators must verify the source, permissions, and licenses of images and credentials they use." },
    { title: "6. Availability and warranty", icon: <ShieldCheck size={18} />, body: "Vessel is provided as self-hosted software. Unless separately agreed in writing, continuous availability, compatibility with every Docker setup, and automatic recovery from failures are not guaranteed. Maintain backups and recovery procedures." },
    { title: "7. Acceptable use", icon: <Scale size={18} />, body: "Use Vessel only with hosts and resources you are authorized to manage. Do not use it to bypass access controls, interfere with systems you do not own, or perform unlawful activities." },
  ];

  return <main className="module-main settings-page terms-page"><header className="module-header"><div><span className="module-kicker">VESSEL / {es ? "LEGAL" : "LEGAL"}</span><h1>{es ? "Términos y condiciones" : "Terms & conditions"}</h1><p>{es ? "Condiciones de uso del plano de control y sus integraciones." : "Terms for using the control plane and its integrations."}</p></div><span className="module-header-badge"><FileText size={15} />{es ? "Documento de referencia" : "Reference document"}</span></header>
    <SettingsNavigation />
    <div className="terms-notice" role="note"><span className="terms-notice-icon"><FileText size={19} /></span><span className="terms-notice-copy"><small className="terms-notice-eyebrow">{es ? "BORRADOR · DOCUMENTO INFORMATIVO" : "DRAFT · INFORMATIONAL DOCUMENT"}</small><strong>{es ? "Términos de uso de Vessel" : "Vessel terms of use"}</strong><small>{es ? "Este borrador describe el uso técnico de la plataforma. Requiere revisión legal antes de publicarse o utilizarse como acuerdo contractual." : "This draft describes the platform's technical use. It requires legal review before publication or use as a contractual agreement."}</small></span><span className="terms-notice-status"><ShieldAlert size={14} />{es ? "Revisión legal" : "Legal review"}</span></div>
    <section className="module-panel terms-document"><div className="terms-document-heading"><span className="terms-logo"><Container size={21} /></span><div><strong>Vessel</strong><small>{es ? "Términos de uso · versión 1.0" : "Terms of use · version 1.0"}</small></div><ShieldCheck size={18} /></div>
      {sections.map((section) => <article key={section.title}><span className="terms-section-icon">{section.icon}</span><div className="terms-section-copy"><h2>{section.title}</h2><p>{section.body}</p></div></article>)}
      <div className="terms-footer"><KeyRound size={15} /><span>{es ? "Para ayuda sobre ajustes de seguridad, revisa " : "For security settings, see "}<Link href="/settings/authentication">{es ? "Autenticación" : "Authentication"}</Link>{es ? "." : "."}</span></div>
    </section>
    <Link className="settings-back-link" href="/settings"><ArrowLeft size={15} />{es ? "Volver a configuración" : "Back to settings"}</Link>
  </main>;
}
