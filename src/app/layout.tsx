import type { Metadata } from "next";
import "./globals.css";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><I18nProvider><AppFrame>{children}</AppFrame></I18nProvider></body></html>;
}
