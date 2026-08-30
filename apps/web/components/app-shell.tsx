"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { Button, cx, focusRing } from "@/components/ui";
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

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  show: boolean;
};

type NavGroup = {
  label: string;
  icon: NavIconName;
  items: NavItem[];
};

type NavIconName =
  | "dashboard"
  | "operations"
  | "people"
  | "performance"
  | "finance"
  | "assets"
  | "administration";

const routeContext = (pathname: string) => {
  const routes = [
    { prefix: "/reports/compare", group: "Performance / Reports", title: "Comparisons" },
    { prefix: "/reports/drill-down", group: "Performance / Reports", title: "Report drill-down" },
    { prefix: "/reports/employees", group: "Performance / Reports", title: "Employee report" },
    { prefix: "/reports", group: "Workspace", title: "Dashboard" },
    { prefix: "/customers/new", group: "Operations / Customers", title: "Create customer" },
    { prefix: "/customers", group: "Operations", title: "Customers" },
    { prefix: "/applications/new", group: "Operations / Applications", title: "Create application" },
    { prefix: "/applications", group: "Operations", title: "Applications" },
    { prefix: "/workflows", group: "Operations", title: "Workflows" },
    { prefix: "/users/new", group: "People / Users", title: "Create user" },
    { prefix: "/users", group: "People", title: "Users" },
    { prefix: "/organization/hierarchy", group: "People / Organization", title: "Hierarchy" },
    { prefix: "/organization", group: "People", title: "Organization" },
    { prefix: "/attendance/reports", group: "People / Attendance", title: "Attendance reports" },
    { prefix: "/attendance/holidays", group: "People / Attendance", title: "Official holidays" },
    { prefix: "/attendance/schedules", group: "People / Attendance", title: "Schedules" },
    { prefix: "/attendance", group: "People", title: "Attendance" },
    { prefix: "/targets/kpi", group: "Performance / Targets", title: "KPI scorecards" },
    { prefix: "/targets", group: "Performance", title: "Targets" },
    { prefix: "/finance", group: "Finance", title: "Finance" },
    { prefix: "/assets/categories", group: "Assets", title: "Asset categories" },
    { prefix: "/assets/reports", group: "Assets", title: "Asset reports" },
    { prefix: "/assets", group: "Assets", title: "Asset register" },
    { prefix: "/notifications/manage", group: "Administration / Notifications", title: "Notification admin" },
    { prefix: "/notifications", group: "Administration", title: "Notifications" },
    { prefix: "/catalog", group: "Administration", title: "Banks & products" },
    { prefix: "/user-types", group: "Administration", title: "User types" },
    { prefix: "/security", group: "Administration", title: "Security" },
    { prefix: "/account", group: "Account", title: "My profile" },
  ];
  return (
    routes.find((route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) ?? {
      group: "NEXA BOS",
      title: "Workspace",
    }
  );
};

const isActiveRoute = (pathname: string, href: string) => {
  if (["/reports", "/notifications", "/attendance", "/organization", "/targets"].includes(href)) {
    return pathname === href;
  }
  if (href === "/assets") {
    return (
      pathname === href ||
      (/^\/assets\/[^/]+$/.test(pathname) &&
        pathname !== "/assets/categories" &&
        pathname !== "/assets/reports")
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
};

function NavIcon({ name }: { name: NavIconName }) {
  const paths: Record<NavIconName, ReactNode> = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    operations: (
      <>
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M3 12h18M10 12v2h4v-2" />
      </>
    ),
    people: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </>
    ),
    performance: (
      <>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    finance: (
      <>
        <rect x="3" y="5" width="18" height="15" rx="2" />
        <path d="M16 13h5M3 9h18" />
        <circle cx="16" cy="13" r="1" />
      </>
    ),
    assets: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    administration: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.17a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06L7.04 4.3l.06.06A1.65 1.65 0 0 0 8.92 4a1.65 1.65 0 0 0 1-1.51V2h4v.49A1.65 1.65 0 0 0 15 4a1.65 1.65 0 0 0 1.82.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21v4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </>
    ),
  };

  return (
    <svg
      data-testid="sidebar-main-icon"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-[18px]"
    >
      {paths[name]}
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx("size-4 transition-transform duration-200", expanded && "rotate-90")}
    >
      <path d="m7 4 6 6-6 6" />
    </svg>
  );
}

const landingFor = (user: UserRecord) =>
  user.permissions.includes("Dashboard.View") ? "/reports" : "/users";

function HolidayReminders({ compact = false }: { compact?: boolean }) {
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
      /* Keep the reminder visible when dismissal fails. */
    }
  }

  return (
    <aside
      aria-label="Holiday reminders"
      className={cx(
        compact ? "mb-4 flex gap-2 overflow-x-auto pb-1" : "mb-5 grid gap-2 md:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={cx(
            "flex min-w-0 justify-between rounded-xl border bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
            compact
              ? "min-w-[18rem] items-center gap-2 px-3 py-2 text-xs"
              : "flex-col items-start gap-3 px-4 py-3 text-sm sm:flex-row sm:items-center xl:flex-col xl:items-start",
            item.kind === "urgent" ? "border-red-200" : "border-slate-200",
          )}
        >
          <div className={cx("flex min-w-0 items-start", compact ? "gap-2" : "gap-3")}>
            <span
              aria-hidden="true"
              className={cx(
                "mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full text-xs font-bold",
                compact ? "size-6" : "size-7",
                item.kind === "urgent" ? "bg-red-50 text-red-700" : "bg-blue-50 text-[#0f4c81]",
              )}
            >
              {item.kind === "urgent" ? "!" : "i"}
            </span>
            <p className="min-w-0 text-slate-700">
              <span className="font-semibold text-slate-900">
                {item.kind === "urgent" ? "Urgent holiday reminder" : "Holiday reminder"}
              </span>
              {": "}
              {item.holiday?.name} on {item.holiday?.holidayDate}
              {item.daysUntil != null ? ` (${item.daysUntil} day(s))` : ""}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="min-h-8 shrink-0 px-2 py-1 text-xs"
            onClick={() => void dismiss(item.id)}
          >
            Dismiss
          </Button>
        </div>
      ))}
    </aside>
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
        "relative inline-flex size-10 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      <span aria-hidden="true" className="text-base grayscale">
        🔔
      </span>
      {unreadCount > 0 ? (
        <span className="absolute -right-1 -top-1 inline-flex min-w-5 justify-center rounded-full bg-[#0f4c81] px-1.5 py-0.5 text-[10px] font-bold leading-4 text-white ring-2 ring-white">
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const context = routeContext(pathname);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

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
      /* The local session is already gone. */
    }
    setCsrfToken(null);
    setUser(null);
    router.replace("/login");
    router.refresh();
  }

  const groups: NavGroup[] = [
    {
      label: "Workspace",
      icon: "dashboard",
      items: [{ href: "/reports", label: "Dashboard", shortLabel: "DB", show: can("Dashboard.View") }],
    },
    {
      label: "Operations",
      icon: "operations",
      items: [
        { href: "/customers", label: "Customers", shortLabel: "CU", show: can("Customers.View") },
        { href: "/applications", label: "Applications", shortLabel: "AP", show: can("Applications.View") },
        { href: "/workflows", label: "Workflows", shortLabel: "WF", show: can("WorkflowStages.Edit") },
      ],
    },
    {
      label: "People",
      icon: "people",
      items: [
        { href: "/users", label: "Users", shortLabel: "US", show: can("Users.View") },
        { href: "/organization", label: "Organization", shortLabel: "OR", show: true },
        { href: "/organization/hierarchy", label: "Hierarchy", shortLabel: "HI", show: can("Users.View") },
        { href: "/attendance", label: "Attendance", shortLabel: "AT", show: can("Attendance.View") },
        { href: "/attendance/reports", label: "Attendance reports", shortLabel: "AR", show: can("Attendance.Reports") },
      ],
    },
    {
      label: "Performance",
      icon: "performance",
      items: [
        { href: "/targets", label: "Targets", shortLabel: "TG", show: can("Targets.View") },
        { href: "/targets/kpi", label: "KPI scorecards", shortLabel: "KP", show: can("Targets.View") },
        { href: "/reports/compare", label: "Reports", shortLabel: "RP", show: can("Reports.View") },
      ],
    },
    {
      label: "Finance",
      icon: "finance",
      items: [
        {
          href: "/finance",
          label: "Finance",
          shortLabel: "FI",
          show: can("Finance.View") || can("Finance.ViewCommissionRules"),
        },
      ],
    },
    {
      label: "Assets",
      icon: "assets",
      items: [
        { href: "/assets", label: "Assets", shortLabel: "AS", show: can("Assets.View") },
        { href: "/assets/categories", label: "Asset categories", shortLabel: "AC", show: can("Assets.ManageMaster") },
        { href: "/assets/reports", label: "Asset reports", shortLabel: "AR", show: can("Assets.View") },
      ],
    },
    {
      label: "Administration",
      icon: "administration",
      items: [
        { href: "/catalog", label: "Banks & products", shortLabel: "BP", show: true },
        { href: "/user-types", label: "User types", shortLabel: "UT", show: can("UserTypes.View") },
        { href: "/notifications", label: "Notifications", shortLabel: "NO", show: can("Notifications.View") },
        {
          href: "/notifications/manage",
          label: "Notification admin",
          shortLabel: "NA",
          show:
            can("Notifications.ManageRules") ||
            can("Notifications.SendUrgent") ||
            can("Notifications.ViewAudit"),
        },
        { href: "/security", label: "Security", shortLabel: "SE", show: can("Security.ManageSettings") },
      ],
    },
  ];

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.show) }))
    .filter((group) => group.items.length > 0);
  const dashboardItem = visibleGroups.find((group) => group.label === "Workspace")?.items[0];
  const menuGroups = visibleGroups.filter((group) => group.label !== "Workspace");
  const initials = (user?.fullName ?? "NEXA User")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  function toggleGroup(label: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }

  return (
    <div className="min-h-screen lg:flex">
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <aside
        aria-label="Application sidebar"
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:sticky lg:top-0 lg:z-20 lg:h-screen lg:translate-x-0 lg:transition-[width]",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          sidebarCollapsed ? "lg:w-20" : "lg:w-72",
        )}
      >
        <div className="flex h-[70px] shrink-0 items-center justify-between border-b border-slate-200 px-5">
          <Link
            href={can("Dashboard.View") ? "/reports" : "/users"}
            className={cx(focusRing, "flex min-w-0 items-center gap-3 rounded-md")}
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-md bg-[#0f4c81] text-sm font-bold tracking-tight text-white">
              NX
            </span>
            <span className={cx("min-w-0", sidebarCollapsed && "lg:hidden")}>
              <span className="block text-sm font-bold tracking-[0.12em] text-slate-900">NEXA BOS</span>
              <span className="block truncate text-[11px] text-slate-500">Business operations</span>
            </span>
          </Link>
          <button
            type="button"
            aria-label="Close navigation"
            className={cx(focusRing, "rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden")}
            onClick={() => setMobileNavOpen(false)}
          >
            ×
          </button>
        </div>
        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          {dashboardItem ? (
            <div className="mb-3">
              <p
                className={cx(
                  "mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400",
                  sidebarCollapsed && "lg:sr-only",
                )}
              >
                Workspace
              </p>
              <Link
                href={dashboardItem.href}
                aria-current={isActiveRoute(pathname, dashboardItem.href) ? "page" : undefined}
                title={sidebarCollapsed ? dashboardItem.label : undefined}
                className={cx(
                  focusRing,
                  "group flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors",
                  isActiveRoute(pathname, dashboardItem.href)
                    ? "bg-blue-50 text-[#0f4c81]"
                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-950",
                  sidebarCollapsed && "lg:justify-center lg:px-2",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cx(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-md border",
                    isActiveRoute(pathname, dashboardItem.href)
                      ? "border-blue-200 bg-white text-[#0f4c81]"
                      : "border-slate-200 bg-slate-50 text-slate-500 group-hover:bg-white",
                  )}
                >
                  <NavIcon name="dashboard" />
                </span>
                <span className={cx("truncate", sidebarCollapsed && "lg:sr-only")}>Dashboard</span>
              </Link>
            </div>
          ) : null}

          <div className="space-y-1">
            {menuGroups.map((group) => {
              const expanded = expandedGroups.has(group.label);
              const groupActive = group.items.some((item) => isActiveRoute(pathname, item.href));
              const groupId = `sidebar-group-${group.label.toLowerCase().replace(/\s+/g, "-")}`;
              return (
                <div key={group.label}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={groupId}
                    aria-label={`${group.label} menu`}
                    title={sidebarCollapsed ? group.label : undefined}
                    className={cx(
                      focusRing,
                      "group relative flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition-colors",
                      groupActive
                        ? "bg-blue-50 text-[#0f4c81]"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-950",
                      sidebarCollapsed && "lg:justify-center lg:px-2",
                    )}
                    onClick={() => toggleGroup(group.label)}
                  >
                    <span
                      aria-hidden="true"
                      className={cx(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border",
                        groupActive
                          ? "border-blue-200 bg-white text-[#0f4c81]"
                          : "border-slate-200 bg-slate-50 text-slate-500 group-hover:bg-white",
                      )}
                    >
                      <NavIcon name={group.icon} />
                    </span>
                    <span className={cx("min-w-0 flex-1 truncate", sidebarCollapsed && "lg:sr-only")}>
                      {group.label}
                    </span>
                    <span
                      className={cx(
                        "ml-auto shrink-0 text-slate-400",
                        sidebarCollapsed && "lg:absolute lg:bottom-1 lg:right-1",
                      )}
                    >
                      <ChevronIcon expanded={expanded} />
                    </span>
                  </button>

                  <div
                    id={groupId}
                    hidden={!expanded}
                    className={cx(
                      "ml-7 mt-1 space-y-0.5 border-l border-slate-200 pl-3",
                      sidebarCollapsed && "lg:ml-0 lg:border-l-0 lg:pl-0",
                    )}
                  >
                    {group.items.map((item) => {
                      const active = isActiveRoute(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          aria-current={active ? "page" : undefined}
                          aria-label={sidebarCollapsed ? item.label : undefined}
                          title={sidebarCollapsed ? item.label : undefined}
                          className={cx(
                            focusRing,
                            "group flex min-h-9 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors",
                            active
                              ? "bg-blue-50 text-[#0f4c81]"
                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                            sidebarCollapsed && "lg:justify-center lg:px-1.5",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cx(
                              "size-1.5 shrink-0 rounded-full bg-current opacity-50",
                              sidebarCollapsed && "lg:hidden",
                            )}
                          />
                          <span className={cx("truncate", sidebarCollapsed && "lg:sr-only")}>
                            {item.label}
                          </span>
                          <span
                            aria-hidden="true"
                            className={cx(
                              "hidden text-[10px] font-bold tracking-wide",
                              sidebarCollapsed && "lg:inline",
                            )}
                          >
                            {item.shortLabel}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </nav>
        <div className="hidden shrink-0 border-t border-slate-200 p-3 lg:block">
          <button
            type="button"
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cx(
              focusRing,
              "flex w-full items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900",
            )}
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            <span aria-hidden="true">{sidebarCollapsed ? "→" : "←"}</span>
            <span className={cx(sidebarCollapsed && "sr-only")}>
              {sidebarCollapsed ? "Expand" : "Collapse sidebar"}
            </span>
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-[70px] items-center justify-between gap-4 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              aria-label="Open navigation"
              className={cx(
                focusRing,
                "inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-slate-200 text-lg text-slate-600 hover:bg-slate-50 lg:hidden",
              )}
              onClick={() => setMobileNavOpen(true)}
            >
              ☰
            </button>
            <div className="min-w-0">
              <p className="truncate text-[11px] font-medium text-slate-500">{context.group}</p>
              <p className="truncate text-sm font-semibold text-slate-900 sm:text-base">{context.title}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {can("Notifications.View") ? <NotificationBell /> : null}
            <details className="group relative">
              <summary
                aria-label="Open user menu"
                className={cx(
                  focusRing,
                  "flex cursor-pointer list-none items-center gap-2 rounded-md border border-transparent p-1.5 hover:border-slate-200 hover:bg-slate-50 [&::-webkit-details-marker]:hidden",
                )}
              >
                <span className="inline-flex size-8 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">
                  {initials}
                </span>
                <span className="hidden max-w-40 text-left sm:block">
                  <span className="block truncate text-xs font-semibold text-slate-900">{user?.fullName}</span>
                  <span className="block truncate text-[10px] text-slate-500">
                    {user?.userType?.name ?? "NEXA user"}
                  </span>
                </span>
                <span aria-hidden="true" className="hidden text-xs text-slate-400 sm:inline">
                  ⌄
                </span>
              </summary>
              <div className="absolute right-0 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-[0_12px_28px_rgba(15,23,42,0.12)]">
                <div className="border-b border-slate-100 px-3 py-2 sm:hidden">
                  <p className="truncate text-sm font-semibold text-slate-900">{user?.fullName}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                </div>
                <Link
                  href="/account"
                  onClick={(event) => {
                    const menu = event.currentTarget.closest("details");
                    if (menu) {
                      menu.open = false;
                    }
                  }}
                  className={cx(
                    focusRing,
                    "block rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900",
                  )}
                >
                  My profile
                </Link>
                <button
                  type="button"
                  className={cx(
                    focusRing,
                    "block w-full rounded-md px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900",
                  )}
                  onClick={() => void logout()}
                >
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {can("Attendance.View") ? <HolidayReminders compact={pathname === "/reports"} /> : null}
          {children}
        </main>
      </div>
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
          router.replace(landingFor(current));
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
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f6f8]" role="status">
        <span className="inline-flex items-center gap-3 text-sm text-slate-500">
          <span
            className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-[#0f4c81]"
            aria-hidden="true"
          />
          Loading NEXA BOS…
        </span>
      </div>
    );
  }

  return (
    <AuthProvider user={user} setUser={setUser}>
      {PUBLIC_PATHS.includes(pathname) ? children : user ? <Shell>{children}</Shell> : children}
    </AuthProvider>
  );
}
