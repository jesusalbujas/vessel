"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search } from "lucide-react";
import styles from "./DeploymentCombobox.module.css";

export type DeploymentComboOption = { value: string; label: string; detail?: string; icon?: ReactNode };

export function DeploymentCombobox({ label, value, options, onChange, placeholder, searchPlaceholder, disabled = false, loading = false, allowCustom = false, customOptionLabel, compact = false, es = true } : {
  label: string;
  value: string;
  options: DeploymentComboOption[];
  onChange: (value: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  allowCustom?: boolean;
  customOptionLabel?: (value: string) => string;
  compact?: boolean;
  es?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ left: 0, width: 0 });
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized ? options.filter((option) => `${option.label} ${option.detail ?? ""} ${option.value}`.toLocaleLowerCase().includes(normalized)) : options;
  }, [options, query]);
  const canUseCustom = allowCustom && query.trim().length > 0 && !options.some((option) => option.value === query.trim());
  const entries = canUseCustom ? [...filtered, { value: query.trim(), label: customOptionLabel?.(query.trim()) ?? (es ? "Usar esta ruta" : "Use this path"), detail: query.trim(), icon: <Search size={18} /> }] : filtered;

  const updateMenuPosition = useCallback(() => {
    const rect = root.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const desiredHeight = Math.min(350, 74 + Math.max(1, options.length) * 58);
    const openAbove = below < desiredHeight && above > below;
    const width = Math.min(rect.width, window.innerWidth - 16);
    setMenuPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width,
      maxHeight: Math.max(0, Math.min(350, openAbove ? above : below)),
      top: openAbove ? "auto" : rect.bottom + 8,
      bottom: openAbove ? window.innerHeight - rect.top + 8 : "auto",
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    searchInput.current?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listId]);

  function close() { setOpen(false); trigger.current?.focus({ preventScroll: true }); }
  function choose(next: string) { onChange(next); setQuery(""); close(); }
  function show() { updateMenuPosition(); setQuery(""); setActiveIndex(-1); setOpen(true); }

  return <div className={`${styles.root}${compact ? ` ${styles.compact}` : ""}`} ref={root}>
    <button ref={trigger} type="button" className={styles.trigger} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} disabled={disabled || loading} onClick={() => open ? close() : show()} onKeyDown={(event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
    }}>
      <span className={`${styles.value} ${!selected && !(allowCustom && value) ? styles.placeholder : ""}`}>
        {selected?.icon ? <span className={styles.icon}>{selected.icon}</span> : null}
        <span className={styles.copy}><strong title={selected?.label ?? value}>{loading ? (es ? "Cargando…" : "Loading…") : selected?.label ?? (allowCustom && value ? value : placeholder)}</strong>{selected?.detail ? <small>{selected.detail}</small> : null}</span>
      </span>
      {loading ? <span className="spinner" /> : <ChevronDown size={16} className={styles.chevron} />}
    </button>
    {open ? createPortal(<div ref={menu} className={styles.menu} style={menuPosition} onKeyDown={(event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") { trigger.current?.focus({ preventScroll: true }); setOpen(false); }
    }}>
      <div className={styles.searchWrap}><div className={styles.search}><Search size={16} /><input
        className={styles.searchInput} ref={searchInput} value={query} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={activeIndex >= 0 && entries[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (entries.length) setActiveIndex((current) => event.key === "ArrowDown" ? (current + 1) % entries.length : current <= 0 ? entries.length - 1 : current - 1);
          }
          if (event.key === "Enter") {
            event.preventDefault();
            const option = activeIndex >= 0 ? entries[activeIndex] : canUseCustom ? entries[entries.length - 1] : entries[0];
            if (option) choose(option.value);
          }
        }}
        placeholder={searchPlaceholder ?? (es ? "Buscar…" : "Search…")} aria-label={searchPlaceholder ?? (es ? `Buscar ${label}` : `Search ${label}`)}
      /></div></div>
      <div className={styles.options} role="listbox" id={listId} aria-label={label}>
        {entries.map((option, index) => <button type="button" role="option" tabIndex={-1} id={`${listId}-${index}`} aria-selected={option.value === value} data-active={activeIndex === index} className={styles.option} key={option.value} onClick={() => choose(option.value)}>
          {option.icon ? <span className={styles.icon}>{option.icon}</span> : null}
          <span className={styles.copy}><strong title={option.label}>{option.label}</strong>{option.detail ? <small title={option.detail}>{option.detail}</small> : null}</span>
          {option.value === value ? <Check size={16} className={styles.check} /> : null}
        </button>)}
        {!entries.length ? <span className={styles.empty}>{es ? "Sin resultados" : "No results"}</span> : null}
      </div>
    </div>, document.body) : null}
  </div>;
}
