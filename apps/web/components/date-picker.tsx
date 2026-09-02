"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight } from "@/components/icons";
import { Button, controlClass, controlErrorClass, cx, focusRing } from "@/components/ui";

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

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

type CalendarCell = { iso: string; day: number; inMonth: boolean };

function monthCells(view: Date): CalendarCell[] {
  const first = startOfMonth(view);
  const startOffset = first.getDay();
  const monthLength = daysInMonth(view);
  const items: CalendarCell[] = [];
  for (let index = 0; index < startOffset; index += 1) {
    items.push({ iso: "", day: 0, inMonth: false });
  }
  for (let day = 1; day <= monthLength; day += 1) {
    items.push({
      iso: toIso(view.getFullYear(), view.getMonth(), day),
      day,
      inMonth: true,
    });
  }
  return items;
}

function todayIso(): string {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

function typedDateError(draft: string): string {
  const trimmed = draft.trim();
  if (!trimmed || parseIso(trimmed)) {
    return "";
  }
  return "Enter a valid date as YYYY-MM-DD";
}

function formatRange(from: string, to: string): string {
  if (!from && !to) {
    return "";
  }
  return `${from} – ${to}`;
}

function parseRangeDraft(draft: string): { from: string; to: string } | null {
  const match = draft
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})\s+(?:–|to)\s+(\d{4}-\d{2}-\d{2})$/i);
  if (!match) {
    return null;
  }
  const from = match[1];
  const to = match[2];
  if (!parseIso(from) || !parseIso(to) || from > to) {
    return null;
  }
  return { from, to };
}

function typedRangeError(draft: string): string {
  const trimmed = draft.trim();
  if (!trimmed || parseRangeDraft(trimmed)) {
    return "";
  }
  return "Enter a valid range as YYYY-MM-DD – YYYY-MM-DD";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreGridFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const selected = parseIso(value);
  const [view, setView] = useState(() => startOfMonth(selected ?? new Date()));
  const [focusDay, setFocusDay] = useState(() => selected?.getDate() ?? 1);
  const dateError = typedDateError(draft);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(dateError);
  }, [dateError]);

  useLayoutEffect(() => {
    if (!open || !restoreGridFocus.current) {
      return;
    }
    restoreGridFocus.current = false;
    const iso = toIso(view.getFullYear(), view.getMonth(), focusDay);
    rootRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${iso}"]`)?.focus();
  }, [open, view, focusDay]);

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

  const cells = useMemo(() => monthCells(view), [view]);

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

  function shiftView(count: number) {
    const nextView = addMonths(view, count);
    setView(nextView);
    setFocusDay((day) => Math.min(day, daysInMonth(nextView)));
  }

  function moveFocus(delta: number) {
    const current = new Date(view.getFullYear(), view.getMonth(), focusDay);
    const moved = new Date(current.getFullYear(), current.getMonth(), current.getDate() + delta);
    restoreGridFocus.current = true;
    setView(startOfMonth(moved));
    setFocusDay(moved.getDate());
  }

  const showClear = (optional || !required) && Boolean(value) && !disabled;

  return (
    <div ref={rootRef} className="relative mt-1.5">
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="YYYY-MM-DD"
        className={cx(controlClass, (error || Boolean(dateError)) && controlErrorClass)}
        role="combobox"
        value={draft}
        disabled={disabled}
        required={required}
        aria-invalid={error || Boolean(dateError) || undefined}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => setOpen(true)}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          event.currentTarget.setCustomValidity(typedDateError(next));
          const trimmed = next.trim();
          if (parseIso(trimmed)) {
            onChange(trimmed);
          } else if (!trimmed && (optional || !required)) {
            onChange("");
          }
        }}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
            applyTyped();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            applyTyped();
          }
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            restoreGridFocus.current = true;
            setOpen(true);
          }
        }}
      />
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
          className="absolute z-20 mt-2 w-[min(19.5rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-3 shadow-[0_12px_28px_rgba(15,23,42,0.12)]"
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              className={cx("rounded-md px-2 py-1 text-sm text-slate-700", focusRing)}
              aria-label="Previous year"
              onClick={() => shiftView(-12)}
            >
              <IconChevronsLeft className="size-4" />
            </button>
            <button
              type="button"
              className={cx("rounded-md px-2 py-1 text-sm text-slate-700", focusRing)}
              aria-label="Previous month"
              onClick={() => shiftView(-1)}
            >
              <IconChevronLeft className="size-4" />
            </button>
            <p className="min-w-[8.5rem] text-center text-sm font-semibold text-slate-900">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </p>
            <button
              type="button"
              className={cx("rounded-md px-2 py-1 text-sm text-slate-700", focusRing)}
              aria-label="Next month"
              onClick={() => shiftView(1)}
            >
              <IconChevronRight className="size-4" />
            </button>
            <button
              type="button"
              className={cx("rounded-md px-2 py-1 text-sm text-slate-700", focusRing)}
              aria-label="Next year"
              onClick={() => shiftView(12)}
            >
              <IconChevronsRight className="size-4" />
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
                        ? "text-brand-primary ring-1 ring-brand-primary"
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

export type DateRangePickerProps = {
  id?: string;
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  required?: boolean;
  disabled?: boolean;
  error?: boolean;
  "aria-label": string;
};

export function DateRangePicker({
  id,
  from,
  to,
  onChange,
  required = false,
  disabled = false,
  error = false,
  "aria-label": ariaLabel,
}: DateRangePickerProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const dialogId = `${inputId}-range-calendar`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreGridFocus = useRef(false);
  const initialDate = parseIso(from) ?? new Date();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => formatRange(from, to));
  const [pendingFrom, setPendingFrom] = useState<string | null>(null);
  const [view, setView] = useState(() => startOfMonth(initialDate));
  const [focusIso, setFocusIso] = useState(() => toIso(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate()));
  const [popupPosition, setPopupPosition] = useState({ top: 0, left: 16, width: 624 });
  const dateError = pendingFrom ? "" : typedRangeError(draft);
  const leftCells = useMemo(() => monthCells(view), [view]);
  const rightView = useMemo(() => addMonths(view, 1), [view]);
  const rightCells = useMemo(() => monthCells(rightView), [rightView]);
  const rangeStart = pendingFrom ?? from;
  const rangeEnd = pendingFrom ? "" : to;

  useEffect(() => {
    if (!pendingFrom) {
      setDraft(formatRange(from, to));
    }
  }, [from, pendingFrom, to]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(dateError);
  }, [dateError]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const updatePosition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }
      const viewportPadding = 16;
      const width = Math.min(624, window.innerWidth - viewportPadding * 2);
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        window.innerWidth - width - viewportPadding,
      );
      const estimatedHeight = Math.min(390, window.innerHeight - viewportPadding * 2);
      const below = rect.bottom + 8;
      const top =
        below + estimatedHeight <= window.innerHeight - viewportPadding
          ? below
          : Math.max(viewportPadding, rect.top - estimatedHeight - 8);
      setPopupPosition({ top, left, width });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !restoreGridFocus.current) {
      return;
    }
    restoreGridFocus.current = false;
    rootRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${focusIso}"]`)?.focus();
  }, [focusIso, open, view]);

  useEffect(() => {
    if (!open) {
      return;
    }
    function closePicker(restoreFocus = false) {
      setOpen(false);
      setPendingFrom(null);
      setDraft(formatRange(from, to));
      if (restoreFocus) {
        inputRef.current?.focus();
      }
    }
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        closePicker();
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closePicker(true);
      }
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [from, open, to]);

  function openPicker(focusGrid = false) {
    if (disabled) {
      return;
    }
    const base = parseIso(from) ?? new Date();
    const baseIso = toIso(base.getFullYear(), base.getMonth(), base.getDate());
    setView(startOfMonth(base));
    setFocusIso(baseIso);
    setPendingFrom(null);
    setDraft(formatRange(from, to));
    restoreGridFocus.current = focusGrid;
    setOpen(true);
  }

  function closeAfterCommit(next: { from: string; to: string }, restoreFocus = false) {
    onChange(next);
    setDraft(formatRange(next.from, next.to));
    setPendingFrom(null);
    setOpen(false);
    if (restoreFocus) {
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function selectDate(iso: string) {
    if (!pendingFrom) {
      setPendingFrom(iso);
      setDraft(`${iso} – `);
      setFocusIso(iso);
      return;
    }
    closeAfterCommit(
      iso < pendingFrom ? { from: iso, to: pendingFrom } : { from: pendingFrom, to: iso },
      true,
    );
  }

  function applyTyped() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange({ from: "", to: "" });
      setPendingFrom(null);
      setOpen(false);
      return;
    }
    const parsed = parseRangeDraft(trimmed);
    if (parsed) {
      closeAfterCommit(parsed);
    }
  }

  function shiftView(count: number) {
    const nextView = addMonths(view, count);
    const focused = parseIso(focusIso) ?? nextView;
    const nextDay = Math.min(focused.getDate(), daysInMonth(nextView));
    setView(nextView);
    setFocusIso(toIso(nextView.getFullYear(), nextView.getMonth(), nextDay));
  }

  function moveFocus(delta: number) {
    const current = parseIso(focusIso) ?? view;
    const moved = new Date(current.getFullYear(), current.getMonth(), current.getDate() + delta);
    const movedMonth = startOfMonth(moved);
    const afterVisibleMonths = addMonths(view, 2);
    restoreGridFocus.current = true;
    if (movedMonth < view) {
      setView(movedMonth);
    } else if (movedMonth >= afterVisibleMonths) {
      setView(addMonths(movedMonth, -1));
    }
    setFocusIso(toIso(moved.getFullYear(), moved.getMonth(), moved.getDate()));
  }

  function renderMonth(month: Date, cells: CalendarCell[]) {
    const monthLabel = `${MONTHS[month.getMonth()]} ${month.getFullYear()}`;
    const monthKey = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
    return (
      <section data-month={monthKey} aria-label={monthLabel}>
        <h3 className="mb-2 text-center text-sm font-semibold text-slate-900">{monthLabel}</h3>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-slate-600" aria-hidden="true">
          {WEEKDAYS.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div
          role="grid"
          aria-label={monthLabel}
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
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              selectDate(focusIso);
            }
          }}
        >
          {cells.map((cell, index) => {
            if (!cell.inMonth) {
              return <span key={`empty-${monthKey}-${index}`} />;
            }
            const isStart = Boolean(rangeStart) && cell.iso === rangeStart;
            const isEnd = Boolean(rangeEnd) && cell.iso === rangeEnd;
            const isInRange = Boolean(rangeStart && rangeEnd && cell.iso > rangeStart && cell.iso < rangeEnd);
            const isToday = cell.iso === todayIso();
            const rangeState = isStart ? "start" : isEnd ? "end" : isInRange ? "middle" : undefined;
            return (
              <button
                key={cell.iso}
                type="button"
                tabIndex={cell.iso === focusIso ? 0 : -1}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isStart || isEnd}
                aria-label={cell.iso}
                data-range-state={rangeState}
                className={cx(
                  "h-8 rounded-md text-sm",
                  focusRing,
                  isStart || isEnd
                    ? "bg-slate-900 text-white"
                    : isInRange
                      ? "bg-blue-100 text-blue-900"
                      : isToday
                        ? "text-brand-primary ring-1 ring-brand-primary"
                        : "text-slate-900",
                )}
                onClick={() => selectDate(cell.iso)}
                onFocus={() => setFocusIso(cell.iso)}
              >
                {cell.day}
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div ref={rootRef} className="relative mt-1.5">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="YYYY-MM-DD – YYYY-MM-DD"
        className={cx(controlClass, (error || Boolean(dateError)) && controlErrorClass)}
        role="combobox"
        value={draft}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        aria-invalid={error || Boolean(dateError) || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => openPicker()}
        onChange={(event) => {
          const next = event.target.value;
          setPendingFrom(null);
          setDraft(next);
          const nextError = typedRangeError(next);
          event.currentTarget.setCustomValidity(nextError);
          const parsed = parseRangeDraft(next);
          if (parsed) {
            onChange(parsed);
          } else if (!next.trim()) {
            onChange({ from: "", to: "" });
          }
        }}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
            applyTyped();
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            applyTyped();
          }
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openPicker(true);
          }
        }}
      />
      {open && !disabled ? (
        <div
          id={dialogId}
          role="dialog"
          aria-label={`Choose ${ariaLabel.toLowerCase()} range`}
          className="fixed z-50 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
          style={popupPosition}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label="Previous year" onClick={() => shiftView(-12)}>
                <IconChevronsLeft className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Previous month" onClick={() => shiftView(-1)}>
                <IconChevronLeft className="size-4" />
              </Button>
            </div>
            <p className="text-center text-xs text-slate-600" aria-live="polite">
              {pendingFrom ? "Choose the To date" : "Choose the From date"}
            </p>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label="Next month" onClick={() => shiftView(1)}>
                <IconChevronRight className="size-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Next year" onClick={() => shiftView(12)}>
                <IconChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="grid min-w-[36rem] grid-cols-2 gap-4">
              {renderMonth(view, leftCells)}
              {renderMonth(rightView, rightCells)}
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <p className="min-w-0 truncate text-xs text-slate-600">
              {pendingFrom ? `${pendingFrom} – Select To` : formatRange(from, to) || "No range selected"}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="compact"
              onClick={() => closeAfterCommit({ from: "", to: "" }, true)}
            >
              Clear range
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
