"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { apiGet, apiRequest, setCsrfToken } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord } from "@/lib/types";

const PUBLIC_PATHS = ["/login", "/setup", "/reset", "/status", "/bootstrap"];

function Shell({ children }: { children: ReactNode }) {
  const { user, can, setUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  async function logout() {
    try {
      await apiRequest("/api/v1/auth/logout", getBrowserApiUrl(), { method: "POST" });
    } catch {
      /* session already gone */
    }
    setCsrfToken(null);
    setUser(null);
    router.push("/login");
  }

  const links = [
    { href: "/users", label: "Users", show: can("Users.View") },
    { href: "/users/new", label: "Create user", show: can("Users.Create") },
    { href: "/customers", label: "Customers", show: can("Customers.View") },
    { href: "/customers/new", label: "Create customer", show: can("Customers.Create") },
    { href: "/user-types", label: "User types", show: can("UserTypes.View") },
    { href: "/organization", label: "Organization", show: true },
    { href: "/catalog", label: "Banks & products", show: true },
    { href: "/security", label: "Security", show: can("Security.ManageSettings") },
    { href: "/account", label: "My profile", show: true },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">NEXA BOS</p>
            <h1 className="text-lg font-semibold text-slate-900">NEXA BOS</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">{user?.fullName}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex w-full max-w-6xl gap-4 px-6 pb-3 text-sm">
          {links
            .filter((link) => link.show)
            .map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={
                  pathname === link.href || pathname.startsWith(`${link.href}/`)
                    ? "font-semibold text-slate-900"
                    : "text-slate-500"
                }
              >
                {link.label}
              </Link>
            ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserRecord | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void apiGet<UserRecord>("/api/v1/auth/me", getBrowserApiUrl())
      .then((current) => {
        if (current.csrfToken) {
          setCsrfToken(current.csrfToken);
        }
        setUser(current);
        setReady(true);
        if (pathname === "/login" || pathname === "/bootstrap") {
          router.replace("/users");
        }
      })
      .catch(async () => {
        setCsrfToken(null);
        setUser(null);
        setReady(true);
        if (!PUBLIC_PATHS.includes(pathname)) {
          try {
            const status = await apiGet<{ available: boolean }>(
              "/api/v1/auth/bootstrap-status",
              getBrowserApiUrl(),
            );
            router.replace(status.available ? "/bootstrap" : "/login");
          } catch {
            router.replace("/login");
          }
        }
      });
  }, [pathname, router]);

  if (!ready) {
    return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  }

  return (
    <AuthProvider user={user} setUser={setUser}>
      {PUBLIC_PATHS.includes(pathname) ? children : user ? <Shell>{children}</Shell> : children}
    </AuthProvider>
  );
}
