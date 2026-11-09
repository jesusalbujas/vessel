"use client";

import { useEffect, useMemo, useRef } from "react";

type Props = { value: string; onChange: (value: string) => void; disabled?: boolean; label: string; errorLine?: number | null };

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function highlightLine(line: string) {
  const token = /(\s+#.*$|^\s*#.*$|(?:^|\s)(?:true|false|null|yes|no|on|off)(?=\s|$|,|\])|(?:^|\s)(?:\d+(?:\.\d+)?)(?=\s|$|,)|\$\{[^}]+\}|(?:^|\s)(?:-[ \t]+)|(?:^|\s)[A-Za-z_][\w.-]*(?=\s*:)|"[^"\\]*(?:\\.[^"\\]*)*"|'[^']*')/g;
  let result = "";
  let cursor = 0;
  for (const match of line.matchAll(token)) {
    const index = match.index ?? 0;
    if (index > cursor) result += escapeHtml(line.slice(cursor, index));
    const value = match[0];
    const trimmed = value.trimStart();
    const kind = trimmed.startsWith("#") ? "comment"
      : trimmed.startsWith("${") ? "variable"
      : trimmed === "-" || trimmed.startsWith("- ") ? "punctuation"
      : /^(true|false|null|yes|no|on|off)$/i.test(trimmed) ? "boolean"
      : /^\d/.test(trimmed) ? "number"
      : /^("|')/.test(trimmed) ? "string"
      : /:$/.test(trimmed) ? "key"
      : "plain";
    result += `<span class="yaml-token-${kind}">${escapeHtml(value)}</span>`;
    cursor = index + value.length;
  }
  return result + escapeHtml(line.slice(cursor)) + "\n";
}

export function ComposeYamlEditor({ value, onChange, disabled = false, label, errorLine = null }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => value.split("\n"), [value]);
  const lineCount = Math.max(lines.length, 1);
  useEffect(() => {
    if (!errorLine || !textarea.current) return;
    const lineHeight = 13 * 1.62;
    const top = Math.max(0, (errorLine - 1) * lineHeight);
    const bottom = top + lineHeight;
    if (top < textarea.current.scrollTop || bottom > textarea.current.scrollTop + textarea.current.clientHeight) {
      textarea.current.scrollTop = Math.max(0, top - textarea.current.clientHeight / 3);
      syncScroll();
    }
  // Keep the error visible when live validation identifies a line outside the viewport.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorLine]);
  function syncScroll() {
    if (!textarea.current) return;
    const { scrollTop, scrollLeft } = textarea.current;
    if (gutter.current) gutter.current.scrollTop = scrollTop;
    const code = textarea.current.parentElement?.querySelector<HTMLElement>(".compose-yaml-highlight");
    if (code) { code.scrollTop = scrollTop; code.scrollLeft = scrollLeft; }
  }

  return <div className={`compose-yaml-editor${disabled ? " is-disabled" : ""}${errorLine ? " has-error" : ""}`}>
    <div className="compose-yaml-gutter" ref={gutter} aria-hidden="true">{Array.from({ length: lineCount }, (_, index) => <span className={errorLine === index + 1 ? "has-error" : ""} key={index}>{index + 1}</span>)}</div>
    <div className="compose-yaml-code-area">
      <pre className="compose-yaml-highlight" aria-hidden="true">{lines.map((line, index) => <span className={`compose-yaml-line${errorLine === index + 1 ? " has-error" : ""}`} key={index} dangerouslySetInnerHTML={{ __html: highlightLine(line).replace(/\n$/, "") || "&nbsp;" }} />)}</pre>
      <textarea ref={textarea} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} onScroll={syncScroll} spellCheck={false} autoCapitalize="off" autoCorrect="off" disabled={disabled} wrap="off" />
    </div>
  </div>;
}
