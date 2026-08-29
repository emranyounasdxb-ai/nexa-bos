"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import {
  Badge,
  Button,
  ButtonLink,
  EmptyState,
  ErrorText,
  FilterBar,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
  controlClass,
} from "@/components/ui";
import { ATTENDANCE_STATUSES, todayIso, type AttendanceRecord } from "@/lib/attendance";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type FilterOffice = { id: string; name: string; code: string };
type FilterDept = { id: string; name: string; officeId: string };
type LeaveType = { id: string; name: string; code: string };
type RosterItem = {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  officeName: string | null;
  departmentName: string | null;
  suggestedStatus: string | null;
  record: AttendanceRecord | null;
};
type Draft = {
  status: string;
  timeIn: string;
  timeOut: string;
  notes: string;
  leaveTypeId: string;
};

export default function AttendancePage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [date, setDate] = useState(todayIso());
  const [officeId, setOfficeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [offices, setOffices] = useState<FilterOffice[]>([]);
  const [departments, setDepartments] = useState<FilterDept[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [items, setItems] = useState<RosterItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [holiday, setHoliday] = useState<{ name: string } | null>(null);
  const [weeklyOff, setWeeklyOff] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [correcting, setCorrecting] = useState<AttendanceRecord | null>(null);
  const [reason, setReason] = useState("");
  const loadGeneration = useRef(0);
  const canManage = can("Attendance.Manage");
  const canCorrect = can("Attendance.Correct");

  const officeDepartments = useMemo(
    () => departments.filter((item) => !officeId || item.officeId === officeId),
    [departments, officeId],
  );

  const loadFilters = useCallback(async () => {
    const data = await apiGet<{
      offices: FilterOffice[];
      departments: FilterDept[];
      leaveTypes: LeaveType[];
    }>("/api/v1/attendance/filters", api);
    setOffices(data.offices);
    setDepartments(data.departments);
    setLeaveTypes(data.leaveTypes);
  }, [api]);

  const loadDay = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const query = new URLSearchParams({ attendance_date: date });
    if (officeId) query.set("office_id", officeId);
    if (departmentId) query.set("department_id", departmentId);
    setLoading(true);
    try {
      setError("");
      const data = await apiGet<{
        items: RosterItem[];
        officialHoliday: { name: string } | null;
        isWeeklyOff: boolean;
      }>(`/api/v1/attendance/day?${query}`, api);
      if (generation !== loadGeneration.current) return;
      setItems(data.items);
      setHoliday(data.officialHoliday);
      setWeeklyOff(data.isWeeklyOff);
      const next: Record<string, Draft> = {};
      for (const item of data.items) {
        next[item.employeeId] = {
          status: item.record?.status ?? item.suggestedStatus ?? "Present",
          timeIn: item.record?.timeIn ?? "",
          timeOut: item.record?.timeOut ?? "",
          notes: item.record?.notes ?? "",
          leaveTypeId: item.record?.leaveTypeId ?? "",
        };
      }
      setDrafts(next);
    } catch (err) {
      if (generation !== loadGeneration.current) return;
      setError(err instanceof ApiClientError ? err.message : "Unable to load attendance");
    } finally {
      if (generation === loadGeneration.current) {
        setLoading(false);
      }
    }
  }, [api, date, departmentId, officeId]);

  useEffect(() => {
    if (!can("Attendance.View")) return;
    void loadFilters().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : "Unable to load filters"),
    );
  }, [can, loadFilters]);

  useEffect(() => {
    if (!can("Attendance.View")) return;
    void loadDay();
  }, [can, loadDay]);

  function updateDraft(employeeId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [employeeId]: { ...current[employeeId], ...patch } }));
  }

  async function saveRow(employeeId: string) {
    const draft = drafts[employeeId];
    if (!draft) return;
    setMessage("");
    setError("");
    try {
      await apiRequest("/api/v1/attendance/records", api, {
        method: "PUT",
        body: JSON.stringify({
          attendance_date: date,
          entries: [
            {
              employee_id: employeeId,
              status: draft.status,
              time_in: draft.timeIn || null,
              time_out: draft.timeOut || null,
              notes: draft.notes || null,
              leave_type_id: draft.status === "Leave" ? draft.leaveTypeId || null : null,
            },
          ],
        }),
      });
      setMessage("Attendance saved.");
      await loadDay();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    }
  }

  async function submitCorrection() {
    if (!correcting) return;
    const draft = drafts[correcting.employeeId];
    if (!draft) return;
    setError("");
    try {
      await apiRequest(`/api/v1/attendance/records/${correcting.id}/corrections`, api, {
        method: "POST",
        body: JSON.stringify({
          reason,
          status: draft.status,
          time_in: draft.timeIn || null,
          time_out: draft.timeOut || null,
          notes: draft.notes,
          leave_type_id: draft.status === "Leave" ? draft.leaveTypeId || null : null,
          clear_time_in: !draft.timeIn,
          clear_time_out: !draft.timeOut,
        }),
      });
      setCorrecting(null);
      setReason("");
      setMessage("Attendance corrected.");
      await loadDay();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Correction failed");
    }
  }

  if (!can("Attendance.View")) {
    return <ErrorText>Attendance permission is required.</ErrorText>;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Attendance"
        description="Daily attendance for employees in your visibility scope."
        actions={
          <>
            {can("Attendance.Manage") ? (
              <>
                <ButtonLink href="/attendance/schedules" variant="secondary">
                  Schedules
                </ButtonLink>
                <ButtonLink href="/attendance/holidays" variant="secondary">
                  Official holidays
                </ButtonLink>
              </>
            ) : null}
            {can("Attendance.Reports") ? (
              <ButtonLink href="/attendance/reports" variant="secondary">
                Attendance reports
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <FilterBar>
        <label className="text-sm">
          Date
          <DatePicker aria-label="Attendance date" value={date} onChange={setDate} required />
        </label>
        <label className="text-sm">
          Office
          <Select
            aria-label="Office"
            value={officeId}
            onChange={(event) => {
              setOfficeId(event.target.value);
              setDepartmentId("");
            }}
          >
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
          <Select aria-label="Department" value={departmentId} onChange={(event) => setDepartmentId(event.target.value)}>
            <option value="">All departments</option>
            {officeDepartments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>
      {holiday ? <p className="text-sm font-medium text-slate-800">Official Holiday: {holiday.name}</p> : null}
      {weeklyOff ? <p className="text-sm font-medium text-slate-800">Weekly Off</p> : null}
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      <TableShell>
        <TableHead>
          <tr>
            <Th>Employee</Th>
            <Th>Status</Th>
            <Th>Time in</Th>
            <Th>Time out</Th>
            <Th>Flags</Th>
            <Th>Notes</Th>
            <Th>Actions</Th>
          </tr>
        </TableHead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={7}>
                <EmptyState>No employees in scope for this date and filter.</EmptyState>
              </td>
            </tr>
          ) : (
            items.map((item) => {
              const draft = drafts[item.employeeId];
              return (
                <tr key={item.employeeId}>
                  <Td>
                    <div>{item.fullName}</div>
                    <div className="text-xs text-slate-500">
                      {item.employeeCode}
                      {item.officeName ? ` · ${item.officeName}` : ""}
                    </div>
                  </Td>
                  <Td>
                    <select
                      aria-label={`${item.fullName} status`}
                      className={controlClass}
                      value={draft?.status ?? "Present"}
                      onChange={(event) => updateDraft(item.employeeId, { status: event.target.value })}
                      disabled={!canManage && !canCorrect}
                    >
                      {ATTENDANCE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                    {draft?.status === "Leave" ? (
                      <select
                        aria-label={`${item.fullName} leave type`}
                        className={`mt-1 ${controlClass}`}
                        value={draft.leaveTypeId}
                        onChange={(event) => updateDraft(item.employeeId, { leaveTypeId: event.target.value })}
                        disabled={!canManage && !canCorrect}
                      >
                        <option value="">Select leave type</option>
                        {leaveTypes.map((leave) => (
                          <option key={leave.id} value={leave.id}>
                            {leave.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </Td>
                  <Td>
                    <input
                      aria-label={`${item.fullName} time in`}
                      type="time"
                      className={controlClass}
                      value={draft?.timeIn ?? ""}
                      onChange={(event) => updateDraft(item.employeeId, { timeIn: event.target.value })}
                      disabled={!canManage && !canCorrect}
                    />
                  </Td>
                  <Td>
                    <input
                      aria-label={`${item.fullName} time out`}
                      type="time"
                      className={controlClass}
                      value={draft?.timeOut ?? ""}
                      onChange={(event) => updateDraft(item.employeeId, { timeOut: event.target.value })}
                      disabled={!canManage && !canCorrect}
                    />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {item.record?.isLate ? <Badge>Late {item.record.lateMinutes}m</Badge> : null}
                      {item.record?.isEarlyExit ? <Badge>Early {item.record.earlyExitMinutes}m</Badge> : null}
                      {item.record?.isIncomplete ? <Badge>Incomplete Attendance</Badge> : null}
                      {item.record?.workedOnHoliday ? <Badge>Worked on holiday</Badge> : null}
                      {item.record?.calculationState === "schedule_missing" ? (
                        <Badge>Schedule missing</Badge>
                      ) : null}
                    </div>
                  </Td>
                  <Td>
                    <input
                      aria-label={`${item.fullName} notes`}
                      className={controlClass}
                      value={draft?.notes ?? ""}
                      onChange={(event) => updateDraft(item.employeeId, { notes: event.target.value })}
                      disabled={!canManage && !canCorrect}
                    />
                  </Td>
                  <Td>
                    <div className="flex flex-col gap-1">
                      {canManage && !item.record ? (
                        <Button
                          type="button"
                          aria-label={`${item.fullName} save`}
                          onClick={() => void saveRow(item.employeeId)}
                        >
                          Save
                        </Button>
                      ) : null}
                      {canManage && item.record && !canCorrect ? (
                        <Button
                          type="button"
                          aria-label={`${item.fullName} update`}
                          onClick={() => void saveRow(item.employeeId)}
                        >
                          Update
                        </Button>
                      ) : null}
                      {canCorrect && item.record ? (
                        <Button
                          type="button"
                          variant="secondary"
                          aria-label={`${item.fullName} correct`}
                          onClick={() => setCorrecting(item.record)}
                        >
                          Correct
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              );
            })
          )}
        </tbody>
      </TableShell>
      {correcting ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold">Correct attendance</h3>
          <p className="mt-1 text-sm text-slate-600">
            Correction reason is required. Previous values are kept in immutable history.
          </p>
          <TextInput
            aria-label="Correction reason"
            className="mt-3"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
          <div className="mt-3 flex gap-2">
            <Button type="button" onClick={() => void submitCorrection()}>
              Save correction
            </Button>
            <Button type="button" variant="secondary" onClick={() => setCorrecting(null)}>
              Cancel
            </Button>
          </div>
          {correcting.corrections.length > 0 ? (
            <ul className="mt-3 text-sm text-slate-600">
              {correcting.corrections.map((item) => (
                <li key={item.id}>
                  {item.createdAt}: {item.reason} ({item.actorName ?? "unknown"})
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {can("Attendance.Reports") ? (
        <p className="text-sm">
          <Link className="underline" href="/attendance/reports">
            Open attendance reports
          </Link>
        </p>
      ) : null}
    </section>
  );
}
