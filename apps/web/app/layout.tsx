import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { ThemeSync } from "@/components/theme-controls";
import { themeBootstrapScript } from "@/lib/theme-bootstrap";

import "./globals.css";

export const metadata: Metadata = {
  title: "AMAFH CORE",
  description: "AMAFH CORE business operations workspace",
};

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} /></head>
      <body className="min-h-screen antialiased">
        <ThemeSync />
        <AppShell>
          {children}
          {modal}
        </AppShell>
      </body>
    </html>
  );
}
