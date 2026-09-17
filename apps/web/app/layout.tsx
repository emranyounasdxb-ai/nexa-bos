import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";

import { AppShell } from "@/components/app-shell";
import { PwaManager } from "@/components/pwa-manager";
import { ThemeSync } from "@/components/theme-controls";
import { themeBootstrapScript } from "@/lib/theme-bootstrap";

import "./globals.css";

const manrope = localFont({
  src: "../public/fonts/manrope/manrope-variable.ttf",
  variable: "--font-manrope",
  weight: "200 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AMAFH CORE",
  description: "AMAFH CORE business operations workspace",
  applicationName: "AMAFH CORE",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AMAFH CORE",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fb" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1320" },
  ],
};

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en" className={manrope.variable} data-theme="light" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} /></head>
      <body className="min-h-screen antialiased">
        <ThemeSync />
        <AppShell>
          {children}
          {modal}
        </AppShell>
        <PwaManager />
      </body>
    </html>
  );
}
