"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button, focusRing, cx } from "@/components/ui";
import { apiGet, apiRequest, getCsrfToken, setCsrfToken } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord } from "@/lib/types";

const PUBLIC_PATHS = ["/login", "/setup", "/reset", "/status", "/bootstrap"];

type Reminder = {
  id: string;
  kind: string;
  holiday: { name: string; holidayDate: string } | null;
  daysUntil: number | null;
};

function HolidayReminders() {
  const [items, setItems] = useState<Reminder[]>([]);
  const api = getBrowserApiUrl();

  useEffect(() => {
    void apiGet<{ items: Reminder[] }>("/api/v1/attendance/reminders", api)
      .then((data) => setItems(data.items))
      .catch(() => setItems([]));
  }, [api]);

  if (items.length === 0) {
    return null;
  }

  async function dismiss(id: string) {
    try {
      await apiRequest(`/api/v1/attendance/reminders/${id}/dismiss`, api, { method: "POST" });
      setItems((current) => current.filter((item) => item.id !== id));
    } catch {
      /* keep banner */
    }
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-3 text-sm sm:px-6">
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {item.kind === "urgent" ? "Urgent holiday reminder: " : "Holiday reminder: "}
              {item.holiday?.name} on {item.holiday?.holidayDate}
              {item.daysUntil != null ? ` (${item.daysUntil} day(s))` : ""}
            </p>
            <Button type="button" variant="secondary" onClick={() => void dismiss(item.id)}>
              Dismiss
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const api = getBrowserApiUrl();
  const pathname = usePathname();

  useEffect(() => {
    const refresh = () => {
      void apiGet<{ unreadCount: number }>("/api/v1/notifications/unread-count", api)
        .then((data) => setUnreadCount(data.unreadCount))
        .catch(() => setUnreadCount(0));
    };
    refresh();
    window.addEventListener("nexa-notifications-changed", refresh);
    return () => window.removeEventListener("nexa-notifications-changed", refresh);
  }, [api, pathname]);

  return (
    <Link
      href="/notifications"
      aria-label={`Notifications, ${unreadCount} unread`}
      className={cx(
        focusRing,
        "relative inline-flex min-h-9 items-center rounded-md border border-slate-300 px-3 py-1.5 text-slate-700",
      )}
    >
      <span aria-hidden="true">Bell</span>
      {unreadCount > 0 ? (
        <span className="ml-2 inline-flex min-w-5 justify-center rounded-full bg-slate-900 px-1.5 py-0.5 text-xs font-semibold text-white">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, can, setUser } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    try {
      if (!getCsrfToken()) {
        const current = await apiGet<UserRecord>("/api/v1/auth/me", getBrowserApiUrl());
        if (current.csrfToken) {
          setCsrfToken(current.csrfToken);
        }
      }
      await apiRequest("/api/v1/auth/logout", getBrowserApiUrl(), { method: "POST" });
    } catch {
      /* session already gone */
    }
    setCsrfToken(null);
    setUser(null);
    router.replace("/login");
    router.refresh();
  }

  const links = [
    { href: "/reports", label: "Dashboard", show: can("Dashboard.View") },
    { href: "/reports/compare", label: "Reports", show: can("Reports.View") },
    { href: "/targets", label: "Targets", show: can("Targets.View") },
    { href: "/targets/kpi", label: "KPI scorecards", show: can("Targets.View") },
    {
      href: "/finance",
      label: "Finance",
      show: can("Finance.View") || can("Finance.ViewCommissionRules"),
    },
    { href: "/assets", label: "Assets", show: can("Assets.View") },
    {
      href: "/assets/categories",
      label: "Asset categories",
      show: can("Assets.ManageMaster"),
    },
    { href: "/assets/reports", label: "Asset reports", show: can("Assets.View") },
    { href: "/attendance", label: "Attendance", show: can("Attendance.View") },
    { href: "/attendance/reports", label: "Attendance reports", show: can("Attendance.Reports") },
    { href: "/notifications", label: "Notifications", show: can("Notifications.View") },
    {
      href: "/notifications/manage",
      label: "Notification admin",
      show:
        can("Notifications.ManageRules") ||
        can("Notifications.SendUrgent") ||
        can("Notifications.ViewAudit"),
    },
    { href: "/users", label: "Users", show: can("Users.View") },
    { href: "/users/new", label: "Create user", show: can("Users.Create") },
    { href: "/customers", label: "Customers", show: can("Customers.View") },
    { href: "/customers/new", label: "Create customer", show: can("Customers.Create") },
    { href: "/applications", label: "Applications", show: can("Applications.View") },
    { href: "/applications/new", label: "Create application", show: can("Applications.Create") },
    { href: "/workflows", label: "Workflows", show: can("WorkflowStages.Edit") },
    { href: "/user-types", label: "User types", show: can("UserTypes.View") },
    { href: "/organization", label: "Organization", show: true },
    { href: "/catalog", label: "Banks & products", show: true },
    { href: "/security", label: "Security", show: can("Security.ManageSettings") },
    { href: "/account", label: "My profile", show: true },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">NEXA BOS</p>
            <h1 className="text-lg font-semibold text-slate-900">NEXA BOS</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-600">{user?.fullName}</span>
            {can("Notifications.View") ? <NotificationBell /> : null}
            <Button type="button" variant="secondary" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-4 gap-y-2 px-4 pb-3 text-sm sm:px-6">
          {links
            .filter((link) => link.show)
            .map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cx(
                  focusRing,
                  "rounded-sm",
                  pathname === link.href || pathname.startsWith(`${link.href}/`)
                    ? "font-semibold text-slate-900"
                    : "text-slate-500",
                )}
              >
                {link.label}
              </Link>
            ))}
        </nav>
      </header>
      {can("Attendance.View") ? <HolidayReminders /> : null}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserRecord | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void apiGet<UserRecord>("/api/v1/auth/me", getBrowserApiUrl())
      .then((current) => {
        if (cancelled) {
          return;
        }
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
        if (cancelled) {
          return;
        }
        setCsrfToken(null);
        setUser(null);
        setReady(true);
        if (!PUBLIC_PATHS.includes(pathname)) {
          try {
            const status = await apiGet<{ available: boolean }>(
              "/api/v1/auth/bootstrap-status",
              getBrowserApiUrl(),
            );
            if (!cancelled) {
              router.replace(status.available ? "/bootstrap" : "/login");
            }
          } catch {
            if (!cancelled) {
              router.replace("/login");
            }
          }
        }
      });
    return () => {
      cancelled = true;
    };
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
