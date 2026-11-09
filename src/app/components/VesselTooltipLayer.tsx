"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type TooltipState = { text: string; left: number; top: number; placement: "top" | "bottom" };
const TOOLTIP_SHOW_EVENT = "vessel-tooltip-show-at";
const TOOLTIP_HIDE_EVENT = "vessel-tooltip-hide-at";

export function showVesselTooltipAt(text: string, x: number, y: number) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TOOLTIP_SHOW_EVENT, { detail: { text, x, y } }));
}

export function hideVesselTooltipAt() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(TOOLTIP_HIDE_EVENT));
}

const TOOLTIP_ID = "vessel-global-tooltip";

export function VesselTooltipLayer() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    let activeTarget: HTMLElement | null = null;
    let previousDescription: string | null = null;

    function hide() {
      if (activeTarget) {
        if (previousDescription === null) activeTarget.removeAttribute("aria-describedby");
        else activeTarget.setAttribute("aria-describedby", previousDescription);
      }
      activeTarget = null;
      previousDescription = null;
      setTooltip(null);
    }

    function position(target: HTMLElement, text: string) {
      const rect = target.getBoundingClientRect();
      const placement = rect.top >= 86 ? "top" : "bottom";
      const halfWidth = Math.min(180, Math.max(110, window.innerWidth / 2 - 16));
      const left = Math.max(halfWidth, Math.min(window.innerWidth - halfWidth, rect.left + rect.width / 2));
      const top = placement === "top" ? rect.top - 9 : rect.bottom + 9;
      setTooltip({ text, left, top, placement });
    }

    const onShowAt = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string; x: number; y: number }>).detail;
      if (!detail?.text) return;
      if (activeTarget) hide();
      const placement = detail.y >= 86 ? "top" : "bottom";
      const halfWidth = Math.min(180, Math.max(110, window.innerWidth / 2 - 16));
      const left = Math.max(halfWidth, Math.min(window.innerWidth - halfWidth, detail.x));
      const top = placement === "top" ? detail.y - 12 : detail.y + 12;
      setTooltip({ text: detail.text, left, top, placement });
    };
    const onHideAt = () => hide();

    function resolveTarget(eventTarget: EventTarget | null) {
      if (!(eventTarget instanceof Element)) return null;
      return eventTarget.closest<HTMLElement>("[title], [data-tooltip]");
    }

    function show(target: HTMLElement | null) {
      if (!target) { hide(); return; }
      // React may update a localized `title` after the first hover. Prefer
      // that live value over the cached data-tooltip so changing languages
      // cannot leave an old translation behind.
      const text = target.getAttribute("title") || target.getAttribute("data-tooltip") || "";
      if (!text.trim()) { hide(); return; }
      // Replace native browser title popups with one consistent Vessel tooltip.
      if (target.hasAttribute("title")) {
        target.dataset.tooltip = text;
        target.removeAttribute("title");
      }
      if (activeTarget !== target) {
        hide();
        activeTarget = target;
        previousDescription = target.getAttribute("aria-describedby");
        const descriptions = new Set((previousDescription ?? "").split(/\s+/).filter(Boolean));
        descriptions.add(TOOLTIP_ID);
        target.setAttribute("aria-describedby", [...descriptions].join(" "));
      }
      position(target, text);
    }

    const onPointerOver = (event: PointerEvent) => show(resolveTarget(event.target));
    const onPointerMove = (event: PointerEvent) => {
      if (activeTarget && activeTarget.contains(event.target as Node)) {
        const liveTitle = activeTarget.getAttribute("title");
        const text = liveTitle || activeTarget.dataset.tooltip || "";
        if (text) {
          if (liveTitle) {
            activeTarget.dataset.tooltip = liveTitle;
            activeTarget.removeAttribute("title");
          }
          position(activeTarget, text);
        }
      }
    };
    const onPointerOut = (event: PointerEvent) => {
      if (activeTarget && !activeTarget.contains(event.relatedTarget as Node | null)) hide();
    };
    const onFocusIn = (event: FocusEvent) => show(resolveTarget(event.target));
    const onFocusOut = (event: FocusEvent) => {
      if (activeTarget && !activeTarget.contains(event.relatedTarget as Node | null)) hide();
    };
    const onScroll = () => hide();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener(TOOLTIP_SHOW_EVENT, onShowAt);
    window.addEventListener(TOOLTIP_HIDE_EVENT, onHideAt);
    return () => {
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener(TOOLTIP_SHOW_EVENT, onShowAt);
      window.removeEventListener(TOOLTIP_HIDE_EVENT, onHideAt);
      hide();
    };
  }, []);

  if (!tooltip || typeof document === "undefined") return null;
  return createPortal(
    <div id={TOOLTIP_ID} role="tooltip" className={`vessel-tooltip vessel-tooltip--${tooltip.placement}`} style={{ left: tooltip.left, top: tooltip.top }}>
      {tooltip.text}
    </div>,
    document.body,
  );
}
