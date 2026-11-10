"use client";

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };
type Props = {
  value: string | number;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

/** Consistent, keyboard-operable select used throughout Vessel. */
export default function VesselSelect({ value, onChange, children, disabled = false, className = "", ...ariaProps }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const options = useMemo(() => Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionProps>(child) || child.type !== "option") return [];
    return [{ value: String(child.props.value ?? ""), label: child.props.children, disabled: Boolean(child.props.disabled) }];
  }), [children]);
  const selected = Math.max(0, options.findIndex((option) => option.value === String(value)));

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange({ target: { value: option.value } });
    setOpen(false);
    button.current?.focus();
  }

  return <div className={`vessel-select ${className}`.trim()} ref={root}>
    <button ref={button} type="button" className="vessel-select-trigger" aria-haspopup="listbox" aria-expanded={open} disabled={disabled} {...ariaProps}
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
      <span className="vessel-select-value">{options[selected]?.label ?? "—"}</span>
      <ChevronDown size={16} aria-hidden="true" className={open ? "is-open" : undefined} />
    </button>
    {open ? <div className="vessel-select-menu" role="listbox" aria-label={ariaProps["aria-label"]}>
      {options.map((option, index) => <button type="button" role="option" aria-selected={option.value === String(value)} disabled={option.disabled} key={`${option.value}-${index}`}
        className={`vessel-select-option${option.value === String(value) ? " is-selected" : ""}${active === index ? " is-active" : ""}`}
        onMouseEnter={() => setActive(index)} onClick={() => choose(index)}>
        <span>{option.label}</span>{option.value === String(value) ? <Check size={15} aria-hidden="true" /> : <span className="vessel-select-check-space" />}
      </button>)}
    </div> : null}
  </div>;
}
