"use client";

import { CircleCheck, CircleX, X } from "lucide-react";
import { useEffect } from "react";

export type Notice = { kind: "success" | "error"; title: string; detail?: string };

export function ToastNotice({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(onClose, 4800);
    return () => window.clearTimeout(timeout);
  }, [notice, onClose]);

  if (!notice) return null;

  return <div className={`vessel-notice vessel-notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
    <span className="vessel-notice-icon" aria-hidden="true">{notice.kind === "success" ? <CircleCheck size={21} /> : <CircleX size={21} />}</span>
    <div className="vessel-notice-copy"><strong>{notice.title}</strong>{notice.detail ? <span>{notice.detail}</span> : null}</div>
    <button type="button" onClick={onClose} aria-label="Cerrar aviso"><X size={17} /></button>
  </div>;
}
