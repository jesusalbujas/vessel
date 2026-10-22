"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import "../globals.css";

export default function JobsPage() {
  const { language } = useI18n(); const [jobs, setJobs] = useState<unknown[]>([]);
  useEffect(() => { const refresh = () => fetch("/api/jobs", { cache: "no-store" }).then((response) => response.json()).then((data) => setJobs(data.data ?? [])); void refresh(); const timer = window.setInterval(refresh, 3000); return () => window.clearInterval(timer); }, []);
  return <main className="module-main"><header className="module-header"><div><span className="module-kicker">Vessel · Automation</span><h1>{language === "es" ? "Trabajos y scripts" : "Jobs & scripts"}</h1><p>{language === "es" ? "Supervisa operaciones de imágenes, duplicaciones y restauraciones." : "Monitor image, duplication, and restore operations."}</p></div></header><section className="module-panel"><div className="module-message">{language === "es" ? "El runner seguro de scripts será el siguiente módulo: variables, permisos, historial y ejecución aislada." : "The secure script runner is the next module: variables, permissions, history, and isolated execution."}</div><div className="module-list">{jobs.length ? jobs.map((job, index) => <div key={index}>{JSON.stringify(job)}</div>) : <div>{language === "es" ? "No hay trabajos recientes." : "No recent jobs."}</div>}</div></section></main>;
}
