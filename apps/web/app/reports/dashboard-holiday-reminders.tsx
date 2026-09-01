"use client";

import { useEffect, useState } from "react";

import { IconAlertTriangle } from "@/components/icons";
import { Button, cx } from "@/components/ui";
import { apiGet, apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";

type Reminder = {
  id: string;
  kind: string;
  holiday: { name: string; holidayDate: string } | null;
  daysUntil: number | null;
};

export function DashboardHolidayReminders() {
  const [items, setItems] = useState<Reminder[]>([]);
  const api = getBrowserApiUrl();

  useEffect(() => {
    void apiGet<{ items: Reminder[] }>("/api/v1/attendance/reminders", api)
      .then((data) => setItems(data.items))
      .catch(() => setItems([]));
  }, [api]);

  if (items.length === 0) return null;

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
      className="flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-white/80 px-2.5 py-2"
    >
      <span
        aria-hidden="true"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-700"
      >
        <IconAlertTriangle className="size-4" />
      </span>
      <p className="shrink-0 text-xs font-semibold text-slate-700">Holiday reminders</p>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
        {items.map((item) => (
          <div
            key={item.id}
            className={cx(
              "flex shrink-0 items-center gap-2 rounded-md border bg-white px-2 py-1",
              item.kind === "urgent" ? "border-red-200" : "border-slate-200",
            )}
          >
            <span
              className={cx(
                "text-[10px] font-semibold uppercase tracking-wide",
                item.kind === "urgent" ? "text-red-700" : "text-[#0f4c81]",
              )}
            >
              {item.kind === "urgent" ? "Urgent" : "Notice"}
            </span>
            <span className="max-w-64 truncate text-xs text-slate-700">
              {item.holiday?.name} · {item.holiday?.holidayDate}
              {item.daysUntil != null ? ` · ${item.daysUntil} day(s)` : ""}
            </span>
            <Button
              type="button"
              variant="ghost"
              className="min-h-7 shrink-0 px-1.5 py-0.5 text-[11px]"
              onClick={() => void dismiss(item.id)}
            >
              Dismiss
            </Button>
          </div>
        ))}
      </div>
    </aside>
  );
}
