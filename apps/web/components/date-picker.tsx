"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";

import { IconCalendarCheck, IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight } from "@/components/icons";
import { Button, controlClass, controlErrorClass, cx, focusRing } from "@/components/ui";

function boundsError(value: string, min?: string, max?: string): string {
  if (value && min && value < min) return `Choose a date on or after ${min}`;
  if (value && max && value > max) return `Choose a date on or before ${max}`;
  return "";
}

// Both calendars live outside scrollable panels, but retain their owner's typography.
function useCalendarPopup(open: boolean, width: number, root: RefObject<HTMLDivElement | null>, input: RefObject<HTMLInputElement | null>, close: () => void) {
  const popup = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 16, left: 16, width });
  const [typography, setTypography] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = input.current?.getBoundingClientRect();
      if (!rect) return;
      setTypography(Boolean(root.current?.closest("[data-amafh-page-typography]")));
      const availableWidth = Math.max(0, window.innerWidth - 24);
      const actualWidth = Math.min(width, availableWidth);
      const height = Math.min(popup.current?.getBoundingClientRect().height ?? 390, window.innerHeight - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - actualWidth - 12));
      const top = rect.bottom + height + 8 <= window.innerHeight - 12
        ? rect.bottom + 8 : Math.max(12, rect.top - height - 8);
      setPosition({ top, left, width: actualWidth });
    };
    update();
    const observer = new ResizeObserver(update);
    if (popup.current) observer.observe(popup.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [input, open, root, width]);
  useEffect(() => {
    if (!open) return;
    const pointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        input.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const inside = popup.current?.contains(document.activeElement);
      if (!inside && document.activeElement !== input.current) return;
      if (!inside && event.shiftKey) { close(); return; }
      const stops = Array.from(popup.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])
        .filter(node => node.tabIndex >= 0 && node.getClientRects().length);
      const sequence = [input.current, ...stops].filter((node): node is HTMLElement => Boolean(node));
      const index = sequence.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      event.stopPropagation();
      sequence[(index + (event.shiftKey ? -1 : 1) + sequence.length) % sequence.length]?.focus();
    };
    document.addEventListener("mousedown", pointer, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("mousedown", pointer, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [close, input, open, root]);
  return [popup, position, typography] as const;
}

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

function parseRangeDraft(draft: string, allowPartial = false): { from: string; to: string } | null {
  const match = draft
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})?\s*(?:–|to)\s*(\d{4}-\d{2}-\d{2})?$/i);
  if (!match) {
    return null;
  }
  const from = match[1] ?? "";
  const to = match[2] ?? "";
  if ((!allowPartial && (!from || !to)) || (from && !parseIso(from)) || (to && !parseIso(to)) || (from && to && from > to)) {
    return null;
  }
  return { from, to };
}

function typedRangeError(draft: string, allowPartial = false): string {
  const trimmed = draft.trim();
  if (!trimmed || parseRangeDraft(trimmed, allowPartial)) {
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
  min?: string;
  max?: string;
  error?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
};

export function DatePicker({
  id,
  name,
  value,
  onChange,
  required = false,
  disabled = false,
  optional = false,
  min,
  max,
  error = false,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
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
  const [focusDay, setFocusDay] = useState(() => (selected ?? new Date()).getDate());
  const dateError = typedDateError(draft) || boundsError(draft.trim(), min, max);
  const [calendarPopup, calendarPosition, calendarTypography] = useCalendarPopup(open && !disabled, 312, rootRef, inputRef, () => setOpen(false));

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
    calendarPopup.current?.querySelector<HTMLButtonElement>(`button[aria-label="${iso}"]`)?.focus();
  }, [open, view, focusDay, calendarPopup]);

  const cells = useMemo(() => monthCells(view), [view]);

  function openPicker(focusGrid = false) {
    if (disabled) return;
    if (open) {
      if (focusGrid) calendarPopup.current?.querySelector<HTMLButtonElement>(`button[aria-label="${toIso(view.getFullYear(), view.getMonth(), focusDay)}"]`)?.focus();
      return;
    }
    const base = parseIso(value) ?? new Date();
    setView(startOfMonth(base));
    setFocusDay(base.getDate());
    restoreGridFocus.current = focusGrid;
    setOpen(true);
  }

  function commit(next: string, restoreFocus = false) {
    if (boundsError(next, min, max)) return;
    onChange(next);
    setDraft(next);
    setOpen(false);
    if (restoreFocus) inputRef.current?.focus();
  }

  function applyTyped() {
    const trimmed = draft.trim();
    if (!trimmed) {
      if (optional || !required) {
        commit("");
      }
      return;
    }
    if (parseIso(trimmed) && !boundsError(trimmed, min, max)) {
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
      <div className="relative">
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="YYYY-MM-DD"
        className={cx(controlClass, "pr-10", (error || Boolean(dateError)) && controlErrorClass)}
        role="combobox"
        value={draft}
        disabled={disabled}
        required={required}
        aria-invalid={error || Boolean(dateError) || undefined}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => openPicker()}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          event.currentTarget.setCustomValidity(typedDateError(next) || boundsError(next.trim(), min, max));
          const trimmed = next.trim();
          if (parseIso(trimmed) && !boundsError(trimmed, min, max)) {
            onChange(trimmed);
          } else if (!trimmed) {
            onChange("");
          }
        }}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null) && !calendarPopup.current?.contains(event.relatedTarget as Node | null)) {
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
      <button type="button" disabled={disabled} aria-label={`Open ${ariaLabel ?? "date"} calendar`} aria-controls={dialogId} aria-expanded={open}
        className={cx("absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-text-secondary disabled:opacity-50", focusRing)}
        onClick={() => openPicker(true)}><IconCalendarCheck className="size-4" aria-hidden="true" /></button>
      </div>
      {showClear ? (
        <button
          type="button"
          className={cx("mt-1 text-sm text-slate-600 underline-offset-2 hover:underline", focusRing)}
          onClick={() => commit("", true)}
        >
          Clear
        </button>
      ) : null}
      {open && !disabled ? createPortal(
        <div
          ref={calendarPopup}
          data-amafh-workspace=""
          data-amafh-page-typography={calendarTypography ? "" : undefined}
          id={dialogId}
          role="dialog"
          aria-label="Choose date"
          className="fixed z-[1000] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-xl border border-control-border bg-surface p-3 shadow-[var(--amafh-shadow-elevated)]"
          style={calendarPosition}
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
                commit(toIso(view.getFullYear(), view.getMonth(), focusDay), true);
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
                  disabled={Boolean(boundsError(cell.iso, min, max))}
                  tabIndex={isFocused ? 0 : -1}
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={isSelected}
                  aria-label={cell.iso}
                  className={cx(
                    "h-8 rounded-md text-sm disabled:opacity-40",
                    focusRing,
                    isSelected
                      ? "bg-action text-action-text"
                      : isToday
                        ? "text-brand-primary ring-1 ring-brand-primary"
                        : "text-slate-900",
                  )}
                  onClick={() => commit(cell.iso, true)}
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
              disabled={Boolean(boundsError(todayIso(), min, max))}
              onClick={() => commit(todayIso(), true)}
            >
              Today
            </Button>
          </div>
        </div>, document.body
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
  allowPartial?: boolean;
  fromRequired?: boolean;
  min?: string;
  max?: string;
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
  allowPartial = false,
  fromRequired = false,
  min,
  max,
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
  const parsedDraft = parseRangeDraft(draft, allowPartial);
  const dateError = pendingFrom ? "" :
    typedRangeError(draft, allowPartial) ||
    (fromRequired && parsedDraft && !parsedDraft.from ? "Enter a start date" : "") ||
    boundsError(parsedDraft?.from ?? "", min, max) || boundsError(parsedDraft?.to ?? "", min, max);
  const [calendarPopup, calendarPosition, calendarTypography] = useCalendarPopup(open && !disabled, 624, rootRef, inputRef, () => {
    setOpen(false);
    setPendingFrom(null);
    setDraft(formatRange(from, to));
  });
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
    inputRef.current?.setCustomValidity(pendingFrom ? "Choose the end date to complete the range" : dateError);
  }, [dateError, pendingFrom]);

  useLayoutEffect(() => {
    if (!open || !restoreGridFocus.current) {
      return;
    }
    restoreGridFocus.current = false;
    calendarPopup.current?.querySelector<HTMLButtonElement>(`button[aria-label="${focusIso}"]`)?.focus();
  }, [focusIso, open, view, calendarPopup]);

  function openPicker(focusGrid = false) {
    if (disabled) {
      return;
    }
    if (open) {
      if (focusGrid) calendarPopup.current?.querySelector<HTMLButtonElement>(`button[aria-label="${focusIso}"]`)?.focus();
      return;
    }
    const base = parseIso(from) ?? new Date();
    const baseIso = toIso(base.getFullYear(), base.getMonth(), base.getDate());
    setView(startOfMonth(base));
    setFocusIso(baseIso);
    setPendingFrom(null);
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
    if (boundsError(iso, min, max)) return;
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
    if (pendingFrom) return;
    const trimmed = draft.trim();
    if (!trimmed) {
      onChange({ from: "", to: "" });
      setPendingFrom(null);
      setOpen(false);
      return;
    }
    const parsed = parseRangeDraft(trimmed, allowPartial);
    if (parsed && !dateError) {
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
                disabled={Boolean(boundsError(cell.iso, min, max))}
                tabIndex={cell.iso === focusIso ? 0 : -1}
                aria-current={isToday ? "date" : undefined}
                aria-pressed={isStart || isEnd}
                aria-label={cell.iso}
                data-range-state={rangeState}
                className={cx(
                  "h-8 rounded-md text-sm disabled:opacity-40",
                  focusRing,
                  isStart || isEnd
                    ? "bg-action text-action-text"
                    : isInRange
                      ? "bg-information-soft text-information"
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
      <div className="relative">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        placeholder="YYYY-MM-DD – YYYY-MM-DD"
        className={cx(controlClass, "pr-10", (error || Boolean(dateError)) && controlErrorClass)}
        role="combobox"
        value={draft}
        disabled={disabled}
        required={required || fromRequired}
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
          const parsed = parseRangeDraft(next, allowPartial);
          const nextError = typedRangeError(next, allowPartial) ||
            (fromRequired && parsed && !parsed.from ? "Enter a start date" : "") ||
            boundsError(parsed?.from ?? "", min, max) || boundsError(parsed?.to ?? "", min, max);
          event.currentTarget.setCustomValidity(nextError);
          if (parsed && !nextError) {
            onChange(parsed);
          } else if (!next.trim()) {
            onChange({ from: "", to: "" });
          }
        }}
        onBlur={(event) => {
          if (!rootRef.current?.contains(event.relatedTarget as Node | null) && !calendarPopup.current?.contains(event.relatedTarget as Node | null)) {
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
      <button type="button" disabled={disabled} aria-label={`Open ${ariaLabel} calendar`} aria-controls={dialogId} aria-expanded={open}
        className={cx("absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-text-secondary disabled:opacity-50", focusRing)}
        onClick={() => openPicker(true)}><IconCalendarCheck className="size-4" aria-hidden="true" /></button>
      </div>
      {open && !disabled ? createPortal(
        <div
          ref={calendarPopup}
          data-amafh-workspace=""
          data-amafh-page-typography={calendarTypography ? "" : undefined}
          id={dialogId}
          role="dialog"
          aria-label={`Choose ${ariaLabel.toLowerCase()} range`}
          className="fixed z-[1000] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-xl border border-control-border bg-surface p-3 shadow-[var(--amafh-shadow-elevated)]"
          style={calendarPosition}
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
          <div className="min-w-0">
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              {renderMonth(view, leftCells)}
              {renderMonth(rightView, rightCells)}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
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
            {allowPartial && pendingFrom ? <Button type="button" variant="secondary" size="compact" onClick={() => closeAfterCommit({ from: pendingFrom, to: "" }, true)}>Use start date only</Button> : null}
          </div>
        </div>, document.body
      ) : null}
    </div>
  );
}
