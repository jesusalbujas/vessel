"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { Check, Image, LoaderCircle, Minimize2, Maximize2, Trash2, TriangleAlert, X } from "lucide-react";
import { dismissImageDeletion, getImageDeletionSnapshot, setImageDeletionMinimized, subscribeImageDeletion } from "@/lib/image-deletion-client";
import { useI18n } from "@/lib/i18n";

export function ImageDeletionWindow() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const state = useSyncExternalStore(subscribeImageDeletion, getImageDeletionSnapshot, () => null);
  const { language } = useI18n();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (state && !state.minimized && !dialog.open) dialog.showModal();
    else if ((!state || state.minimized) && dialog.open) dialog.close();
  }, [state]);
  if (!state) return null;

  const es = language === "es";
  const running = state.phase === "checking" || state.phase === "deleting";
  const title = running
    ? state.phase === "checking" ? (es ? "Comprobando imágenes" : "Checking images") : (es ? `Borrando ${state.current} de ${state.total}` : `Deleting ${state.current} of ${state.total}`)
    : state.phase === "completed" ? (es ? "Borrado completado" : "Deletion complete") : (es ? "Borrado detenido" : "Deletion stopped");
  const status = state.phase === "checking"
    ? (es ? "Comprobando contenedores e imágenes…" : "Checking containers and images…")
    : state.phase === "deleting"
      ? (es ? `Borrando ${state.current} de ${state.total}` : `Deleting ${state.current} of ${state.total}`)
      : state.phase === "completed"
        ? (es ? `${state.completed} de ${state.total} imágenes borradas` : `${state.completed} of ${state.total} images deleted`)
        : (es ? `${state.completed} de ${state.total} imágenes borradas` : `${state.completed} of ${state.total} images deleted`);
  const detail = state.phase === "checking"
    ? (es ? "No se borrará ninguna si alguna está en uso." : "Nothing is removed if an image is in use.")
    : state.phase === "deleting"
      ? state.imageId ? `${es ? "Imagen actual" : "Current image"}: ${state.imageId.slice(0, 32)}…` : (es ? "Preparando borrado…" : "Preparing deletion…")
      : state.phase === "completed"
        ? (es ? "Todas las imágenes seleccionadas fueron procesadas." : "All selected images have been processed.")
        : state.error;
  const StateIcon = state.phase === "completed" ? Check : state.phase === "failed" ? TriangleAlert : state.phase === "checking" ? Image : Trash2;

  if (state.minimized && running) {
    return <aside className="image-delete-window image-delete-window-minimized" aria-live="polite">
      <button type="button" className="image-delete-mini-open" onClick={() => setImageDeletionMinimized(false)} aria-label={es ? "Abrir progreso del borrado de imágenes" : "Open image deletion progress"}>
        <span className="image-delete-mini-icon"><LoaderCircle size={17} className="spinning" /></span>
        <span className="image-delete-mini-copy"><strong>{es ? "Borrando imágenes" : "Deleting images"}</strong><small>{es ? `Imagen ${state.current} de ${state.total}` : `Image ${state.current} of ${state.total}`}</small><progress max={100} value={state.percent} aria-label={es ? "Progreso del borrado" : "Deletion progress"} /></span>
        <strong className="image-delete-mini-percent">{state.percent}%</strong>
        <Maximize2 size={15} />
      </button>
    </aside>;
  }

  return <dialog ref={dialogRef} className={`confirm-modal image-delete-modal image-delete-task-modal${state.phase === "completed" ? " is-completed" : state.phase === "failed" ? " is-failed" : ""}`} aria-labelledby="image-delete-task-title" onCancel={(event) => { event.preventDefault(); if (running) setImageDeletionMinimized(true); else dismissImageDeletion(); }}>
      <header className="image-delete-task-heading">
        <div><span className="modal-kicker"><StateIcon size={14} />Docker · {es ? "Imágenes" : "Images"}</span><h2 id="image-delete-task-title">{title}</h2></div>
        <div className="image-delete-task-controls">
          {running ? <button type="button" onClick={() => setImageDeletionMinimized(true)} aria-label={es ? "Minimizar y seguir trabajando" : "Minimize and keep working"} title={es ? "Minimizar" : "Minimize"}><Minimize2 size={17} /></button> : null}
          {!running ? <button type="button" onClick={dismissImageDeletion} aria-label={es ? "Cerrar resumen" : "Close summary"} title={es ? "Cerrar" : "Close"}><X size={19} /></button> : null}
        </div>
      </header>
      <div className={`image-delete-progress is-${state.phase}`} aria-live="polite">
        <div className="image-delete-progress-label"><span>{running ? <LoaderCircle size={15} className="spinning" /> : state.phase === "completed" ? <Check size={15} /> : <TriangleAlert size={15} />}{status}</span><strong>{state.percent}%</strong></div>
        <progress className="image-delete-progress-bar" max={100} value={state.percent} aria-label={es ? "Progreso del borrado de imágenes" : "Image deletion progress"} />
        <div className="image-delete-progress-meta"><span>{detail}</span></div>
      </div>
      <div className="modal-actions">
        {running ? <button type="button" onClick={() => setImageDeletionMinimized(true)}><Minimize2 size={15} />{es ? "Minimizar y seguir navegando" : "Minimize and keep browsing"}</button> : <button className="primary-button" type="button" onClick={dismissImageDeletion}><Check size={15} />{es ? "Listo" : "Done"}</button>}
      </div>
  </dialog>;
}
