"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IconBell, IconNavCases, IconNavPeople, IconNavReports, IconHome, IconChartBar, IconChevronDown, IconChevronLeft, IconChevronRight, IconDots, IconLogout, IconMenu2, IconUserCircle, IconX, type IconComponent } from "@/components/icons";
import { PageHeaderSlots } from "@/components/page-header";
import { ThemeControls } from "@/components/theme-controls";
import { ProfilePhoto } from "@/components/profile-photo";
import { BrandLogo, Button } from "@/components/ui";
import { observeSelectedTabVisibility } from "@/lib/tab-visibility";
import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord } from "@/lib/types";
import styles from "./workspace-frame.module.css";

export type WorkspaceNavGroup = { label: string; icon: IconComponent; items: { href: string; label: string; icon: IconComponent; show: boolean }[] };
type Context = { group: string; title: string; parent?: { href: string; label: string } };
const desktopQuery = "(min-width: 40rem)";
function subscribeDesktop(change: () => void) {
  const media = matchMedia(desktopQuery);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
const desktopSnapshot = () => matchMedia(desktopQuery).matches;
const serverDesktop = () => false;

function NavigationPopup({ group, onClose, onNavigate, isActive, fallbackFocus }: { group: WorkspaceNavGroup; onClose: () => void; onNavigate: () => void; isActive: (href: string) => boolean; fallbackFocus: RefObject<HTMLButtonElement | null> }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const fallback = fallbackFocus.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (trigger?.isConnected && trigger.getClientRects().length && !trigger.closest("[inert]")) trigger.focus();
      else if (fallback?.getClientRects().length) fallback.focus();
    };
  }, [fallbackFocus]);
  return <dialog ref={dialogRef} id="workspace-submenu" className={styles.submenu} aria-labelledby="workspace-submenu-title" onCancel={onClose}
    onKeyDown={event => {
      if (event.key === "Tab" || event.key === "Escape") event.stopPropagation();
      if (event.key !== "Tab") return;
      const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')).filter(item => item.getClientRects().length);
      const first = stops[0], last = stops.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className={styles.submenuHeader}><h2 id="workspace-submenu-title">{group.label}</h2><button type="button" className={styles.iconButton} aria-label="Close submenu" onClick={onClose}><IconX className="size-4" /></button></div>
    <p className={styles.submenuDescription}>Choose a page <span>{group.items.length} pages</span></p>
    <nav className={styles.submenuList} aria-label={`${group.label} pages`}>
      {group.items.map(item => {
        const ItemIcon = item.icon;
        return <Link key={item.href} href={item.href} aria-label={item.label} aria-current={isActive(item.href) ? "page" : undefined} onNavigate={onNavigate} className={styles.submenuLink}>
          <span className={styles.submenuLinkLabel}><ItemIcon data-submenu-item-icon="" className={styles.submenuItemIcon} /><span>{item.label}</span></span>
          <IconChevronRight className="size-4" />
        </Link>;
      })}
    </nav>
  </dialog>;
}

function NotificationBell({ pathname }: { pathname: string }) {
  const [unreadCount, setUnreadCount] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => { void apiGet<{ unreadCount: number }>("/api/v1/notifications/unread-count", getBrowserApiUrl()).then(data => { if (active) setUnreadCount(data.unreadCount); }).catch(() => { if (active) setUnreadCount(0); }); };
    refresh();
    window.addEventListener("nexa-notifications-changed", refresh);
    return () => { active = false; window.removeEventListener("nexa-notifications-changed", refresh); };
  }, [pathname]);
  return <Link href="/notifications" aria-label={`Notifications, ${unreadCount} unread`} className={styles.iconButton}><IconBell className="size-5" />{unreadCount > 0 && <span className={styles.unreadBadge}>{unreadCount > 99 ? "99+" : unreadCount}</span>}</Link>;
}

export function WorkspaceFrame({ children, user, groups, context, pathname, home, notifications, isActive, onLogout }: {
  children: ReactNode; user: UserRecord | null; groups: WorkspaceNavGroup[]; context: Context; pathname: string; home: string; notifications: boolean; isActive: (href: string) => boolean; onLogout: () => Promise<void>;
}) {
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, serverDesktop);
  const frameRef = useRef<HTMLDivElement>(null);
  const responsiveFocus = useRef<HTMLElement | null>(null);
  const search = useSearchParams();
  const organizationTitles: Record<string, string> = { offices: "Offices", departments: "Departments", "business-units": "Business units", teams: "Teams" };
  const compactTitle = pathname === "/organization" ? (organizationTitles[search.get("tab") ?? "offices"] ?? context.title) : pathname === "/organization/hierarchy" ? "Organization map" : context.title;
  const router = useRouter();
  const isTl = user?.userType?.code === "TL";
  const tlSection = pathname.startsWith("/applications") ? "cases" : search.get("workspace") ?? "dashboard";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [railTooltip, setRailTooltip] = useState<{ label: string; left: number; top: number } | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const drawerReturnFocus = useRef<HTMLElement | null>(null);
  const sidebar = useRef<HTMLElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  const accountInitial = useRef<"first" | "last">("first");
  const tooltipTarget = useRef<HTMLElement | null>(null);
  const tooltipPreviousDescription = useRef<string | null>(null);
  const workspace = useRef<HTMLElement>(null);
  const breadcrumb = useRef<HTMLElement>(null);
  const [descriptionTarget, setDescriptionTarget] = useState<HTMLDivElement | null>(null);
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null);
  const activeGroup = groups.find(group => group.label === context.group);
  const popupGroup = groups.find(group => group.label === groupName);
  const navigationModalOpen = (!desktop && mobileOpen) || Boolean(groupName);
  const allItems = groups.flatMap(group => group.items);
  const dashboard = allItems.find(item => item.href === "/reports");
  const topItems = isTl ? [
    { href: "/reports?workspace=dashboard", label: "Dashboard" },
    { href: "/reports?workspace=cases&queue=all", label: "Cases" },
    { href: "/reports?workspace=team&view=team&queue=all", label: "My Team" },
    { href: "/reports?workspace=performance", label: "Performance & Attendance" },
    { href: "/reports?workspace=timeline", label: "Timeline" },
  ] : context.group === "Workspace" ? ["/reports", "/applications", "/targets", "/reports/compare"].flatMap(href => allItems.filter(item => item.href === href)) : activeGroup?.items ?? [];
  const permitted = new Set(allItems.map(item => item.href));
  const moreGroup: WorkspaceNavGroup = { label: "Workspace", icon: IconMenu2, items: isTl ? topItems.map(item => ({ ...item, icon: IconChartBar, show: true })) : allItems };
  const selectedPopup = groupName === "Workspace" ? moreGroup : popupGroup;
  const compactItems: { label: string; href?: string; group?: string; icon: IconComponent; active: boolean }[] = isTl ? [
    { label: "Home", href: "/reports?workspace=dashboard", icon: IconHome, active: tlSection === "dashboard" },
    { label: "Cases", href: "/reports?workspace=cases&queue=all", icon: IconNavCases, active: tlSection === "cases" },
    { label: "People", href: "/reports?workspace=team&view=team&queue=all", icon: IconNavPeople, active: tlSection === "team" },
    { label: "Reports", href: "/reports?workspace=performance", icon: IconNavReports, active: tlSection === "performance" },
  ] : [
    { label: "Home", href: home, icon: IconHome, active: pathname === home },
    ...allItems.filter(item => item.href === "/applications").map(item => ({ label: "Cases", href: item.href, icon: IconNavCases, active: context.group === "Cases" })),
    ...groups.filter(group => group.label === "People & HR").map(group => ({ label: "People", group: group.label, icon: group.label === "Reports" ? IconNavReports : IconNavPeople, active: context.group === group.label })),
    ...groups.filter(group => group.label === "Reports").map(group => ({ label: "Reports", group: group.label, icon: group.label === "Reports" ? IconNavReports : IconNavPeople, active: context.group === group.label })),
  ];
  const compactNavigation = <>{compactItems.map(item => {
    const ItemIcon = item.icon;
    return item.href ? <Link key={item.label} href={item.href} aria-current={item.active ? "page" : undefined}><ItemIcon className="size-5" /><span>{item.label}</span></Link>
      : <button key={item.label} type="button" aria-label={`${item.group} menu`} aria-haspopup="dialog" aria-expanded={groupName === item.group} aria-controls={groupName === item.group ? "workspace-submenu" : undefined} data-active={item.active} onClick={() => setGroupName(item.group!)}><ItemIcon className="size-5" /><span>{item.label}</span></button>;
  })}<button type="button" aria-label="More navigation" aria-haspopup="dialog" aria-expanded={isTl || desktop ? groupName === "Workspace" : mobileOpen} aria-controls={isTl || desktop ? groupName === "Workspace" ? "workspace-submenu" : undefined : "application-sidebar"} onClick={event => { if (isTl || desktop) setGroupName("Workspace"); else { drawerReturnFocus.current = event.currentTarget; setMobileOpen(true); } }}><IconDots className="size-5" /><span>More</span></button></>;
  if (notifications) permitted.add("/notifications");
  const ancestors = [...(dashboard && pathname !== dashboard.href ? [dashboard] : []), ...(context.parent && permitted.has(context.parent.href) ? [context.parent] : [])].filter((item, index, rows) => rows.findIndex(row => row.href === item.href) === index).map(item => isTl && item.href === "/applications" ? { ...item, href: "/reports?workspace=cases&queue=all", label: "Cases" } : item);
  const tlDashboard = pathname === "/reports" && user?.userType?.code === "TL";
  const closeGroup = useCallback(() => setGroupName(null), []);
  const hideRailTooltip = useCallback(() => {
    const target = tooltipTarget.current;
    if (target) {
      if (tooltipPreviousDescription.current === null) target.removeAttribute("aria-describedby");
      else target.setAttribute("aria-describedby", tooltipPreviousDescription.current);
    }
    tooltipTarget.current = null;
    tooltipPreviousDescription.current = null;
    setRailTooltip(null);
  }, []);
  const showRailTooltip = useCallback((target: HTMLElement) => {
    const label = target.getAttribute("aria-label");
    if (!label) return;
    if (tooltipTarget.current !== target) {
      const previous = tooltipTarget.current;
      if (previous) {
        if (tooltipPreviousDescription.current === null) previous.removeAttribute("aria-describedby");
        else previous.setAttribute("aria-describedby", tooltipPreviousDescription.current);
      }
      tooltipTarget.current = target;
      tooltipPreviousDescription.current = target.getAttribute("aria-describedby");
      target.setAttribute("aria-describedby", "application-sidebar-tooltip");
    }
    const rect = target.getBoundingClientRect();
    setRailTooltip({
      label: label.replace(/ menu$/, ""),
      left: Math.min(rect.right + 10, window.innerWidth - 120),
      top: Math.max(24, Math.min(rect.top + rect.height / 2, window.innerHeight - 24)),
    });
  }, []);
  useEffect(() => hideRailTooltip, [hideRailTooltip]);
  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hideRailTooltip();
    };
    // Dismiss the label without consuming the menu's own keyboard handling.
    document.addEventListener("keydown", dismissOnEscape, true);
    window.addEventListener("resize", hideRailTooltip);
    window.addEventListener("scroll", hideRailTooltip, true);
    return () => {
      document.removeEventListener("keydown", dismissOnEscape, true);
      window.removeEventListener("resize", hideRailTooltip);
      window.removeEventListener("scroll", hideRailTooltip, true);
    };
  }, [hideRailTooltip]);
  useEffect(() => {
    hideRailTooltip();
  }, [desktop, mobileOpen, groupName, pathname, hideRailTooltip]);
  useEffect(() => {
    if (!navigationModalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [navigationModalOpen]);

  useEffect(() => { setMobileOpen(false); setGroupName(null); setAccountOpen(false); }, [pathname]);
  useEffect(() => {
    const openModules = (event: Event) => {
      if (desktop || isTl) return;
      drawerReturnFocus.current = (event as CustomEvent<HTMLElement>).detail ?? menuTrigger.current;
      setMobileOpen(true);
    };
    window.addEventListener("nexa-open-modules", openModules);
    return () => window.removeEventListener("nexa-open-modules", openModules);
  }, [desktop, isTl]);
  useEffect(() => {
    if (!desktop && !mobileOpen && sidebar.current?.contains(document.activeElement)) frameRef.current?.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"] [aria-label="More navigation"]')?.focus();
  }, [desktop, mobileOpen]);
  useEffect(() => { if (workspace.current) return observeSelectedTabVisibility(workspace.current); }, []);
  useLayoutEffect(() => {
    const restoreResponsiveFocus = () => {
      const focused = document.activeElement === document.body ? responsiveFocus.current : document.activeElement;
      if (!(focused instanceof HTMLElement) || !frameRef.current?.contains(focused) || (focused.getClientRects().length && !focused.closest("[inert]"))) return;
      const mobileMore = frameRef.current.querySelector<HTMLElement>('nav[aria-label="Mobile navigation"] [aria-label="More navigation"]');
      if (innerWidth < 640 && mobileMore?.getClientRects().length) { mobileMore.focus(); return; }
      const selector = innerWidth < 640 ? 'nav[aria-label="Mobile navigation"] [aria-label="More navigation"], nav[aria-label="Mobile navigation"] a'
        : innerWidth < 1280 ? 'nav[aria-label="Tablet navigation"] :is(a,button)' : 'nav[aria-label="Primary"] :is(a,button)';
      Array.from(frameRef.current.querySelectorAll<HTMLElement>(selector)).find(item => item.getClientRects().length)?.focus();
    };
    restoreResponsiveFocus();
    window.addEventListener("resize", restoreResponsiveFocus);
    return () => window.removeEventListener("resize", restoreResponsiveFocus);
  }, [desktop, mobileOpen]);
  useEffect(() => {
    const nav = breadcrumb.current;
    if (nav) nav.scrollLeft = nav.scrollWidth;
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen || desktop) return;
    const restoreTrigger = drawerReturnFocus.current ?? menuTrigger.current;
    menuClose.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); setMobileOpen(false); }
      if (event.key === "Tab" && sidebar.current) {
        const stops = Array.from(sidebar.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')).filter(item => item.getClientRects().length);
        const first = stops[0], last = stops.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("keydown", keys);
      if (restoreTrigger?.getClientRects().length) restoreTrigger.focus();
    };
  }, [desktop, mobileOpen]);

  const closeAccount = useCallback((restore = true) => {
    setAccountOpen(false);
    if (restore) requestAnimationFrame(() => accountTrigger.current?.focus());
  }, []);
  useEffect(() => {
    if (!accountOpen) return;
    const items = accountMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    items?.[accountInitial.current === "last" ? items.length - 1 : 0]?.focus();
    const outside = (event: Event) => {
      if (!accountMenu.current?.contains(event.target as Node) && !accountTrigger.current?.contains(event.target as Node)) {
        const target = event.target instanceof Element ? event.target : null;
        const focusable = target?.closest('a[href],button,input,select,textarea,[tabindex]');
        closeAccount(event.type === "pointerdown" && !focusable);
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [accountOpen, closeAccount]);

  return <PageHeaderSlots.Provider value={{ description: descriptionTarget, actions: actionsTarget }}><div className={styles.canvas}><div onFocusCapture={event => { responsiveFocus.current = event.target; }} ref={frameRef} className={styles.frame} data-tl={isTl || undefined}>
    <header className={styles.topbar} inert={!desktop && mobileOpen}>
      <Link href={home} aria-label="AMAFH CORE home" className={styles.brand}><BrandLogo /></Link>
      <Link href={ancestors.at(-1)?.href ?? home} aria-label="Back to workspace" className={styles.compactBack}><IconChevronLeft className="size-[22px]" /></Link>
      <div className={styles.compactIdentity} aria-hidden="true"><strong>{compactTitle}</strong><small>{context.parent?.label ?? (context.group === "Workspace" ? "Your workspace" : context.group)}</small></div>
      <nav className={styles.desktopNav} aria-label="Primary">{groups.map(group => group.label === "Workspace" ? <Link key={group.label} href={group.items[0].href} aria-label={group.items[0].label} aria-current={context.group === group.label ? "page" : undefined}>{group.label === "Workspace" ? "Dashboard" : group.label}</Link> : <button key={group.label} type="button" aria-label={`${group.label} menu`} aria-haspopup="dialog" aria-expanded={groupName === group.label} data-active={context.group === group.label} onClick={() => setGroupName(group.label)}>{group.label}<IconChevronDown className="size-3" /></button>)}</nav>
      <div className={styles.headerActions}>
        {isTl && user.permissions.includes("Applications.Create") && <Button className={styles.createCase} onClick={() => { if (pathname === "/reports") window.dispatchEvent(new Event("nexa-create-case")); else router.push("/reports?workspace=cases&create=1"); }}>Create Case</Button>}
        {notifications && <NotificationBell pathname={pathname} />}
        <ThemeControls className={styles.headerTheme} compact />
        <div className={styles.accountAnchor} data-testid="account-actions">
          <button ref={accountTrigger} type="button" className={styles.accountTrigger} aria-label="Open user menu" aria-haspopup="menu" aria-expanded={accountOpen} aria-controls="workspace-account-menu" onClick={() => { if (accountOpen) closeAccount(); else { accountInitial.current = "first"; setAccountOpen(true); } }} onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); accountInitial.current = event.key === "ArrowUp" ? "last" : "first"; setAccountOpen(true); } }}><ProfilePhoto userId={user!.id} fullName={user!.fullName} hasPhoto={user!.hasPhoto} version={user!.updatedAt} /><span className={styles.accountCopy}>{user?.fullName}<small>{user?.userType?.name ?? "AMAFH user"}</small></span><IconChevronDown className={styles.accountChevron} /></button>
          {accountOpen && <div ref={accountMenu} id="workspace-account-menu" role="menu" aria-label="User account" className={styles.accountMenu} onKeyDown={event => {
            const items = Array.from(accountMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"], [aria-label="Appearance"] button') ?? []).filter(item => item.getClientRects().length);
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAccount(); }
            else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
            else if (event.key === "Tab") { event.preventDefault(); closeAccount(false); const controls = Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),[tabindex]')).filter(item => item.tabIndex >= 0 && item.getClientRects().length && !item.closest('[inert], [hidden]') && !accountMenu.current?.contains(item)); const triggerIndex = controls.indexOf(accountTrigger.current!); (event.shiftKey ? accountTrigger.current : controls[triggerIndex + 1] ?? accountTrigger.current)?.focus(); }
          }}>
            <ThemeControls className={styles.accountTheme} /><p className={styles.accountSummary}>{user?.fullName}<small>{user?.email}</small></p>
            <Link href="/account" role="menuitem" tabIndex={-1} onNavigate={() => closeAccount(false)}><IconUserCircle className="size-4" />My profile</Link>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeAccount(false); void onLogout(); }}><IconLogout className="size-4" />Sign out</button>
          </div>}
        </div>
        {!isTl && <button ref={menuTrigger} type="button" aria-label="Open navigation" aria-controls="application-sidebar" aria-expanded={mobileOpen} className={`${styles.iconButton} ${styles.mobileTrigger}`} onClick={event => { drawerReturnFocus.current = event.currentTarget; setMobileOpen(true); }}><IconMenu2 className="size-5" /></button>}
      </div>
    </header>
    {mobileOpen && !desktop && <button type="button" tabIndex={-1} aria-label="Close navigation backdrop" className={styles.mobileBackdrop} onClick={() => setMobileOpen(false)} />}
    {isTl && <aside className={styles.rail}><nav className={styles.compactRail} aria-label="Tablet navigation"><Link href={home} aria-label="AMAFH CORE home" className={styles.railBrand}><BrandLogo mark /></Link>{compactNavigation}</nav></aside>}
    {!isTl && <aside ref={sidebar} id="application-sidebar" aria-label="Application sidebar" role={!desktop && mobileOpen ? "dialog" : undefined} aria-modal={!desktop && mobileOpen ? true : undefined} inert={!desktop && !mobileOpen} className={styles.rail} data-mobile-open={mobileOpen}
      onClickCapture={hideRailTooltip}
      onPointerOver={event => { const target = (event.target as Element).closest<HTMLElement>("a[aria-label],button[aria-label]"); const focused = document.activeElement; if (target && !target.contains(event.relatedTarget as Node | null) && (!sidebar.current?.contains(focused) || focused === target)) showRailTooltip(target); }}
      onPointerOut={event => { const target = (event.target as Element).closest<HTMLElement>("a[aria-label],button[aria-label]"); if (target && tooltipTarget.current === target && !target.contains(event.relatedTarget as Node | null) && document.activeElement !== target) hideRailTooltip(); }}
      onFocusCapture={event => { const target = (event.target as Element).closest<HTMLElement>("a[aria-label],button[aria-label]"); if (target) showRailTooltip(target); }}
      onBlurCapture={event => { const target = (event.target as Element).closest<HTMLElement>("a[aria-label],button[aria-label]"); if (target && !target.contains(event.relatedTarget as Node | null) && !target.matches(":hover")) hideRailTooltip(); }}>
      <button ref={menuClose} type="button" aria-label="Close navigation" className={`${styles.iconButton} ${styles.mobileClose}`} onClick={() => setMobileOpen(false)}><IconX className="size-4" /></button>
      <nav className={styles.compactRail} aria-label="Tablet navigation"><Link href={home} aria-label="AMAFH CORE home" className={styles.railBrand}><BrandLogo mark /></Link>{compactNavigation}</nav>
      <nav className={styles.mainCapsule} aria-label="All modules">{groups.map(group => {
        const direct = ["Workspace", "Finance"].includes(group.label);
        const MainIcon = group.icon;
        const active = context.group === group.label;
        return direct ? <Link key={group.label} href={group.items[0].href} onNavigate={() => setMobileOpen(false)} aria-label={group.items[0].label} aria-current={isActive(group.items[0].href) ? "page" : undefined} className={styles.railButton}><MainIcon className="size-5" /><span>{group.label}</span></Link> : <button key={group.label} type="button" aria-label={`${group.label} menu`} aria-haspopup="dialog" aria-expanded={groupName === group.label} aria-controls={groupName === group.label ? "workspace-submenu" : undefined} data-active={active} className={styles.railButton} onClick={() => setGroupName(group.label)}><MainIcon className="size-5" /><span>{group.label}</span></button>;
      })}</nav>
      <div className={styles.utilityCapsule}><button type="button" aria-label="Sign out" className={styles.railButton} onClick={() => void onLogout()}><IconLogout className="size-5" /></button></div>
    </aside>}
    <div id="authenticated-pwa-install-slot" className={styles.installSlot} />
    <div data-testid="authenticated-content" data-portal-role={user?.userType?.code === "TL" ? "TL" : undefined} className={styles.content} inert={!desktop && mobileOpen}>
      <nav className={styles.topNav} aria-label="Workspace pages">{topItems.map(item => <Link key={item.href} href={item.href} aria-current={(isTl ? pathname === "/reports" || pathname.startsWith("/applications") ? new URLSearchParams(item.href.split("?")[1]).get("workspace") === tlSection : false : isActive(item.href)) ? "page" : undefined}>{item.label}</Link>)}</nav>
      <div data-testid="page-header" className={styles.pageHeader} data-compact={tlDashboard}>
        <div className={styles.pageIdentity}>
        <nav ref={breadcrumb} aria-label="Breadcrumb" className={tlDashboard ? "sr-only" : styles.breadcrumb}>{ancestors.map(item => <span key={item.href} className="contents"><Link href={item.href}>{item.label}</Link><IconChevronRight className="size-3" /></span>)}<span aria-current="page">{context.title}</span></nav>
          <h1 className={tlDashboard ? "sr-only" : undefined}>{context.title}</h1>
          <div ref={setDescriptionTarget} className={styles.pageDescription} />
        </div>
        <div ref={setActionsTarget} data-page-header-actions="" className={styles.pageActions} />
      </div>
      <main ref={workspace} data-amafh-workspace="" data-testid="page-main" className={styles.workspace}>{children}</main>
    </div>
    <nav className={styles.bottomNav} aria-label="Mobile navigation" inert={!desktop && mobileOpen}>{compactNavigation}</nav>
    {selectedPopup && <NavigationPopup key={selectedPopup.label} group={selectedPopup} onClose={closeGroup} onNavigate={() => { setGroupName(null); setMobileOpen(false); }} isActive={isActive} fallbackFocus={menuTrigger} />}
    {railTooltip && createPortal(<span id="application-sidebar-tooltip" role="tooltip" className={styles.railTooltip} style={{ left: railTooltip.left, top: railTooltip.top }}>{railTooltip.label}</span>, document.body)}
  </div></div></PageHeaderSlots.Provider>;
}
