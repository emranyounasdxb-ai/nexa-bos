"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, EmptyState, ErrorText, PageHeader, Select } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import { apiGet } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";
import { AttendanceUploadContext, AttendanceUploadModal, AttendanceDaily, AttendanceEmployees, AttendanceLeaveHolidays, AttendanceManagementReports, AttendanceOverview } from "./attendance-polish";
import { AttendanceMonthControls, attendanceError, type AttendanceOptions } from "./attendance-management";
import polish from "./attendance-polish.module.css";
import styles from "./attendance-workspace.module.css";
export function AttendanceWorkspace() {
  const { can } = useAuth(), search = useSearchParams(), pathname = usePathname(), router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false), [importVersion, setImportVersion] = useState(0);
  const [options, setOptions] = useState<AttendanceOptions | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => { setError(""); try { setOptions(await apiGet<AttendanceOptions>("/api/v1/attendance/management/options", getBrowserApiUrl())); } catch (value) { setError(attendanceError(value, "Attendance options could not be loaded.")); } }, []);
  useEffect(() => { if (can("Attendance.View")) void load(); }, [can, load]);
  const views = [
    { key: "overview", label: "Overview", allowed: can("Attendance.Daily") },
    { key: "daily", label: "Daily Register", allowed: can("Attendance.Daily") },
    { key: "upload", label: "Bulk Upload", allowed: can("Attendance.Upload") || can("Attendance.ConfirmImport") },
    { key: "employees", label: "Employees", allowed: can("Attendance.Calendar") },
    { key: "leave", label: "Leave & Holidays", allowed: can("Attendance.Calendar") || can("Attendance.RecordApprovedLeave") },
    { key: "reports", label: "Reports", allowed: can("Attendance.Reports") },
  ].filter(view => view.allowed);
  const queryView = search.get("view"), requested = pathname === "/attendance/reports" ? "reports" : ["corrections", "register"].includes(queryView ?? "") ? "daily" : queryView;
  const active = views.find(view => view.key === requested && view.key !== "upload")?.key ?? views.find(view => view.key !== "upload")?.key ?? "";
  useEffect(() => { if (queryView === "upload" && (can("Attendance.Upload") || can("Attendance.ConfirmImport"))) setUploadOpen(true); }, [queryView, can]);
  if (requested && requested !== "upload" && ["overview", "daily", "employees", "leave", "reports"].includes(requested) && !views.some(view => view.key === requested)) return <EmptyState>You do not have permission to access this attendance view.</EmptyState>;
  if (!can("Attendance.View")) return <EmptyState>You do not have permission to view attendance.</EmptyState>;
  return <AttendanceUploadContext.Provider value={() => setUploadOpen(true)}><section className={polish.workspace + " min-w-0 space-y-3"}>
    <PageHeader title="Attendance" description="Attendance within your authorized office scope." actions={<>{can("Attendance.Manage") && <Link href="/attendance/schedules">Shifts & Policies</Link>}{can("Attendance.ManageHolidays") && <Link href="/attendance/holidays">Holiday Settings</Link>}</>} />
    <nav className={styles.tabs} aria-label="Attendance views">{views.map(view => view.key === "upload" ? <button type="button" key={view.key} className={styles.tab} onClick={() => setUploadOpen(true)} aria-haspopup="dialog">Bulk Upload</button> : <Link key={view.key} href={"/attendance?view=" + view.key} aria-label={view.label} title={view.label} aria-current={active === view.key ? "page" : undefined} className={styles.tab}>{view.label}</Link>)}</nav>
    <div className={styles.mobileView}><Select aria-label="Attendance workspace view" value={active ?? ""} onChange={event => event.target.value === "upload" ? setUploadOpen(true) : router.push("/attendance?view=" + event.target.value)}>{views.map(view => <option key={view.key} value={view.key}>{view.label}</option>)}</Select></div>
    <ErrorText>{error}</ErrorText>{error && <Button variant="secondary" size="compact" onClick={() => void load()}>Retry</Button>}
    {!options && !error ? <EmptyState>Loading attendance workspace…</EmptyState> : options && <>
      {active === "overview" && <AttendanceOverview options={options} />}
      {active === "daily" && <AttendanceDaily options={options} />}

      {active === "employees" && <AttendanceEmployees options={options} />}
      {active === "leave" && <AttendanceLeaveHolidays options={options} />}
      {active === "reports" && <AttendanceManagementReports options={options} importVersion={importVersion} />}
    </>}
    {options && (can("Attendance.CloseMonth") || can("Attendance.ReopenMonth")) && <AttendanceMonthControls options={options} />}
    {uploadOpen && <AttendanceUploadModal onClose={() => setUploadOpen(false)} onImported={() => setImportVersion(value => value + 1)} />}
  </section></AttendanceUploadContext.Provider>;
}
