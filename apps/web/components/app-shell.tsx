"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";

import {
  IconBell,
  IconBriefcase2,
  IconBuildingBank,
  IconBuildingCommunity,
  IconCalendarCheck,
  IconCategory,
  IconChartBar,
  IconChevronDown,
  IconChevronRight,
  IconDevices2,
  IconFileDescription,
  IconGauge,
  IconGitBranch,
  IconHierarchy3,
  IconLayoutDashboard,
  IconLogout,
  IconMenu2,
  IconPackages,
  IconReportAnalytics,
  IconShieldLock,
  IconTargetArrow,
  IconUser,
  IconUserCircle,
  IconUsers,
  IconUsersGroup,
  IconUserShield,
  IconWallet,
  IconX,
  type IconComponent,
} from "@/components/icons";
import { cx, focusRing } from "@/components/ui";
import { apiGet, apiRequest, getCsrfToken, setCsrfToken } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord } from "@/lib/types";
import {
  canManageCustomers,
  canReadCatalog,
  canReadOrganization,
  canReadWorkflows,
} from "@/lib/role-access";
import styles from "./app-shell.module.css";

const PUBLIC_PATHS = ["/login", "/setup", "/reset", "/status", "/bootstrap"];

// Match the existing lg sidebar layout without changing its styling or animation.
const DESKTOP_SIDEBAR_QUERY = "(min-width: 64rem)";
const getDesktopSidebarSnapshot = () => window.matchMedia(DESKTOP_SIDEBAR_QUERY).matches;
const getServerDesktopSidebarSnapshot = () => false;
function subscribeDesktopSidebar(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_SIDEBAR_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function visibleTabStops(container: ParentNode): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]',
  )).filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0
    && !element.closest('[inert], [hidden]') && getComputedStyle(element).visibility !== "hidden");
}

type NavItem = {
  href: string;
  label: string;
  icon: IconComponent;
  show: boolean;
};

type NavGroup = {
  label: string;
  icon: IconComponent;
  items: NavItem[];
};

type RouteContext = { group: string; title: string; parent?: { href: string; label: string } };

const routeContext = (pathname: string): RouteContext => {
  if (pathname !== "/applications/new" && /^\/applications\/[^/]+$/.test(pathname)) return { group: "Operations", title: "Application details", parent: { href: "/applications", label: "Applications" } };
  if (pathname !== "/customers/new" && /^\/customers\/[^/]+$/.test(pathname)) return { group: "Operations", title: "Customer details", parent: { href: "/customers", label: "Customers" } };
  if (/^\/users\/[^/]+\/edit$/.test(pathname)) return { group: "People", title: "Edit employee profile", parent: { href: "/users", label: "Users" } };
  if (pathname !== "/users/new" && /^\/users\/[^/]+$/.test(pathname)) return { group: "People", title: "Employee profile", parent: { href: "/users", label: "Users" } };
  if (/^\/assets\/[^/]+$/.test(pathname) && !["/assets/categories", "/assets/reports"].includes(pathname)) return { group: "Assets", title: "Asset details", parent: { href: "/assets", label: "Assets" } };
  if (/^\/user-types\/[^/]+$/.test(pathname)) return { group: "Administration", title: "User type details", parent: { href: "/user-types", label: "User types" } };
  const routes = [
    { prefix: "/reports/compare", group: "Performance", title: "Comparisons" },
    { prefix: "/reports/drill-down", group: "Performance", title: "Report drill-down", parent: { href: "/reports/compare", label: "Reports" } },
    { prefix: "/reports/employees", group: "Performance", title: "Employee report", parent: { href: "/reports/compare", label: "Reports" } },
    { prefix: "/reports", group: "Workspace", title: "Dashboard" },
    { prefix: "/customers/new", group: "Operations", title: "Create customer", parent: { href: "/customers", label: "Customers" } },
    { prefix: "/customers", group: "Operations", title: "Customers" },
    { prefix: "/applications/new", group: "Operations", title: "Create application", parent: { href: "/applications", label: "Applications" } },
    { prefix: "/applications", group: "Operations", title: "Applications" },
    { prefix: "/workflows", group: "Operations", title: "Workflow Designer" },
    { prefix: "/users/new", group: "People", title: "Create user", parent: { href: "/users", label: "Users" } },
    { prefix: "/users", group: "People", title: "Users" },
    { prefix: "/organization/hierarchy", group: "People", title: "Organization hierarchy", parent: { href: "/organization", label: "Organization" } },
    { prefix: "/organization", group: "People", title: "Organization masters" },
    { prefix: "/attendance/reports", group: "People", title: "Attendance reports", parent: { href: "/attendance", label: "Attendance" } },
    { prefix: "/attendance/holidays", group: "People", title: "Official holidays", parent: { href: "/attendance", label: "Attendance" } },
    { prefix: "/attendance/schedules", group: "People", title: "Attendance schedules", parent: { href: "/attendance", label: "Attendance" } },
    { prefix: "/attendance", group: "People", title: "Attendance" },
    { prefix: "/targets/kpi", group: "Performance", title: "KPI scorecards", parent: { href: "/targets", label: "Targets" } },
    { prefix: "/targets", group: "Performance", title: "Targets" },
    { prefix: "/finance", group: "Finance", title: "Finance" },
    { prefix: "/assets/categories", group: "Assets", title: "Asset Categories", parent: { href: "/assets", label: "Assets" } },
    { prefix: "/assets/reports", group: "Assets", title: "Asset Reports", parent: { href: "/assets", label: "Assets" } },
    { prefix: "/assets", group: "Assets", title: "Asset Register" },
    { prefix: "/notifications/manage", group: "Administration", title: "Notification administration", parent: { href: "/notifications", label: "Notifications" } },
    { prefix: "/notifications", group: "Administration", title: "Notifications" },
    { prefix: "/catalog", group: "Administration", title: "Banks and products" },
    { prefix: "/user-types", group: "Administration", title: "User types" },
    { prefix: "/security", group: "Administration", title: "Security settings" },
    { prefix: "/account", group: "Account", title: "My profile" },
    { prefix: "/status", group: "AMAFH CORE", title: "Foundation smoke page" },
  ];
  return (
    routes.find((route) => pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) ?? {
      group: "AMAFH CORE",
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

function SidebarIcon({ icon: IconComponent, item = false }: { icon: IconComponent; item?: boolean }) {
  return (
    <IconComponent
      data-testid={item ? "sidebar-item-icon" : "sidebar-main-icon"}
      className={item ? "size-4" : "size-5"}
    />
  );
}

const landingFor = (user: UserRecord) =>
  user.permissions.includes("Dashboard.View") ? "/reports" : "/users";

function NotificationBell({ onNavigate }: { onNavigate: () => void }) {
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
      onClick={onNavigate}
      aria-label={`Notifications, ${unreadCount} unread`}
      className={cx(focusRing, styles.footerAction)}
    >
      <span className={styles.footerIcon}><IconBell aria-hidden="true" className="size-5" />{unreadCount > 0 ? <span className={styles.unreadBadge}>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}</span>
      <span className={styles.footerLabel}>Notifications</span>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const { user, can, setUser } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const desktopSidebar = useSyncExternalStore(
    subscribeDesktopSidebar,
    getDesktopSidebarSnapshot,
    getServerDesktopSidebarSnapshot,
  );
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileMenuCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountInitialFocus = useRef<"first" | "last">("first");
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const baseContext = routeContext(pathname);
  const isTlDashboard = pathname === "/reports" && user?.userType?.code === "TL";
  const context =
    pathname === "/reports" && user?.userType?.code === "SE"
      ? { ...baseContext, title: "My Dashboard" }
      : isTlDashboard
        ? { ...baseContext, title: `Welcome back, ${user.fullName}` }
        : baseContext;

  useEffect(() => {
    setMobileNavOpen(false);
    setAccountMenuOpen(false);
  }, [pathname]);

  const closeAccountMenu = useCallback((restoreFocus = true) => {
    setAccountMenuOpen(false);
    if (restoreFocus) requestAnimationFrame(() => {
      const trigger = accountTriggerRef.current;
      if (trigger?.getClientRects().length && !trigger.closest("[inert]")) trigger.focus();
    });
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const items = accountMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (items?.length) items[accountInitialFocus.current === "last" ? items.length - 1 : 0].focus();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!accountMenuRef.current?.contains(target) && !accountTriggerRef.current?.contains(target)) {
        const element = target instanceof Element ? target : target.parentElement;
        const destination = element?.closest<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]')
          ?? element?.closest("label")?.control;
        // Do not pull focus away from the control the user intentionally clicked.
        const acceptsFocus = destination && !destination.matches(":disabled") && !destination.closest("[inert], [hidden]");
        closeAccountMenu(!acceptsFocus);
      }
    };
    const closeOnFocusOutside = (event: FocusEvent) => {
      const target = event.target as Node;
      if (!accountMenuRef.current?.contains(target) && !accountTriggerRef.current?.contains(target)) closeAccountMenu(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("focusin", closeOnFocusOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("focusin", closeOnFocusOutside);
    };
  }, [accountMenuOpen, closeAccountMenu]);

  useEffect(() => {
    if (!mobileNavOpen || desktopSidebar) return;
    const trigger = mobileMenuTriggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    mobileMenuCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setAccountMenuOpen(false);
        setMobileNavOpen(false);
      } else if (event.key === "Tab" && sidebarRef.current) {
        const stops = visibleTabStops(sidebarRef.current);
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (event.shiftKey && (document.activeElement === first || !sidebarRef.current.contains(document.activeElement))) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current.contains(document.activeElement))) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      // The trigger is hidden on desktop; never move focus to a hidden control.
      if (trigger?.getClientRects().length) trigger.focus();
    };
  }, [mobileNavOpen, desktopSidebar]);

  function openAccountMenu(position: "first" | "last" = "first") {
    accountInitialFocus.current = position;
    setSidebarExpanded(true);
    setAccountMenuOpen(true);
  }

  function onAccountMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = Array.from(accountMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAccountMenu();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      const container = !desktopSidebar && mobileNavOpen ? sidebarRef.current : document;
      const stops = container ? visibleTabStops(container).filter((item) => !accountMenuRef.current?.contains(item)) : [];
      const triggerIndex = stops.indexOf(accountTriggerRef.current as HTMLElement);
      const next = event.shiftKey ? accountTriggerRef.current : stops[triggerIndex + 1] ?? (!desktopSidebar ? stops[0] : accountTriggerRef.current);
      closeAccountMenu(false);
      next?.focus();
    }
  }

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
      icon: IconLayoutDashboard,
      items: [{ href: "/reports", label: "Dashboard", icon: IconLayoutDashboard, show: can("Dashboard.View") }],
    },
    {
      label: "Operations",
      icon: IconBriefcase2,
      items: [
        { href: "/customers", label: "Customers", icon: IconUser, show: canManageCustomers(user) },
        { href: "/applications", label: "Applications", icon: IconFileDescription, show: can("Applications.View") },
        { href: "/workflows", label: "Workflows", icon: IconGitBranch, show: canReadWorkflows(user) },
      ],
    },
    {
      label: "People",
      icon: IconUsersGroup,
      items: [
        { href: "/users", label: "Users", icon: IconUsers, show: can("Users.View") },
        { href: "/organization", label: "Organization", icon: IconBuildingCommunity, show: canReadOrganization(user) },
        { href: "/organization/hierarchy", label: "Hierarchy", icon: IconHierarchy3, show: can("Users.View") },
        { href: "/attendance", label: "Attendance", icon: IconCalendarCheck, show: can("Attendance.View") },
        { href: "/attendance/reports", label: "Attendance reports", icon: IconReportAnalytics, show: can("Attendance.Reports") },
      ],
    },
    {
      label: "Performance",
      icon: IconChartBar,
      items: [
        { href: "/targets", label: "Targets", icon: IconTargetArrow, show: can("Targets.View") },
        { href: "/targets/kpi", label: "KPI scorecards", icon: IconGauge, show: can("Targets.View") },
        { href: "/reports/compare", label: "Reports", icon: IconReportAnalytics, show: can("Reports.View") },
      ],
    },
    {
      label: "Finance",
      icon: IconWallet,
      items: [
        {
          href: "/finance",
          label: "Finance",
          icon: IconWallet,
          show: can("Finance.View") || can("Finance.ViewCommissionRules"),
        },
      ],
    },
    {
      label: "Assets",
      icon: IconPackages,
      items: [
        { href: "/assets", label: "Assets", icon: IconDevices2, show: can("Assets.View") },
        { href: "/assets/categories", label: "Asset categories", icon: IconCategory, show: can("Assets.ManageMaster") },
        { href: "/assets/reports", label: "Asset reports", icon: IconReportAnalytics, show: can("Assets.View") },
      ],
    },
    {
      label: "Administration",
      icon: IconShieldLock,
      items: [
        { href: "/catalog", label: "Banks & products", icon: IconBuildingBank, show: canReadCatalog(user) },
        { href: "/user-types", label: "User types", icon: IconUserShield, show: can("UserTypes.View") },
        { href: "/security", label: "Security", icon: IconShieldLock, show: can("Security.ManageSettings") },
      ],
    },
  ];

  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.show) }))
    .filter((group) => group.items.length > 0);
  const dashboardItem = visibleGroups.find((group) => group.label === "Workspace")?.items[0];
  const menuGroups = visibleGroups.filter((group) => group.label !== "Workspace");
  const permittedBreadcrumbRoutes = new Set(visibleGroups.flatMap((group) => group.items.map((item) => item.href)));
  if (can("Notifications.View")) permittedBreadcrumbRoutes.add("/notifications");
  const breadcrumbAncestors = [
    ...(dashboardItem && pathname !== dashboardItem.href ? [{ href: dashboardItem.href, label: dashboardItem.label }] : []),
    ...(context.parent && context.parent.href !== pathname && permittedBreadcrumbRoutes.has(context.parent.href) ? [context.parent] : []),
  ].filter((item, index, rows) => rows.findIndex((candidate) => candidate.href === item.href) === index);
  const initials = (user?.fullName ?? "AMAFH User")
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

  function closeNavigationAfterRouteClick() {
    setExpandedGroups(new Set());
    setSidebarExpanded(false);
    setMobileNavOpen(false);
    setAccountMenuOpen(false);
  }

  return (
    <div className="min-h-screen bg-app-background lg:flex">
      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/40 lg:hidden"
          onClick={() => { setAccountMenuOpen(false); setMobileNavOpen(false); }}
        />
      ) : null}
      <aside
        ref={sidebarRef}
        id="application-sidebar"
        aria-label="Application sidebar"
        role={!desktopSidebar && mobileNavOpen ? "dialog" : undefined}
        aria-modal={!desktopSidebar && mobileNavOpen ? true : undefined}
        inert={!desktopSidebar && !mobileNavOpen}
        data-expanded={sidebarExpanded}
        className={cx(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-full flex-col overflow-x-hidden bg-app-background transition-transform duration-200 ease-out motion-reduce:duration-0 motion-reduce:transition-none lg:sticky lg:top-0 lg:z-20 lg:h-dvh lg:translate-x-0 lg:transition-[width]",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full",
          sidebarExpanded ? "lg:w-56" : "lg:w-20",
        )}
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") setSidebarExpanded(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === "mouse" && !event.currentTarget.contains(document.activeElement)) {
            setSidebarExpanded(false);
          }
        }}
        onFocusCapture={() => setSidebarExpanded(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.matches(":hover")) {
            setSidebarExpanded(false);
          }
        }}
      >
        <div className="flex h-14 shrink-0 items-center justify-between px-5">
          <Link
            href={can("Dashboard.View") ? "/reports" : "/users"}
            onClick={closeNavigationAfterRouteClick}
            aria-label="AMAFH CORE home"
            className={cx(focusRing, "flex min-w-0 items-center gap-3 rounded-md")}
          >
            <Image
              src="/brand/amafh-core-full-logo-exact.svg"
              alt=""
              width={1551}
              height={479}
              className="h-10 w-auto max-w-[9.5rem] shrink-0 lg:hidden"
              priority
              unoptimized
            />
            {sidebarExpanded ? (
              <Image
                src="/brand/amafh-core-full-logo-exact.svg"
                alt=""
                width={1551}
                height={479}
                className="hidden h-10 w-auto max-w-[9.5rem] shrink-0 lg:block"
                priority
                unoptimized
              />
            ) : (
              <Image
                src="/brand/amafh-core-mark-exact.svg"
                alt=""
                width={801}
                height={908}
                className="hidden h-9 w-auto shrink-0 lg:block"
                priority
                unoptimized
              />
            )}
          </Link>
          <button
            ref={mobileMenuCloseRef}
            type="button"
            aria-label="Close navigation"
            className={cx(focusRing, "rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden")}
            onClick={() => { setAccountMenuOpen(false); setMobileNavOpen(false); }}
          >
            <IconX className="size-5" />
          </button>
        </div>
        <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
          {dashboardItem ? (
            <div className="mb-3">
              <p
                className={cx(
                  "mb-1 max-h-4 overflow-hidden whitespace-nowrap px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 transition-[max-height,opacity,margin] duration-200 ease-out motion-reduce:duration-0 motion-reduce:transition-none",
                  sidebarExpanded
                    ? "lg:opacity-100"
                    : "lg:invisible lg:mb-0 lg:max-h-0 lg:opacity-0",
                )}
              >
                Workspace
              </p>
              <Link
                href={dashboardItem.href}
                onClick={closeNavigationAfterRouteClick}
                aria-label={dashboardItem.label}
                aria-current={isActiveRoute(pathname, dashboardItem.href) ? "page" : undefined}
                title={!sidebarExpanded ? dashboardItem.label : undefined}
                className={cx(
                  focusRing,
                  "group flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-semibold transition-colors",
                  isActiveRoute(pathname, dashboardItem.href)
                    ? "bg-brand-soft text-brand-primary"
                    : "text-slate-700 hover:bg-slate-50 hover:text-slate-950",
                )}
              >
                <span
                  aria-hidden="true"
                  data-amafh-icon-tile=""
                  className={cx(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-md border",
                    isActiveRoute(pathname, dashboardItem.href)
                      ? "border-brand-soft bg-surface text-brand-primary"
                      : "border-slate-200 bg-slate-50 text-slate-500 group-hover:bg-white",
                  )}
                >
                  <SidebarIcon icon={dashboardItem.icon} />
                </span>
                <span
                  className={cx(
                    "max-w-36 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-out motion-reduce:duration-0 motion-reduce:transition-none",
                    sidebarExpanded
                      ? "lg:opacity-100"
                      : "lg:invisible lg:max-w-0 lg:opacity-0",
                  )}
                >
                  Dashboard
                </span>
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
                    title={!sidebarExpanded ? group.label : undefined}
                    className={cx(
                      focusRing,
                      "group relative flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition-colors",
                      groupActive
                        ? "bg-brand-soft text-brand-primary"
                        : "text-slate-700 hover:bg-slate-50 hover:text-slate-950",
                    )}
                    onClick={() => toggleGroup(group.label)}
                  >
                    <span
                      aria-hidden="true"
                      data-amafh-icon-tile=""
                      className={cx(
                        "inline-flex size-8 shrink-0 items-center justify-center rounded-md border",
                        groupActive
                          ? "border-brand-soft bg-surface text-brand-primary"
                          : "border-slate-200 bg-slate-50 text-slate-500 group-hover:bg-white",
                      )}
                    >
                      <SidebarIcon icon={group.icon} />
                    </span>
                    <span
                      className={cx(
                        "min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-out motion-reduce:duration-0 motion-reduce:transition-none",
                        sidebarExpanded
                          ? "lg:max-w-36 lg:opacity-100"
                          : "lg:invisible lg:max-w-0 lg:opacity-0",
                      )}
                    >
                      {group.label}
                    </span>
                  </button>

                  <div
                    id={groupId}
                    hidden={!expanded}
                    className={cx(
                      "ml-5 mt-1 max-h-96 space-y-0.5 overflow-hidden border-l border-slate-200 pl-2 opacity-100 transition-[max-height,opacity,margin] duration-200 ease-out motion-reduce:duration-0 motion-reduce:transition-none",
                      !sidebarExpanded &&
                        "lg:invisible lg:mt-0 lg:max-h-0 lg:pointer-events-none lg:opacity-0",
                    )}
                  >
                    {group.items.map((item) => {
                      const active = isActiveRoute(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={closeNavigationAfterRouteClick}
                          aria-current={active ? "page" : undefined}
                          aria-label={item.label}
                          title={!sidebarExpanded ? item.label : undefined}
                          className={cx(
                            focusRing,
                            "group flex min-h-9 items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors",
                            active
                              ? "bg-brand-soft text-brand-primary"
                              : "text-slate-500 hover:bg-slate-50 hover:text-slate-900",
                          )}
                        >
                          <span aria-hidden="true" className={cx("shrink-0 text-slate-400", active && "text-brand-primary")}>
                            <SidebarIcon icon={item.icon} item />
                          </span>
                          <span
                            className={cx(
                              "max-w-36 overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ease-out motion-reduce:duration-0 motion-reduce:transition-none",
                              sidebarExpanded
                                ? "lg:opacity-100"
                                : "lg:invisible lg:max-w-0 lg:opacity-0",
                            )}
                          >
                            {item.label}
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
        <div className={styles.sidebarFooter} data-testid="sidebar-footer" data-expanded={sidebarExpanded}>
          {can("Notifications.View") ? <NotificationBell onNavigate={closeNavigationAfterRouteClick} /> : null}
          <button
            ref={accountTriggerRef}
            type="button"
            aria-label="Open user menu"
            aria-haspopup="menu"
            aria-expanded={accountMenuOpen}
            aria-controls="sidebar-account-menu"
            className={cx(focusRing, styles.footerAction)}
            onClick={() => accountMenuOpen ? closeAccountMenu() : openAccountMenu()}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                openAccountMenu(event.key === "ArrowUp" ? "last" : "first");
              }
            }}
          >
            <span className={styles.avatar} aria-hidden="true">{initials}</span>
            <span className={styles.footerLabel}><span className={styles.accountName}>{user?.fullName}</span><span className={styles.accountType}>{user?.userType?.name ?? "AMAFH user"}</span></span>
            <IconChevronDown aria-hidden="true" className={cx(styles.accountChevron, accountMenuOpen && "rotate-180")} />
          </button>
          {accountMenuOpen ? <div ref={accountMenuRef} id="sidebar-account-menu" role="menu" aria-label="User account" className={styles.accountMenu} onKeyDown={onAccountMenuKeyDown}>
            <div role="presentation" className={styles.accountSummary}><p>{user?.fullName}</p><span>{user?.email}</span></div>
            <Link href="/account" role="menuitem" tabIndex={-1} onClick={closeNavigationAfterRouteClick} className={cx(focusRing, styles.accountMenuItem)}><IconUserCircle aria-hidden="true" className="size-4" />My profile</Link>
            <button type="button" role="menuitem" tabIndex={-1} className={cx(focusRing, styles.accountMenuItem)} onClick={() => { closeAccountMenu(false); void logout(); }}><IconLogout aria-hidden="true" className="size-4" />Sign out</button>
          </div> : null}
        </div>
      </aside>

      <div data-testid="authenticated-content" inert={!desktopSidebar && mobileNavOpen} className="min-w-0 flex-1">
        <header className={styles.pageHeader}>
          <div className="flex min-w-0 items-center gap-3">
            <button
              ref={mobileMenuTriggerRef}
              type="button"
              aria-label="Open navigation"
              aria-controls="application-sidebar"
              aria-expanded={mobileNavOpen}
              className={cx(
                focusRing,
                "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-200 text-lg text-slate-600 hover:bg-slate-50 lg:hidden",
              )}
              onClick={() => setMobileNavOpen(true)}
            >
              <IconMenu2 className="size-5" />
            </button>
            <nav
              aria-label="Breadcrumb"
              className="flex min-w-0 flex-nowrap items-center gap-2 whitespace-nowrap text-sm"
            >
              {breadcrumbAncestors.map((ancestor) => <span key={ancestor.href} className="contents"><Link href={ancestor.href} className={cx(focusRing, "truncate rounded-sm font-medium text-slate-500 hover:text-brand-primary hover:underline")}>{ancestor.label}</Link><IconChevronRight aria-hidden="true" className="size-4 shrink-0 text-slate-400" /></span>)}
              <h1 aria-current="page" className={cx("text-slate-900 sm:text-base", isTlDashboard ? "whitespace-normal break-words font-bold" : "truncate font-semibold")}>{context.title}</h1>
            </nav>
          </div>
        </header>
        <main className={styles.pageMain}>{children}</main>
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
      <div className="flex min-h-screen items-center justify-center bg-app-background" role="status">
        <span className="inline-flex items-center gap-3 text-sm text-slate-500">
          <span
            className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-brand-primary"
            aria-hidden="true"
          />
          Loading AMAFH CORE…
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
