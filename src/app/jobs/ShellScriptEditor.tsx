"use client";

import { useRef, useState } from "react";
import { hideVesselTooltipAt, showVesselTooltipAt } from "@/app/components/VesselTooltipLayer";

const shellWords = new Set(["if", "then", "else", "elif", "fi", "for", "while", "until", "do", "done", "case", "esac", "in", "function", "select", "time"]);
const shellBuiltins = new Set(["export", "local", "readonly", "declare", "set", "unset", "shift", "source", "return", "exit", "echo", "printf", "read", "cd", "pwd", "trap"]);

function highlightedLine(line: string) {
  const token = /(#.*$|"(?:[^"\\]|\\.)*"|'[^']*'|`[^`]*`|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\b[A-Za-z_][A-Za-z0-9_]*\b)/g;
  const pieces: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > cursor) pieces.push(line.slice(cursor, index));
    const value = match[0];
    const className = value.startsWith("#") ? "shell-token-comment"
      : /^["'`]/.test(value) ? "shell-token-string"
      : value.startsWith("$") ? "shell-token-variable"
      : shellWords.has(value) ? "shell-token-keyword"
      : shellBuiltins.has(value) ? "shell-token-builtin" : "";
    pieces.push(className ? <span className={className} key={`${index}-${value}`}>{value}</span> : value);
    cursor = index + value.length;
  }
  if (cursor < line.length) pieces.push(line.slice(cursor));
  return pieces.length ? pieces : " ";
}

const sensitiveName = /(PASSWORD|TOKEN|SECRET|ACCESS_KEY|PRIVATE|CREDENTIAL)/i;

export function ShellScriptEditor({ value, onChange, label, variables = {}, protectedVariables = [], language = "es" }: { value: string; onChange: (value: string) => void; label: string; variables?: Record<string, string>; protectedVariables?: string[]; language?: "es" | "en" }) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const codeRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const lines = value.split("\n");
  function showVariableTooltip(event: React.PointerEvent<HTMLTextAreaElement>) {
    const textarea = event.currentTarget;
    const style = window.getComputedStyle(textarea);
    const rect = textarea.getBoundingClientRect();
    const lineHeight = Number.parseFloat(style.lineHeight) || 19.8;
    const paddingTop = Number.parseFloat(style.paddingTop) || 12;
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 15;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) context.font = style.font;
    const charWidth = context?.measureText("M").width || 7.2;
    const lineIndex = Math.floor((event.clientY - rect.top + textarea.scrollTop - paddingTop) / lineHeight);
    const column = Math.floor((event.clientX - rect.left + textarea.scrollLeft - paddingLeft) / charWidth);
    const line = lines[lineIndex];
    if (line === undefined || column < 0) { hideVesselTooltipAt(); return; }
    const match = [...line.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)].find((candidate) => {
      const start = candidate.index ?? 0;
      return column >= start && column < start + candidate[0].length;
    });
    if (!match) { hideVesselTooltipAt(); return; }
    const name = match[1];
    const protectedNames = new Set(protectedVariables.map((item) => item.replace(/^\$\{?/, "").replace(/\}?$/, "")));
    const valueForName = variables[name] ?? variables[name.replace(/^VESSEL_/, "")] ?? variables[`VESSEL_${name.replace(/^VESSEL_/, "")}`];
    const isProtected = sensitiveName.test(name) || protectedNames.has(name) || protectedNames.has(name.replace(/^VESSEL_/, ""));
    const message = isProtected
      ? `${name}: ${protectedNames.has(name) || protectedNames.has(name.replace(/^VESSEL_/, "")) ? (language === "es" ? "Valor protegido" : "Protected value") : (valueForName ? "••••••••" : (language === "es" ? "No configurado" : "Not configured"))}`
      : `${name}: ${valueForName === undefined ? (language === "es" ? "No configurado" : "Not configured") : valueForName || (language === "es" ? "(vacío)" : "(empty)")}`;
    showVesselTooltipAt(message, event.clientX, event.clientY);
  }
  return <label className="scheduled-code-label shell-script-field">
    <span>{label}</span>
    <div className="shell-editor" aria-label={label}>
      <div className="shell-editor-gutter" ref={gutterRef} aria-hidden="true" style={{ transform: `translateY(-${scrollTop}px)` }}>{lines.map((_, index) => <span key={index}>{index + 1}</span>)}</div>
      <div className="shell-editor-code">
        <pre className="shell-editor-highlight" ref={codeRef} aria-hidden="true" style={{ transform: `translate(-${scrollLeft}px, -${scrollTop}px)` }}>{lines.map((line, index) => <span className="shell-editor-line" key={index}>{highlightedLine(line)}{"\n"}</span>)}</pre>
        <textarea ref={textRef} rows={16} value={value} onChange={(event) => onChange(event.target.value)} onPointerMove={showVariableTooltip} onPointerLeave={hideVesselTooltipAt} onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); setScrollLeft(event.currentTarget.scrollLeft); hideVesselTooltipAt(); }} spellCheck={false} autoCapitalize="off" autoComplete="off" aria-label={label} />
      </div>
    </div>
  </label>;
}
