"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  IconBriefcase2,
  IconBuildingBank,
  IconBuildingCommunity,
  IconCalendarCheck,

  IconChartBar,
  IconDevices2,
  IconFileDescription,
  IconGauge,
  IconGitBranch,
  IconHierarchy3,
  IconLayoutDashboard,
  IconReportAnalytics,
  IconShieldLock,
  IconTargetArrow,
  IconUser,
  IconUsers,
  IconUsersGroup,
  IconUserShield,
  IconWallet,
  type IconComponent,
} from "@/components/icons";
import { WorkspaceFrame } from "@/components/workspace-frame";
import { apiGet, apiRequest, getCsrfToken, setCsrfToken } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";
import { setProfilePhotoSession } from "@/lib/profile-photo-cache";
import type { UserRecord } from "@/lib/types";
import { canManageCustomers, canReadCatalog, canReadOrganization, canReadWorkflows } from "@/lib/role-access";

const PUBLIC_PATHS = ["/login", "/setup", "/reset", "/status", "/bootstrap"];

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
  if (pathname !== "/applications/new" && /^\/applications\/[^/]+$/.test(pathname)) return { group: "Cases", title: "Application details", parent: { href: "/applications", label: "Applications" } };
  if (pathname !== "/customers/new" && /^\/customers\/[^/]+$/.test(pathname)) return { group: "Cases", title: "Customer details", parent: { href: "/customers", label: "Customers" } };
  if (/^\/users\/[^/]+\/edit$/.test(pathname)) return { group: "People & HR", title: "Edit employee profile", parent: { href: "/users", label: "Users" } };
  if (pathname !== "/users/new" && /^\/users\/[^/]+$/.test(pathname)) return { group: "People & HR", title: "Employee profile", parent: { href: "/users", label: "Users" } };
  if (/^\/assets\/[^/]+$/.test(pathname) && !["/assets/categories", "/assets/reports"].includes(pathname)) return { group: "Operations", title: "Asset details", parent: { href: "/assets", label: "Assets" } };
  if (/^\/user-types\/[^/]+$/.test(pathname)) return { group: "Administration", title: "Designation details", parent: { href: "/user-types", label: "Designations" } };
  const routes = [
    { prefix: "/reports/compare", group: "Reports", title: "Comparisons" },
    { prefix: "/reports/drill-down", group: "Reports", title: "Report drill-down", parent: { href: "/reports/compare", label: "Reports" } },
    { prefix: "/reports/employees", group: "Reports", title: "Employee report", parent: { href: "/reports/compare", label: "Reports" } },
    { prefix: "/reports", group: "Workspace", title: "Dashboard" },
    { prefix: "/customers/new", group: "Cases", title: "Create customer", parent: { href: "/customers", label: "Customers" } },
    { prefix: "/customers", group: "Cases", title: "Customers" },
    { prefix: "/applications/new", group: "Cases", title: "Create application", parent: { href: "/applications", label: "Applications" } },
    { prefix: "/applications", group: "Cases", title: "Applications" },
    { prefix: "/workflows", group: "Operations", title: "Workflow Designer" },
    { prefix: "/case-operations", group: "Operations", title: "Case Operations" },
    { prefix: "/users/new", group: "People & HR", title: "Create user", parent: { href: "/users", label: "Users" } },
    { prefix: "/users", group: "People & HR", title: "Users" },
    { prefix: "/hr", group: "People & HR", title: "HR Dashboard" },
    { prefix: "/pro", group: "People & HR", title: "PRO Dashboard" },
    { prefix: "/organization/hierarchy", group: "People & HR", title: "Organization hierarchy", parent: { href: "/organization", label: "Organization" } },
    { prefix: "/organization", group: "People & HR", title: "Organization masters" },
    { prefix: "/attendance/reports", group: "Reports", title: "Attendance reports", parent: { href: "/attendance", label: "Attendance" } },
    { prefix: "/attendance/holidays", group: "People & HR", title: "Official holidays", parent: { href: "/attendance", label: "Attendance" } },
    { prefix: "/attendance/schedules", group: "People & HR", title: "Attendance schedules", parent: { href: "/attendance", label: "Attendance" } },
    { prefix: "/attendance", group: "People & HR", title: "Attendance" },
    { prefix: "/leave", group: "People & HR", title: "Leave management" },
    { prefix: "/contracts", group: "People & HR", title: "Employment contracts" },
    { prefix: "/transfers", group: "People & HR", title: "Employee transfers" },
    { prefix: "/exits", group: "People & HR", title: "Exit and offboarding" },
    { prefix: "/approvals", group: "People & HR", title: "Approval Centre" },
    { prefix: "/targets/kpi", group: "Performance", title: "KPI scorecards", parent: { href: "/targets", label: "Targets" } },
    { prefix: "/targets", group: "Performance", title: "Targets" },
    { prefix: "/finance", group: "Finance", title: "Finance" },
    { prefix: "/assets", group: "Operations", title: "Asset Management" },
    { prefix: "/notifications/manage", group: "Administration", title: "Notification administration", parent: { href: "/notifications", label: "Notifications" } },
    { prefix: "/notifications", group: "Notifications", title: "Notifications" },
    { prefix: "/catalog", group: "Administration", title: "Banks and products" },
    { prefix: "/user-types", group: "Administration", title: "Designations" },
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

const landingFor = (user: UserRecord) => {
  if (user.permissions.includes("Dashboard.View")) return "/reports";
  if (user.permissions.includes("UserProfiles.HR.View")) return "/hr";
  if (user.permissions.includes("UserProfiles.PRO.View")) return "/pro";
  return user.permissions.includes("Users.View") ? "/users" : "/account";
};

function Shell({ children }: { children: ReactNode }) {
  const { user, can, setUser } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const baseContext = routeContext(pathname);
  const tlLegacyCases = user?.userType?.code === "TL" && ["/applications", "/applications/new"].includes(pathname);
  const tlForbidden = user?.userType?.code === "TL" && !(
    pathname === "/reports" || pathname === "/account" || pathname === "/notifications" ||
    pathname === "/applications" || /^\/applications\/[^/]+$/.test(pathname) ||
    pathname === "/customers" || /^\/customers\/[^/]+$/.test(pathname)
  );
  useEffect(() => {
    if (tlLegacyCases) router.replace("/reports?workspace=cases&queue=all");
    else if (tlForbidden) router.replace("/reports?workspace=dashboard");
  }, [tlLegacyCases, tlForbidden, router]);
  const context = pathname === "/reports" && user?.userType?.code === "SE"
    ? { ...baseContext, title: "My Dashboard" }
    : pathname === "/reports" && user?.userType?.code === "TL"
      ? { ...baseContext, title: "Team Leader Dashboard" }
      : baseContext;

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
    setProfilePhotoSession(null);
    setUser(null);
    router.replace("/login");
    router.refresh();
  }

  const groups: NavGroup[] = [
    {
      label: "Workspace",
      icon: IconLayoutDashboard,
      items: [{ href: user ? landingFor(user) : "/reports", label: "Dashboard", icon: IconLayoutDashboard, show: Boolean(user) && (can("Dashboard.View") || can("UserProfiles.HR.View") || can("UserProfiles.PRO.View")) }],
    },
    {
      label: "Cases",
      icon: IconFileDescription,
      items: [
        { href: "/applications", label: "Applications", icon: IconFileDescription, show: can("Applications.View") },
        { href: "/customers", label: "Customers", icon: IconUser, show: canManageCustomers(user) },
      ],
    },
    {
      label: "Operations",
      icon: IconBriefcase2,
      items: [
        { href: "/workflows", label: "Workflows", icon: IconGitBranch, show: canReadWorkflows(user) },
        { href: "/case-operations", label: "Case Operations", icon: IconHierarchy3, show: user?.userType?.code !== "TL" && (can("CaseOperations.ViewRules") || can("CaseOperations.ViewRouting") || can("CaseOperations.StageCsv") || can("CaseOperations.ViewReports")) },
        { href: "/assets", label: "Asset Management", icon: IconDevices2, show: can("Assets.View") },
      ],
    },
    {
      label: "People & HR",
      icon: IconUsersGroup,
      items: [
        { href: "/users", label: "Users", icon: IconUsers, show: can("Users.View") },
        { href: "/hr", label: "HR Dashboard", icon: IconUsersGroup, show: can("UserProfiles.HR.View") },
        { href: "/pro", label: "PRO Dashboard", icon: IconFileDescription, show: can("UserProfiles.PRO.View") },
        { href: "/organization", label: "Organization", icon: IconBuildingCommunity, show: canReadOrganization(user) },
        { href: "/organization/hierarchy", label: "Hierarchy", icon: IconHierarchy3, show: can("Users.View") },
        { href: "/attendance", label: "Attendance", icon: IconCalendarCheck, show: can("Attendance.View") },
        { href: "/leave", label: "Leave", icon: IconCalendarCheck, show: can("Leave.View") },
        {
          href: "/contracts",
          label: "Contracts",
          icon: IconFileDescription,
          show: can("Contracts.ViewOwn") || can("Contracts.View"),
        },
        { href: "/transfers", label: "Transfers", icon: IconHierarchy3, show: can("Transfers.View") || can("Transfers.ViewOwn") || can("Transfers.Recommend") },
        { href: "/exits", label: "Exit and offboarding", icon: IconFileDescription, show: can("Exits.View") || can("Exits.ViewOwn") || can("Exits.Clearance") },
        { href: "/approvals", label: "Approval Centre", icon: IconFileDescription, show: can("Approvals.View") },
      ],
    },
    {
      label: "Performance",
      icon: IconChartBar,
      items: [
        { href: "/targets", label: "Targets", icon: IconTargetArrow, show: can("Targets.View") },
        { href: "/targets/kpi", label: "KPI scorecards", icon: IconGauge, show: can("Targets.View") },
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
      label: "Reports",
      icon: IconReportAnalytics,
      items: [
        { href: "/reports/compare", label: "Comparison Reports", icon: IconReportAnalytics, show: can("Reports.View") },
        { href: "/reports/drill-down", label: "Drill-down Reports", icon: IconReportAnalytics, show: can("Reports.View") },
        { href: "/attendance/reports", label: "Attendance Reports", icon: IconReportAnalytics, show: can("Attendance.Reports") },
      ],
    },
    {
      label: "Administration",
      icon: IconShieldLock,
      items: [
        { href: "/catalog", label: "Banks & products", icon: IconBuildingBank, show: canReadCatalog(user) },
        { href: "/user-types", label: "Designations", icon: IconUserShield, show: can("UserTypes.View") },
        { href: "/security", label: "Security", icon: IconShieldLock, show: can("Security.ManageSettings") },
        { href: "/notifications/manage", label: "Notification Administration", icon: IconShieldLock, show: user?.userType?.code !== "SE" && (can("Notifications.ManageRules") || can("Notifications.SendUrgent") || can("Notifications.ViewAudit")) },
      ],
    },
  ];

  const headerOrder = ["Workspace", "Cases", "Operations", "Performance", "People & HR", "Finance", "Reports", "Administration"];
  const visibleGroups = groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.show && (user?.userType?.code !== "TL" || ["/reports", "/applications", "/customers"].includes(item.href))) }))
    .filter((group) => group.items.length > 0);
  visibleGroups.sort((left, right) => headerOrder.indexOf(left.label) - headerOrder.indexOf(right.label));
  return <WorkspaceFrame user={user} groups={visibleGroups} context={context} pathname={pathname}
    home={user ? landingFor(user) : "/login"} notifications={can("Notifications.View")}
    isActive={href => isActiveRoute(pathname, href)} onLogout={logout}>{tlLegacyCases ? <p role="status">Opening Cases…</p> : tlForbidden ? <p role="status">Returning to TL Dashboard…</p> : children}</WorkspaceFrame>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserRecord | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void apiGet<UserRecord>("/api/v1/auth/me", getBrowserApiUrl(), { signal: controller.signal })
      .then((current) => {
        if (cancelled) {
          return;
        }
        if (current.csrfToken) {
          setCsrfToken(current.csrfToken);
        }
        setProfilePhotoSession(current.id);
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
        setProfilePhotoSession(null);
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
      controller.abort();
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

