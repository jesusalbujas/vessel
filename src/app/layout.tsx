import type { Metadata } from "next";
import "./globals.css";
import "@xterm/xterm/css/xterm.css";
import { I18nProvider } from "@/lib/i18n";
import { AppFrame } from "./components/AppFrame";

export const metadata: Metadata = {
  title: "Vessel",
  description: "A self-hosted control plane for Docker resources",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// A per-request CSP nonce cannot be attached to statically prerendered scripts.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><I18nProvider><AppFrame>{children}</AppFrame></I18nProvider></body></html>;
}
