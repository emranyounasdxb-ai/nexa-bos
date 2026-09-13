"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IconBell, IconChevronDown, IconChevronRight, IconLogout, IconMenu2, IconUserCircle, IconX, type IconComponent } from "@/components/icons";
import { ThemeControls } from "@/components/theme-controls";
import { BrandLogo } from "@/components/ui";
import { observeSelectedTabVisibility } from "@/lib/tab-visibility";
import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import type { UserRecord } from "@/lib/types";
import styles from "./workspace-frame.module.css";

export type WorkspaceNavGroup = { label: string; icon: IconComponent; items: { href: string; label: string; icon: IconComponent; show: boolean }[] };
type Context = { group: string; title: string; parent?: { href: string; label: string } };
const desktopQuery = "(min-width: 64rem)";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [groupName, setGroupName] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [railTooltip, setRailTooltip] = useState<{ label: string; left: number; top: number } | null>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const menuClose = useRef<HTMLButtonElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  const accountInitial = useRef<"first" | "last">("first");
  const tooltipTarget = useRef<HTMLElement | null>(null);
  const tooltipPreviousDescription = useRef<string | null>(null);
  const topNav = useRef<HTMLElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const breadcrumb = useRef<HTMLElement>(null);
  const activeGroup = groups.find(group => group.label === context.group);
  const popupGroup = groups.find(group => group.label === groupName);
  const navigationModalOpen = (!desktop && mobileOpen) || Boolean(popupGroup);
  const allItems = groups.flatMap(group => group.items);
  const dashboard = allItems.find(item => item.href === "/reports");
  const topItems = context.group === "Workspace" ? ["/reports", "/applications", "/targets", "/reports/compare"].flatMap(href => allItems.filter(item => item.href === href)) : activeGroup?.items ?? [];
  const permitted = new Set(allItems.map(item => item.href));
  if (notifications) permitted.add("/notifications");
  const ancestors = [...(dashboard && pathname !== dashboard.href ? [dashboard] : []), ...(context.parent && permitted.has(context.parent.href) ? [context.parent] : [])].filter((item, index, rows) => rows.findIndex(row => row.href === item.href) === index);
  const tlDashboard = pathname === "/reports" && user?.userType?.code === "TL";
  const initials = (user?.fullName ?? "AMAFH User").split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join("");
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
    if (!navigationModalOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [navigationModalOpen]);

  useEffect(() => { setMobileOpen(false); setGroupName(null); setAccountOpen(false); }, [pathname]);
  useEffect(() => {
    if (!desktop && !mobileOpen && sidebar.current?.contains(document.activeElement)) menuTrigger.current?.focus();
  }, [desktop, mobileOpen]);
  useEffect(() => { if (workspace.current) return observeSelectedTabVisibility(workspace.current); }, []);
  useEffect(() => {
    const nav = topNav.current;
    const reveal = () => {
      const selected = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !selected) return;
      const parent = nav.getBoundingClientRect(), child = selected.getBoundingClientRect();
      if (child.left < parent.left) nav.scrollLeft += child.left - parent.left;
      else if (child.right > parent.right) nav.scrollLeft += child.right - parent.right;
    };
    reveal();
    const resize = new ResizeObserver(reveal);
    if (nav) resize.observe(nav);
    return () => resize.disconnect();
  }, [pathname, context.group]);
  useEffect(() => {
    const nav = breadcrumb.current;
    if (nav) nav.scrollLeft = nav.scrollWidth;
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen || desktop) return;
    const restoreTrigger = menuTrigger.current;
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

  return <div className={styles.canvas}><div className={styles.frame}>
    <header className={styles.topbar} inert={!desktop && mobileOpen}>
      <Link href={home} aria-label="AMAFH CORE home" className={styles.brand}><BrandLogo /></Link>
      <nav ref={topNav} className={styles.topNav} aria-label="Workspace pages">{topItems.map(item => <Link key={item.href} href={item.href} aria-current={isActive(item.href) ? "page" : undefined}>{item.label}</Link>)}</nav>
      <div className={styles.headerActions}>
        {notifications && <NotificationBell pathname={pathname} />}
        <div className={styles.accountAnchor} data-testid="account-actions">
          <button ref={accountTrigger} type="button" className={styles.accountTrigger} aria-label="Open user menu" aria-haspopup="menu" aria-expanded={accountOpen} aria-controls="workspace-account-menu" onClick={() => { if (accountOpen) closeAccount(); else { accountInitial.current = "first"; setAccountOpen(true); } }} onKeyDown={event => { if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); accountInitial.current = event.key === "ArrowUp" ? "last" : "first"; setAccountOpen(true); } }}><span className={styles.avatar} aria-hidden="true">{initials}</span><span className={styles.accountCopy}>{user?.fullName}<small>{user?.userType?.name ?? "AMAFH user"}</small></span><IconChevronDown className={styles.accountChevron} /></button>
          {accountOpen && <div ref={accountMenu} id="workspace-account-menu" role="menu" aria-label="User account" className={styles.accountMenu} onKeyDown={event => {
            const items = Array.from(accountMenu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
            const index = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeAccount(); }
            else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); }
            else if (event.key === "Tab") { event.preventDefault(); closeAccount(false); const controls = Array.from(document.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),[tabindex]')).filter(item => item.tabIndex >= 0 && item.getClientRects().length && !item.closest('[inert], [hidden]') && !accountMenu.current?.contains(item)); const triggerIndex = controls.indexOf(accountTrigger.current!); (event.shiftKey ? accountTrigger.current : controls[triggerIndex + 1] ?? accountTrigger.current)?.focus(); }
          }}>
            <p className={styles.accountSummary}>{user?.fullName}<small>{user?.email}</small></p>
            <Link href="/account" role="menuitem" tabIndex={-1} onNavigate={() => closeAccount(false)}><IconUserCircle className="size-4" />My profile</Link>
            <button type="button" role="menuitem" tabIndex={-1} onClick={() => { closeAccount(false); void onLogout(); }}><IconLogout className="size-4" />Sign out</button>
          </div>}
        </div>
        <button ref={menuTrigger} type="button" aria-label="Open navigation" aria-controls="application-sidebar" aria-expanded={mobileOpen} className={`${styles.iconButton} ${styles.mobileTrigger}`} onClick={() => setMobileOpen(true)}><IconMenu2 className="size-5" /></button>
      </div>
    </header>
    {mobileOpen && !desktop && <button type="button" tabIndex={-1} aria-label="Close navigation backdrop" className={styles.mobileBackdrop} onClick={() => setMobileOpen(false)} />}
    <aside ref={sidebar} id="application-sidebar" aria-label="Application sidebar" role={!desktop && mobileOpen ? "dialog" : undefined} aria-modal={!desktop && mobileOpen ? true : undefined} inert={!desktop && !mobileOpen} className={styles.rail} data-mobile-open={mobileOpen}
      onPointerOver={event => { const target = (event.target as Element).closest<HTMLElement>("a[aria-label],button[aria-label]"); if (target && !target.contains(event.relatedTarget as Node | null)) showRailTooltip(target); }}
      onPointerOut={event => { const target = (event.target as Element).closest<HTMLElement>("a[aria-label],button[aria-label]"); if (target && !target.contains(event.relatedTarget as Node | null) && document.activeElement !== target) hideRailTooltip(); }}
      onFocusCapture={event => { const target = (event.target as Element).closest<HTMLElement>("a[aria-label],button[aria-label]"); if (target) showRailTooltip(target); }}
      onBlurCapture={event => { const target = (event.target as Element).closest<HTMLElement>("a[aria-label],button[aria-label]"); if (target && !target.contains(event.relatedTarget as Node | null) && !target.matches(":hover")) hideRailTooltip(); }}>
      <button ref={menuClose} type="button" aria-label="Close navigation" className={`${styles.iconButton} ${styles.mobileClose}`} onClick={() => setMobileOpen(false)}><IconX className="size-4" /></button>
      <ThemeControls className={styles.railTheme} />
      <nav className={styles.mainCapsule} aria-label="Primary">{groups.map(group => {
        const direct = ["Workspace", "Finance"].includes(group.label);
        const MainIcon = group.icon;
        const active = context.group === group.label;
        return direct ? <Link key={group.label} href={group.items[0].href} onNavigate={() => setMobileOpen(false)} aria-label={group.items[0].label} aria-current={isActive(group.items[0].href) ? "page" : undefined} className={styles.railButton}><MainIcon className="size-5" /></Link> : <button key={group.label} type="button" aria-label={`${group.label} menu`} aria-haspopup="dialog" aria-expanded={groupName === group.label} aria-controls={groupName === group.label ? "workspace-submenu" : undefined} data-active={active} className={styles.railButton} onClick={() => setGroupName(group.label)}><MainIcon className="size-5" /></button>;
      })}</nav>
      <div className={styles.utilityCapsule}><Link href="/account" aria-label="My profile" className={styles.railButton}><IconUserCircle className="size-5" /></Link><button type="button" aria-label="Sign out" className={styles.railButton} onClick={() => void onLogout()}><IconLogout className="size-5" /></button></div>
    </aside>
    <div data-testid="authenticated-content" data-portal-role={user?.userType?.code === "TL" ? "TL" : undefined} className={styles.content} inert={!desktop && mobileOpen}>
      <div data-testid="page-header" className={styles.pageHeader} data-compact={tlDashboard}>
        <nav ref={breadcrumb} aria-label="Breadcrumb" className={tlDashboard ? "sr-only" : styles.breadcrumb}>{ancestors.map(item => <span key={item.href} className="contents"><Link href={item.href}>{item.label}</Link><IconChevronRight className="size-3" /></span>)}<span aria-current="page">{context.title}</span></nav>
          <h1 className={tlDashboard ? "sr-only" : undefined}>{context.title}</h1>
      </div>
      <main ref={workspace} data-amafh-workspace="" data-testid="page-main" className={styles.workspace}>{children}</main>
    </div>
    {popupGroup && <NavigationPopup key={popupGroup.label} group={popupGroup} onClose={closeGroup} onNavigate={() => { setGroupName(null); setMobileOpen(false); }} isActive={isActive} fallbackFocus={menuTrigger} />}
    {railTooltip && createPortal(<span id="application-sidebar-tooltip" role="tooltip" className={styles.railTooltip} style={{ left: railTooltip.left, top: railTooltip.top }}>{railTooltip.label}</span>, document.body)}
  </div></div>;
}
