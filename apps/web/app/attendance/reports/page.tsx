"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import {
  Pagination,
  type PaginatedResponse,
  SERVER_PAGE_SIZE_OPTIONS,
  type ServerPageSize,
} from "@/components/pagination";
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ErrorText,
  FilterBar,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  Th,
} from "@/components/ui";
import { todayIso, type AttendanceRecord, type AttendanceSummary } from "@/lib/attendance";
import { apiGet, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Option = { id: string; name: string; fullName?: string; employeeCode?: string; officeId?: string };

export default function AttendanceReportsPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [dateFrom, setDateFrom] = useState(todayIso().slice(0, 8) + "01");
  const [dateTo, setDateTo] = useState(todayIso());
  const [officeId, setOfficeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [status, setStatus] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [leaveTypes, setLeaveTypes] = useState<Option[]>([]);
  const [late, setLate] = useState(false);
  const [early, setEarly] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [offices, setOffices] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<(Option & { officeId: string })[]>([]);
  const [employees, setEmployees] = useState<Option[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [items, setItems] = useState<AttendanceRecord[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<ServerPageSize>(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const officeDepartments = useMemo(
    () => departments.filter((item) => !officeId || item.officeId === officeId),
    [departments, officeId],
  );

  const loadFilters = useCallback(async () => {
    const data = await apiGet<{
      offices: Option[];
      departments: (Option & { officeId: string })[];
      employees: Option[];
      leaveTypes: Option[];
    }>("/api/v1/attendance/filters", api);
    setOffices(data.offices);
    setDepartments(data.departments);
    setEmployees(data.employees);
    setLeaveTypes(data.leaveTypes);
  }, [api]);

  const load = useCallback(async (requestedPage = page, requestedPageSize = pageSize) => {
    const query = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
    if (officeId) query.set("office_id", officeId);
    if (departmentId) query.set("department_id", departmentId);
    if (employeeId) query.set("employee_id", employeeId);
    if (status) query.set("status", status);
    if (leaveTypeId) query.set("leave_type_id", leaveTypeId);
    if (late) query.set("late", "true");
    if (early) query.set("early_exit", "true");
    if (incomplete) query.set("incomplete", "true");
    query.set("page", String(requestedPage));
    query.set("page_size", String(requestedPageSize));
    try {
      setLoading(true);
      setError("");
      const data = await apiGet<PaginatedResponse<AttendanceRecord> & { summary: AttendanceSummary }>(
        `/api/v1/attendance/reports?${query}`,
        api,
      );
      setSummary(data.summary);
      setItems(data.items);
      setTotal(data.pagination.total);
      setTotalPages(data.pagination.totalPages);
    } catch (err) {
      setSummary(null);
      setItems([]);
      setError(err instanceof ApiClientError ? err.message : "Unable to load attendance report");
    } finally {
      setLoading(false);
    }
  }, [api, dateFrom, dateTo, departmentId, early, employeeId, incomplete, late, leaveTypeId, officeId, page, pageSize, status]);

  useEffect(() => {
    if (!can("Attendance.Reports")) return;
    void loadFilters().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Unable to load filters"),
    );
  }, [can, loadFilters]);

  if (!can("Attendance.Reports")) {
    return <ErrorText>Attendance reports permission is required.</ErrorText>;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Attendance reports"
        description="Attendance totals are separate from business performance metrics."
        actions={
          <ButtonLink href="/attendance" variant="secondary">
            Attendance
          </ButtonLink>
        }
      />
      <FilterBar>
        <label className="text-sm">
          From
          <DatePicker aria-label="Report from" value={dateFrom} onChange={setDateFrom} required />
        </label>
        <label className="text-sm">
          To
          <DatePicker aria-label="Report to" value={dateTo} onChange={setDateTo} required />
        </label>
        <label className="text-sm">
          Office
          <Select aria-label="Report office" value={officeId} onChange={(event) => setOfficeId(event.target.value)}>
            <option value="">All offices</option>
            {offices.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Department
          <Select
            aria-label="Report department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <option value="">All departments</option>
            {officeDepartments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Employee
          <Select aria-label="Report employee" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">All employees</option>
            {employees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.fullName ?? item.name} {item.employeeCode ? `(${item.employeeCode})` : ""}
              </option>
            ))}
          </Select>
        </label>
        <label className="text-sm">
          Status
          <Select aria-label="Report status" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option>Present</option>
            <option>Absent</option>
            <option>Leave</option>
            <option>Official Holiday</option>
            <option>Weekly Off</option>
          </Select>
        </label>
        <label className="text-sm">
          Leave type
          <Select
            aria-label="Report leave type"
            value={leaveTypeId}
            onChange={(event) => setLeaveTypeId(event.target.value)}
          >
            <option value="">All leave types</option>
            {leaveTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>
          <input type="checkbox" className="mr-2" checked={late} onChange={(event) => setLate(event.target.checked)} />
          Late
        </label>
        <label>
          <input type="checkbox" className="mr-2" checked={early} onChange={(event) => setEarly(event.target.checked)} />
          Early exit
        </label>
        <label>
          <input
            type="checkbox"
            className="mr-2"
            checked={incomplete}
            onChange={(event) => setIncomplete(event.target.checked)}
          />
          Incomplete Attendance
        </label>
        <Button type="button" onClick={() => { setPage(1); void load(1, pageSize); }}>
          Run report
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <p className="text-xs uppercase text-slate-500">Present</p>
            <p className="mt-2 text-xl font-semibold">{summary.presentCount}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-slate-500">Absent</p>
            <p className="mt-2 text-xl font-semibold">{summary.absentCount}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-slate-500">Attendance %</p>
            <p className="mt-2 text-xl font-semibold">
              {summary.attendancePercent == null ? "—" : `${summary.attendancePercent}%`}
            </p>
          </Card>
          <Card>
            <p className="text-xs uppercase text-slate-500">Attendance score</p>
            <p className="mt-2 text-xl font-semibold">{summary.attendanceScore}</p>
          </Card>
        </div>
      ) : null}
      <TableShell className={loading && items.length > 0 ? "opacity-70" : undefined}>
        <TableHead>
          <tr>
            <Th>Date</Th>
            <Th>Employee</Th>
            <Th>Status</Th>
            <Th>Time in</Th>
            <Th>Time out</Th>
            <Th>Flags</Th>
          </tr>
        </TableHead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <EmptyState>No attendance rows for the selected filters.</EmptyState>
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <tr key={item.id}>
                <Td>{item.attendanceDate}</Td>
                <Td>
                  {item.fullName} ({item.employeeCode})
                </Td>
                <Td>{item.status}</Td>
                <Td>{item.timeIn ?? "—"}</Td>
                <Td>{item.timeOut ?? "—"}</Td>
                <Td>
                  {item.isLate ? `Late ${item.lateMinutes}m ` : ""}
                  {item.isEarlyExit ? `Early ${item.earlyExitMinutes}m ` : ""}
                  {item.isIncomplete ? "Incomplete" : ""}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableShell>
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={totalPages}
        pageSizeOptions={SERVER_PAGE_SIZE_OPTIONS}
        onPageChange={(value) => {
          setPage(value);
          void load(value, pageSize);
        }}
        onPageSizeChange={(value) => {
          if (value === "all") return;
          setPage(1);
          setPageSize(value);
          void load(1, value);
        }}
      />
    </section>
  );
}
