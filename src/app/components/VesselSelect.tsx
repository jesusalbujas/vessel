"use client";

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode; "data-status"?: "online" | "offline" | "checking"; "data-status-label"?: string };
type Props = {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  portalMenu?: boolean;
  "aria-label"?: string;
};

/** Consistent, keyboard-operable select used throughout Vessel. */
export default function VesselSelect({ value, onChange, children, disabled = false, className = "", portalMenu = false, ...ariaProps }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const options = useMemo(() => Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps>(child) || child.type !== "option") return [];
    return [{ value: String(child.props.value ?? ""), label: child.props.children, disabled: Boolean(child.props.disabled), status: child.props["data-status"], statusLabel: child.props["data-status-label"] }];
  }), [children]);
  const selected = Math.max(0, options.findIndex((option) => option.value === String(value)));

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      if (!portalMenu || !button.current) return;
      const rect = button.current.getBoundingClientRect();
      const menuHeight = menu.current?.offsetHeight ?? 220;
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const placeAbove = below < Math.min(menuHeight, 220) + 12 && above > below;
      const maxHeight = Math.max(120, Math.min(280, (placeAbove ? above : below) - 12));
      setMenuStyle({ position: "fixed", zIndex: 10000, left: rect.left, width: rect.width, maxHeight, ...(placeAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }) });
    };
    positionMenu();
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); window.removeEventListener("resize", positionMenu); window.removeEventListener("scroll", positionMenu, true); };
  }, [open, portalMenu]);

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange({ target: { value: option.value } });
    setOpen(false);
    button.current?.focus();
  }

  return <div className={`vessel-select ${className}`.trim()} ref={root}>
    <button ref={button} type="button" className={`vessel-select-trigger${options[selected]?.status === "offline" ? " is-unavailable" : ""}`} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} {...ariaProps}
      onClick={() => setOpen((current) => !current)}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          if (!open) { setOpen(true); setActive(selected); }
          else setActive((current) => (current + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if (event.key === "Enter" && open) { event.preventDefault(); choose(active >= 0 ? active : selected); }
        else if (event.key === " " && !open) { event.preventDefault(); setOpen(true); setActive(selected); }
        else if (event.key === "Home" && open) { event.preventDefault(); setActive(0); }
        else if (event.key === "End" && open) { event.preventDefault(); setActive(options.length - 1); }
      }}>
      <span className={`vessel-select-value${options[selected]?.status === "offline" ? " is-unavailable" : ""}`}>
        {options[selected]?.status ? <i className={`vessel-select-status-dot is-${options[selected].status}`} aria-label={options[selected].status === "offline" ? "Unavailable" : options[selected].status === "online" ? "Online" : "Checking"} /> : null}
        {options[selected]?.label ?? "—"}
      </span>
      <ChevronDown size={16} aria-hidden="true" className={open ? "is-open" : undefined} />
    </button>
    {open ? (portalMenu ? createPortal(<div ref={menu} className="vessel-select-menu vessel-select-menu-portal" style={menuStyle} role="listbox" aria-label={ariaProps["aria-label"]}>
      {options.map((option, index) => <button type="button" role="option" aria-selected={option.value === String(value)} disabled={option.disabled} key={`${option.value}-${index}`}
        className={`vessel-select-option${option.value === String(value) ? " is-selected" : ""}${active === index ? " is-active" : ""}${option.status === "offline" ? " is-unavailable" : ""}`}
        onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
        <span className="vessel-select-option-label">{option.status ? <i className={`vessel-select-status-dot is-${option.status}`} aria-hidden="true" /> : null}{option.label}</span>
        {option.status === "offline" ? <small>{option.statusLabel ?? "Unavailable"}</small> : null}
        {option.value === String(value) ? <Check size={15} aria-hidden="true" /> : <span className="vessel-select-check-space" />}
      </button>)}
    </div>, document.body) : <div ref={menu} className="vessel-select-menu" role="listbox" aria-label={ariaProps["aria-label"]}>
      {options.map((option, index) => <button type="button" role="option" aria-selected={option.value === String(value)} disabled={option.disabled} key={`${option.value}-${index}`}
        className={`vessel-select-option${option.value === String(value) ? " is-selected" : ""}${active === index ? " is-active" : ""}${option.status === "offline" ? " is-unavailable" : ""}`}
        onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
        <span className="vessel-select-option-label">{option.status ? <i className={`vessel-select-status-dot is-${option.status}`} aria-hidden="true" /> : null}{option.label}</span>
        {option.status === "offline" ? <small>{option.statusLabel ?? "Unavailable"}</small> : null}
        {option.value === String(value) ? <Check size={15} aria-hidden="true" /> : <span className="vessel-select-check-space" />}
      </button>)}
    </div>) : null}
  </div>;
}
