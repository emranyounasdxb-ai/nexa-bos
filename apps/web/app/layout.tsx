import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

import "./globals.css";

export const metadata: Metadata = {
  title: "AMAFH CORE",
  description: "AMAFH CORE business operations workspace",
};

export default function RootLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AppShell>
          {children}
          {modal}
        </AppShell>
      </body>
    </html>
  );
}
