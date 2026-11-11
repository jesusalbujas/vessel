"use client";

import { useEffect, useRef, useState } from "react";
import { Terminal as TerminalIcon, X } from "lucide-react";
import type { Service } from "@/lib/services";

export default function ContainerTerminal({ service, es, onClose, onError }: { service: Service; es: boolean; onClose: () => void; onError: (message: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [connecting, setConnecting] = useState(true);
  const [connected, setConnected] = useState(false);
  const [disconnectReason, setDisconnectReason] = useState("");
  const [shell, setShell] = useState<"bash" | "sh">("sh");
  const [activeShell, setActiveShell] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const callbacks = useRef({ onClose, onError });
  callbacks.current = { onClose, onError };

  useEffect(() => {
    let disposed = false;
    let term: import("@xterm/xterm").Terminal | null = null;
    let fit: import("@xterm/addon-fit").FitAddon | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let keyListener: ((event: KeyboardEvent) => void) | null = null;
    setConnecting(true);
    setConnected(false);
    setActiveShell("");
    async function connect() {
      try {
        const response = await fetch("/api/container-exec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ serviceId: service.id, shell }), cache: "no-store" });
        const ticket = await response.json();
        if (!response.ok) throw new Error(ticket.error || (es ? "No se pudo abrir la consola" : "Could not open console"));
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
        if (disposed || !host.current) return;
        term = new Terminal({ cursorBlink: true, convertEol: true, fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', fontSize: 13, theme: { background: "#020617", foreground: "#e2e8f0", cursor: "#93c5fd", selectionBackground: "#334155", black: "#0f172a", red: "#f87171", green: "#4ade80", yellow: "#facc15", blue: "#60a5fa", magenta: "#c084fc", cyan: "#22d3ee", white: "#e2e8f0", brightBlack: "#64748b", brightRed: "#fca5a5", brightGreen: "#86efac", brightYellow: "#fde68a", brightBlue: "#93c5fd", brightMagenta: "#d8b4fe", brightCyan: "#67e8f9", brightWhite: "#f8fafc" } });
        fit = new FitAddon(); term.loadAddon(fit); term.open(host.current); fit.fit(); term.focus();
        const endpoint = new URL("/api/container-terminal", window.location.href);
        endpoint.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(endpoint, ["vessel.container-terminal", `ticket.${ticket.token}`]); ws.binaryType = "arraybuffer"; socket.current = ws;
        ws.onopen = () => { if (disposed || !term) return; setConnecting(false); setConnected(true); setDisconnectReason(""); term.writeln(es ? `Conectado a ${ticket.name}.` : `Connected to ${ticket.name}.`); ws.send(JSON.stringify({ type: "resize", columns: term.cols, rows: term.rows })); };
        ws.onmessage = (event) => { if (!term) return; if (typeof event.data === "string") { if (event.data.startsWith("VESSEL_SHELL:")) { setActiveShell(event.data.slice("VESSEL_SHELL:".length).split("/").pop() || shell); return; } term.writeln(`\r\n\x1b[31m${event.data}\x1b[0m`); } else term.write(new Uint8Array(event.data as ArrayBuffer)); };
        ws.onerror = () => { if (!disposed) { setConnecting(false); setConnected(false); setDisconnectReason(es ? "No se pudo abrir el canal seguro de terminal en Vessel." : "Could not open Vessel's secure terminal channel."); term?.writeln(`\r\n\x1b[31m${es ? "Error de conexión con el contenedor." : "Container connection error."}\x1b[0m`); } };
        ws.onclose = (event) => { if (!disposed) { setConnecting(false); setConnected(false); setDisconnectReason(`${es ? "Conexión cerrada" : "Connection closed"} (${event.code}${event.reason ? ` · ${event.reason}` : ""})`); term?.writeln(`\r\n\x1b[90m${es ? "Sesión de consola cerrada." : "Console session closed."}\x1b[0m`); } };
        term.onData((data) => { if (ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data)); });
        term.onResize(({ cols, rows }) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "resize", columns: cols, rows })); });
        resizeObserver = new ResizeObserver(() => { try { fit?.fit(); } catch {} }); resizeObserver.observe(host.current);
        keyListener = (event) => { if (event.key === "Escape" && (event.ctrlKey || event.metaKey)) callbacks.current.onClose(); };
        window.addEventListener("keydown", keyListener);
      } catch (error) {
        if (!disposed) { setConnecting(false); callbacks.current.onError(error instanceof Error ? error.message : "Terminal connection failed"); }
      }
    }
    void connect();
    return () => { disposed = true; resizeObserver?.disconnect(); if (keyListener) window.removeEventListener("keydown", keyListener); socket.current?.close(); socket.current = null; term?.dispose(); };
  }, [service.id, es, shell]);

  return <div className="modal-backdrop terminal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="container-terminal-modal" role="dialog" aria-modal="true" aria-label={es ? `Consola ${service.name}` : `${service.name} console`}><header><div><span><TerminalIcon size={16} />{es ? "Consola del contenedor" : "Container console"}</span><strong>{service.name}</strong><small className={connected ? "is-connected" : ""}><i />{connecting ? (es ? "Conectando…" : "Connecting…") : connected ? `${es ? "Conectado" : "Connected"} · ${activeShell || shell}` : (es ? "Desconectado" : "Disconnected")}</small><div className="terminal-shell-picker"><TerminalIcon size={15} /><span>Shell</span><div className="terminal-shell-options" role="radiogroup" aria-label={es ? "Seleccionar shell" : "Select shell"}>{(["sh", "bash"] as const).map((option) => <button key={option} type="button" role="radio" aria-checked={shell === option} className={shell === option ? "is-selected" : ""} onClick={() => setShell(option)}>{option}</button>)}</div></div></div><button type="button" onClick={onClose} aria-label={es ? "Cerrar consola" : "Close console"}><X size={20} /></button></header><div className="container-terminal-screen" ref={host} />{disconnectReason ? <div className="container-terminal-error">{disconnectReason}</div> : null}<footer>{es ? "Sesión interactiva · Ctrl+C para interrumpir · Ctrl+D para salir" : "Interactive session · Ctrl+C to interrupt · Ctrl+D to exit"}</footer></section></div>;
}
