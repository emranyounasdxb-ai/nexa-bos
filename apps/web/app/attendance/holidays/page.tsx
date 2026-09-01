"use client";

import { useCallback, useEffect, useState } from "react";

import { DatePicker } from "@/components/date-picker";
import { Pagination, useClientPagination } from "@/components/pagination";
import {
  Button,
  ButtonLink,
  EmptyState,
  ErrorText,
  PageHeader,
  TableHead,
  TableShell,
  Td,
  TextInput,
  Th,
} from "@/components/ui";
import { apiGet, apiRequest, ApiClientError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type Holiday = {
  id: string;
  holidayDate: string;
  name: string;
  notes: string | null;
  automaticReminderDue?: boolean;
};

export default function HolidaysPage() {
  const { can } = useAuth();
  const api = getBrowserApiUrl();
  const [items, setItems] = useState<Holiday[]>([]);
  const [name, setName] = useState("");
  const [holidayDate, setHolidayDate] = useState("");
  const [notes, setNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canManage = can("Attendance.Manage");
  const canSendUrgent = can("Notifications.SendUrgent");
  const pagination = useClientPagination(items);

  const load = useCallback(async () => {
    try {
      setError("");
      const data = await apiGet<{ items: Holiday[] }>("/api/v1/attendance/holidays", api);
      setItems(data.items);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Unable to load holidays");
    }
  }, [api]);

  useEffect(() => {
    if (can("Attendance.View")) void load();
  }, [can, load]);

  async function createHoliday() {
    setError("");
    setMessage("");
    try {
      await apiRequest("/api/v1/attendance/holidays", api, {
        method: "POST",
        body: JSON.stringify({ holiday_date: holidayDate, name, notes: notes || null }),
      });
      setName("");
      setHolidayDate("");
      setNotes("");
      setMessage("Official Holiday saved.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Save failed");
    }
  }

  async function sendUrgent(id: string) {
    setError("");
    try {
      await apiRequest(`/api/v1/attendance/holidays/${id}/urgent-reminder`, api, { method: "POST" });
      setMessage("Urgent holiday reminder sent.");
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Reminder failed");
    }
  }

  async function saveHolidayEdit(item: Holiday) {
    setError("");
    try {
      await apiRequest(`/api/v1/attendance/holidays/${item.id}`, api, {
        method: "PATCH",
        body: JSON.stringify({ name: item.name, notes: item.notes }),
      });
      setEditingId(null);
      setMessage("Official Holiday updated.");
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Update failed");
    }
  }

  if (!can("Attendance.View")) {
    return <ErrorText>Attendance permission is required.</ErrorText>;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        title="Official holidays"
        description="Company-wide holidays override normal working-day attendance."
        actions={
          <ButtonLink href="/attendance" variant="secondary">
            Attendance
          </ButtonLink>
        }
      />
      <ErrorText>{error}</ErrorText>
      {message ? <p className="text-sm text-slate-600">{message}</p> : null}
      {canManage ? (
        <form
          className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createHoliday();
          }}
        >
          <label className="text-sm">
            Date
            <DatePicker aria-label="Holiday date" value={holidayDate} onChange={setHolidayDate} required />
          </label>
          <label className="text-sm">
            Holiday name
            <TextInput aria-label="Holiday name" value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="text-sm md:col-span-2">
            Details
            <TextInput aria-label="Holiday details" value={notes} onChange={(event) => setNotes(event.target.value)} />
          </label>
          <div className="md:col-span-4">
            <Button type="submit">Add Official Holiday</Button>
          </div>
        </form>
      ) : null}
      <TableShell className="rounded-b-none">
        <TableHead>
          <tr>
            <Th>Date</Th>
            <Th>Name</Th>
            <Th>Details</Th>
            <Th>Reminder</Th>
          </tr>
        </TableHead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <EmptyState>No Official Holidays recorded.</EmptyState>
              </td>
            </tr>
          ) : (
            pagination.pagedItems.map((item) => (
              <tr key={item.id}>
                <Td>{item.holidayDate}</Td>
                <Td>
                  {editingId === item.id ? (
                    <TextInput
                      className="mt-0 !min-h-8 !py-1 text-xs"
                      aria-label={`Edit ${item.name}`}
                      value={item.name}
                      onChange={(event) =>
                        setItems((current) =>
                          current.map((row) =>
                            row.id === item.id ? { ...row, name: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  ) : (
                    item.name
                  )}
                </Td>
                <Td>
                  {editingId === item.id ? (
                    <TextInput
                      className="mt-0 !min-h-8 !py-1 text-xs"
                      aria-label={`Edit details ${item.name}`}
                      value={item.notes ?? ""}
                      onChange={(event) =>
                        setItems((current) =>
                          current.map((row) =>
                            row.id === item.id ? { ...row, notes: event.target.value } : row,
                          ),
                        )
                      }
                    />
                  ) : (
                    (item.notes ?? "—")
                  )}
                </Td>
                <Td>
                  {item.automaticReminderDue ? <span className="text-sm">Automatic window</span> : null}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {canManage && editingId === item.id ? (
                      <>
                        <Button type="button" size="compact" onClick={() => void saveHolidayEdit(item)}>
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="compact"
                          onClick={() => {
                            setEditingId(null);
                            void load();
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : null}
                    {canManage && editingId !== item.id ? (
                      <Button type="button" variant="secondary" size="compact" onClick={() => setEditingId(item.id)}>
                        Edit
                      </Button>
                    ) : null}
                    {canSendUrgent ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="compact"
                        onClick={() => void sendUrgent(item.id)}
                      >
                        Urgent reminder
                      </Button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </TableShell>
      <Pagination
        className="-mt-6 rounded-b-[10px] border border-slate-200"
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
