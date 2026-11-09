"use client";

import { CircleCheck, CircleX, Info, LoaderCircle, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n";

export type Notice = { kind: "success" | "error" | "info" | "progress"; title: string; detail?: string };
export const VESSEL_NOTICE_EVENT = "vessel-notice";

export function notifyVessel(notice: Notice) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<Notice>(VESSEL_NOTICE_EVENT, { detail: notice }));
}

export function ToastNotice({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const { language } = useI18n();
  useEffect(() => {
    if (!notice || notice.kind === "progress") return;
    const timeout = window.setTimeout(onClose, 4800);
    return () => window.clearTimeout(timeout);
  }, [notice, onClose]);

  if (!notice || typeof document === "undefined") return null;

  return createPortal(<div className={`vessel-notice vessel-notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
    <span className="vessel-notice-icon" aria-hidden="true">{notice.kind === "success" ? <CircleCheck size={21} /> : notice.kind === "error" ? <CircleX size={21} /> : notice.kind === "info" ? <Info size={21} /> : <LoaderCircle size={21} className="spinning" />}</span>
    <div className="vessel-notice-copy"><strong>{notice.title}</strong>{notice.detail ? <span>{notice.detail}</span> : null}</div>
    <button type="button" onClick={onClose} aria-label={language === "es" ? "Cerrar notificación" : "Dismiss notification"}><X size={17} /></button>
    <span className="vessel-notice-indicator" aria-hidden="true" />
  </div>, document.body);
}
