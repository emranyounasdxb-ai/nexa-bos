"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { Button, controlClass, controlErrorClass, cx, focusRing, secondaryButtonClass } from "@/components/ui";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toIso(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function parseIso(value: string): Date | null {
  if (!ISO.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function todayIso(): string {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

export type DatePickerProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  optional?: boolean;
  error?: boolean;
  "aria-label"?: string;
};

export function DatePicker({
  id,
  name,
  value,
  onChange,
  required = false,
  disabled = false,
  optional = false,
  error = false,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const dialogId = `${inputId}-calendar`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const selected = parseIso(value);
  const [view, setView] = useState(() => startOfMonth(selected ?? new Date()));
  const [focusDay, setFocusDay] = useState(() => selected?.getDate() ?? 1);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (open) {
      const base = parseIso(value) ?? new Date();
      setView(startOfMonth(base));
      setFocusDay(base.getDate());
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => {
    const first = startOfMonth(view);
    const startOffset = first.getDay();
    const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    const items: Array<{ iso: string; day: number; inMonth: boolean }> = [];
    for (let index = 0; index < startOffset; index += 1) {
      items.push({ iso: "", day: 0, inMonth: false });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      items.push({
        iso: toIso(view.getFullYear(), view.getMonth(), day),
        day,
        inMonth: true,
      });
    }
    return items;
  }, [view]);

  function commit(next: string) {
    onChange(next);
    setDraft(next);
    setOpen(false);
  }

  function applyTyped() {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (optional || !required) {
        commit("");
      }
      return;
    }
    if (parseIso(trimmed)) {
      commit(trimmed);
    }
  }

  function moveFocus(delta: number) {
    const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    let next = focusDay + delta;
    let nextView = view;
    if (next < 1) {
      nextView = addMonths(view, -1);
      next = new Date(nextView.getFullYear(), nextView.getMonth() + 1, 0).getDate();
    } else if (next > daysInMonth) {
      nextView = addMonths(view, 1);
      next = 1;
    }
    setView(nextView);
    setFocusDay(next);
  }

  const showClear = (optional || !required) && Boolean(value) && !disabled;

  return (
    <div ref={rootRef} className="relative mt-1">
      <div className="flex gap-2">
        <input
          id={inputId}
          name={name}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder="YYYY-MM-DD"
          className={cx(controlClass, error && controlErrorClass)}
          value={draft}
          disabled={disabled}
          required={required}
          aria-invalid={error || undefined}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-controls={dialogId}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={applyTyped}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyTyped();
            }
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
        />
        <button
          type="button"
          className={cx(secondaryButtonClass, "shrink-0 px-3 py-2")}
          disabled={disabled}
          aria-label="Open calendar"
          aria-expanded={open}
          aria-controls={dialogId}
          onClick={() => setOpen((current) => !current)}
        >
          Calendar
        </button>
      </div>
      {showClear ? (
        <button
          type="button"
          className={cx("mt-1 text-sm text-slate-600 underline-offset-2 hover:underline", focusRing)}
          onClick={() => commit("")}
        >
          Clear
        </button>
      ) : null}
      {open && !disabled ? (
        <div
          id={dialogId}
          role="dialog"
          aria-label="Choose date"
          className="absolute z-20 mt-2 w-[19.5rem] rounded-md border border-slate-300 bg-white p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              className={cx("rounded-md px-2 py-1 text-sm text-slate-700", focusRing)}
              aria-label="Previous year"
              onClick={() => setView(addMonths(view, -12))}
            >
              «
            </button>
            <button
              type="button"
              className={cx("rounded-md px-2 py-1 text-sm text-slate-700", focusRing)}
              aria-label="Previous month"
              onClick={() => setView(addMonths(view, -1))}
            >
              ‹
            </button>
            <p className="min-w-[8.5rem] text-center text-sm font-semibold text-slate-900">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </p>
            <button
              type="button"
              className={cx("rounded-md px-2 py-1 text-sm text-slate-700", focusRing)}
              aria-label="Next month"
              onClick={() => setView(addMonths(view, 1))}
            >
              ›
            </button>
            <button
              type="button"
              className={cx("rounded-md px-2 py-1 text-sm text-slate-700", focusRing)}
              aria-label="Next year"
              onClick={() => setView(addMonths(view, 12))}
            >
              »
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-600">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div
            className="mt-1 grid grid-cols-7 gap-1"
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                moveFocus(-1);
              }
              if (event.key === "ArrowRight") {
                event.preventDefault();
                moveFocus(1);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(-7);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(7);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                commit(toIso(view.getFullYear(), view.getMonth(), focusDay));
              }
            }}
          >
            {cells.map((cell, index) => {
              if (!cell.inMonth) {
                return <span key={`empty-${index}`} />;
              }
              const isSelected = cell.iso === value;
              const isToday = cell.iso === todayIso();
              const isFocused = cell.day === focusDay;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  tabIndex={isFocused ? 0 : -1}
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={isSelected}
                  aria-label={cell.iso}
                  className={cx(
                    "h-8 rounded-md text-sm",
                    focusRing,
                    isSelected
                      ? "bg-slate-900 text-white"
                      : isToday
                        ? "text-[#0f4c81] ring-1 ring-[#0f4c81]"
                        : "text-slate-900",
                  )}
                  onClick={() => commit(cell.iso)}
                  onFocus={() => setFocusDay(cell.day)}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              variant="secondary"
              className="py-1 text-xs"
              onClick={() => commit(todayIso())}
            >
              Today
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
