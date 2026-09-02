"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import { Pagination, useClientPagination } from "@/components/pagination";
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorText,
  PageHeader,
  Select,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
  controlClass,
} from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Org = { id: string; name: string; code: string; officeId?: string };
type Schedule = {
  id: string;
  officeId: string;
  departmentId: string | null;
  kind: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  ramadanFrom: string | null;
  ramadanTo: string | null;
};

const WEEKDAYS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
];

export default function SchedulesPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [offices, setOffices] = useState<Org[]>([]);
  const [departments, setDepartments] = useState<(Org & { officeId: string })[]>([]);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [officeId, setOfficeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [kind, setKind] = useState("normal");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("18:00");
  const [grace, setGrace] = useState("15");
  const [ramadanFrom, setRamadanFrom] = useState("");
  const [ramadanTo, setRamadanTo] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canManage = can("Attendance.Manage");
  const schedulesPagination = useClientPagination(schedules);
  const officeDepartments = useMemo(
    () => departments.filter((item) => !officeId || item.officeId === officeId),
    [departments, officeId],
  );

  const load = useCallback(async () => {
    try {
      setError("");
      const [scheduleData, working, filters] = await Promise.all([
        apiGet<{ items: Schedule[] }>("/api/v1/attendance/schedules", api),
        apiGet<{ weekdays: number[] }>("/api/v1/attendance/working-days", api),
        apiGet<{
          offices: Org[];
          departments: (Org & { officeId: string })[];
        }>("/api/v1/attendance/filters", api),
      ]);
      setSchedules(scheduleData.items);
      setWeekdays(working.weekdays);
      setOffices(filters.offices);
      setDepartments(filters.departments);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load schedules");
    }
  }, [api]);

  useEffect(() => {
    if (can("Attendance.View")) void load();
  }, [can, load]);

  async function saveWorkingDays() {
    setError("");
    try {
      await apiRequest("/api/v1/attendance/working-days", api, {
        method: "PUT",
        body: JSON.stringify({ weekdays }),
      });
      setMessage("Working days saved.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    }
  }

  async function createSchedule() {
    setError("");
    try {
      await apiRequest("/api/v1/attendance/schedules", api, {
        method: "POST",
        body: JSON.stringify({
          office_id: officeId,
          department_id: departmentId || null,
          kind,
          start_time: startTime,
          end_time: endTime,
          grace_minutes: Number(grace),
          ramadan_from: kind === "ramadan" ? ramadanFrom : null,
          ramadan_to: kind === "ramadan" ? ramadanTo : null,
        }),
      });
      setMessage("Schedule saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    }
  }

  if (!can("Attendance.View")) {
    return <ErrorText>Attendance permission is required.</ErrorText>;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Attendance schedules"
        description="Office and department start, end, and grace times. Working days are company-wide."
        actions={
          <ButtonLink href="/attendance" variant="secondary">
            Attendance
          </ButtonLink>
        }
      />
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold">Company working days</h3>
        <div className="flex flex-wrap gap-3">
          {WEEKDAYS.map((day) => (
            <label key={day.value} className="text-sm">
              <input
                type="checkbox"
                className="mr-2"
                checked={weekdays.includes(day.value)}
                disabled={!canManage}
                onChange={(event) => {
                  setWeekdays((current) =>
                    event.target.checked
                      ? [...current, day.value]
                      : current.filter((item) => item !== day.value),
                  );
                }}
              />
              {day.label}
            </label>
          ))}
        </div>
        {canManage ? (
          <Button type="button" onClick={() => void saveWorkingDays()}>
            Save working days
          </Button>
        ) : null}
      </section>
      {canManage ? (
        <form
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void createSchedule();
          }}
        >
          <label className="text-sm">
            Office
            <Select aria-label="Schedule office" value={officeId} onChange={(event) => setOfficeId(event.target.value)} required>
              <option value="">Select office</option>
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
              aria-label="Schedule department"
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">Office-wide</option>
              {officeDepartments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="text-sm">
            Kind
            <Select aria-label="Schedule kind" value={kind} onChange={(event) => setKind(event.target.value)}>
              <option value="normal">Normal</option>
              <option value="ramadan">Ramadan</option>
            </Select>
          </label>
          <label className="text-sm">
            Start time
            <input
              aria-label="Start time"
              type="time"
              className={`mt-1 ${controlClass}`}
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            End time
            <input
              aria-label="End time"
              type="time"
              className={`mt-1 ${controlClass}`}
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            Grace minutes
            <TextInput
              aria-label="Grace minutes"
              type="number"
              min={0}
              value={grace}
              onChange={(event) => setGrace(event.target.value)}
              required
            />
          </label>
          {kind === "ramadan" ? (
            <>
              <label className="text-sm">
                Ramadan from
                <DatePicker aria-label="Ramadan from" value={ramadanFrom} onChange={setRamadanFrom} required />
              </label>
              <label className="text-sm">
                Ramadan to
                <DatePicker aria-label="Ramadan to" value={ramadanTo} onChange={setRamadanTo} required />
              </label>
            </>
          ) : null}
          <div className="md:col-span-3">
            <Button type="submit">Save schedule</Button>
          </div>
        </form>
      ) : null}
      <TableShell className="rounded-b-none">
        <TableHead>
          <tr>
            <Th>Office / Department</Th>
            <Th>Kind</Th>
            <Th>Start</Th>
            <Th>End</Th>
            <Th>Grace</Th>
            <Th>Ramadan dates</Th>
          </tr>
        </TableHead>
        <tbody>
          {schedules.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <EmptyState>No schedules configured.</EmptyState>
              </td>
            </tr>
          ) : (
            schedulesPagination.pagedItems.map((item) => (
              <tr key={item.id}>
                <Td>
                  {offices.find((office) => office.id === item.officeId)?.name ?? item.officeId}
                  {item.departmentId
                    ? ` / ${departments.find((dept) => dept.id === item.departmentId)?.name ?? item.departmentId}`
                    : " / Office-wide"}
                </Td>
                <Td>{item.kind}</Td>
                <Td>{item.startTime}</Td>
                <Td>{item.endTime}</Td>
                <Td>{item.graceMinutes}</Td>
                <Td>
                  {item.ramadanFrom && item.ramadanTo ? `${item.ramadanFrom} – ${item.ramadanTo}` : "—"}
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableShell>
      <Pagination
        className="-mt-6 rounded-b-[10px] border border-slate-200"
        page={schedulesPagination.page}
        pageSize={schedulesPagination.pageSize}
        total={schedulesPagination.total}
        totalPages={schedulesPagination.totalPages}
        onPageChange={schedulesPagination.setPage}
        onPageSizeChange={schedulesPagination.setPageSize}
      />
      <ImpactRules canManage={canManage} />
    </section>
  );
}

function ImpactRules({ canManage }: { canManage: boolean }) {
  const api = getBrowserApiUrl();
  const [items, setItems] = useState<
    { id: string; condition: string; method: string; value: number; leaveType: { name: string } | null }[]
  >([]);
  const [leaveTypes, setLeaveTypes] = useState<{ id: string; name: string }[]>([]);
  const [condition, setCondition] = useState("absence");
  const [method, setMethod] = useState("points");
  const [value, setValue] = useState("0");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [error, setError] = useState("");
  const pagination = useClientPagination(items);

  const load = useCallback(async () => {
    const [rules, types] = await Promise.all([
      apiGet<{ items: typeof items }>("/api/v1/attendance/impact-rules", api),
      apiGet<{ items: { id: string; name: string }[] }>("/api/v1/attendance/leave-types", api),
    ]);
    setItems(rules.items);
    setLeaveTypes(types.items);
  }, [api]);

  useEffect(() => {
    void load().catch((err: unknown) => setError(err instanceof Error ? err.message : "Load failed"));
  }, [load]);

  async function save() {
    setError("");
    try {
      await apiRequest("/api/v1/attendance/impact-rules", api, {
        method: "PUT",
        body: JSON.stringify({
          condition,
          method,
          value: Number(value),
          leave_type_id: condition === "leave" ? leaveTypeId || null : null,
        }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">Attendance impact rules</h3>
      <p className="text-sm text-slate-600">
        Points or percentage deductions apply to Attendance Score only. They never change business performance
        metrics.
      </p>
      <ErrorText>{error}</ErrorText>
      {canManage ? (
        <form
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="text-sm">
            Condition
            <Select aria-label="Impact condition" value={condition} onChange={(event) => setCondition(event.target.value)}>
              <option value="absence">Absence</option>
              <option value="late">Late</option>
              <option value="early_exit">Early exit</option>
              <option value="incomplete">Incomplete Attendance</option>
              <option value="leave">Leave type</option>
            </Select>
          </label>
          {condition === "leave" ? (
            <label className="text-sm">
              Leave type
              <Select
                aria-label="Impact leave type"
                value={leaveTypeId}
                onChange={(event) => setLeaveTypeId(event.target.value)}
              >
                <option value="">Select leave type</option>
                {leaveTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <label className="text-sm">
            Method
            <Select aria-label="Impact method" value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="points">Points</option>
              <option value="percentage">Percentage</option>
            </Select>
          </label>
          <label className="text-sm">
            Value
            <TextInput aria-label="Impact value" type="number" min={0} value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
          <div className="md:col-span-4">
            <Button type="submit">Save impact rule</Button>
          </div>
        </form>
      ) : null}
      <ul className="divide-y divide-slate-100 rounded-t-[10px] border border-slate-200 bg-white text-[13px]">
        {pagination.pagedItems.map((item) => (
          <li key={item.id} className="px-3 py-2">
            {item.condition}
            {item.leaveType ? ` (${item.leaveType.name})` : ""}: {item.method} {item.value}
          </li>
        ))}
      </ul>
      <Pagination
        className="-mt-3 rounded-b-[10px] border border-slate-200"
        page={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        totalPages={pagination.totalPages}
        onPageChange={pagination.setPage}
        onPageSizeChange={pagination.setPageSize}
      />
    </section>
  );
}
