import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "NEXA BOS",
  description: "NEXA BOS engineering foundation",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  NEXA BOS
                </p>
                <h1 className="text-lg font-semibold text-slate-900">Brokerage Operating System</h1>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                Engineering foundation
              </span>
            </div>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
          <footer className="border-t border-slate-200 bg-white">
            <div className="mx-auto w-full max-w-5xl px-6 py-4 text-sm text-slate-500">
              Internal platform foundation. No business modules are enabled yet.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
