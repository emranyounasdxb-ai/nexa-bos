"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

import { IconChevronDown } from "@/components/icons";

type SelectOption = {
  disabled: boolean;
  group?: string;
  label: string;
  value: string;
};

export type BrandedSelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size"> & {
  "data-testid"?: string;
};

function optionText(value: ReactNode): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return Children.toArray(value).map(optionText).join("");
}

function readOptions(children: ReactNode, group?: string): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment) {
      options.push(...readOptions((child.props as { children?: ReactNode }).children, group));
      return;
    }
    if (child.type === "optgroup") {
      const props = child.props as { children?: ReactNode; disabled?: boolean; label?: string };
      const nested = readOptions(props.children, props.label);
      options.push(...nested.map((option) => ({ ...option, disabled: props.disabled || option.disabled })));
      return;
    }
    if (child.type !== "option") return;
    const props = child.props as { children?: ReactNode; disabled?: boolean; value?: string | number };
    const label = optionText(props.children);
    options.push({
      disabled: Boolean(props.disabled),
      group,
      label,
      value: props.value === undefined ? label : String(props.value),
    });
  });
  return options;
}

function stringValue(value: string | number | readonly string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0] === undefined ? "" : String(value[0]);
  return value === undefined ? undefined : String(value);
}

export function BrandedSelect({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "data-testid": dataTestId,
  autoFocus,
  children,
  className,
  defaultValue,
  disabled,
  id,
  name,
  onBlur,
  onChange,
  onFocus,
  required,
  title,
  value,
}: BrandedSelectProps) {
  const generatedId = useId();
  const listboxId = `${id ?? generatedId}-listbox`;
  const options = useMemo(() => readOptions(children), [children]);
  const controlledValue = stringValue(value);
  const [internalValue, setInternalValue] = useState(() => stringValue(defaultValue) ?? options[0]?.value ?? "");
  const selectedValue = controlledValue ?? internalValue;
  const selectedIndex = options.findIndex((option) => option.value === selectedValue);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [mounted, setMounted] = useState(false);
  const [constraintInvalid, setConstraintInvalid] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (selectedValue) setConstraintInvalid(false);
  }, [selectedValue]);

  useEffect(() => {
    if (!required || disabled) return;
    const trigger = triggerRef.current;
    const form = trigger?.closest("form");
    if (!trigger || !form) return;
    const formElement = form;
    const triggerElement = trigger;
    function validateRequiredSelect(event: SubmitEvent) {
      const firstInvalid = Array.from(
        formElement.querySelectorAll<HTMLButtonElement>('button[role="combobox"][aria-required="true"]:not(:disabled)'),
      ).find((item) => !item.value);
      if (firstInvalid !== triggerElement) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setConstraintInvalid(true);
      triggerElement.focus();
    }
    formElement.addEventListener("submit", validateRequiredSelect, true);
    return () => formElement.removeEventListener("submit", validateRequiredSelect, true);
  }, [disabled, required]);
  useEffect(() => {
    if (autoFocus) triggerRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!open) return;
    const selected = options.findIndex((option) => option.value === selectedValue && !option.disabled);
    const firstEnabled = options.findIndex((option) => !option.disabled);
    setActiveIndex(selected >= 0 ? selected : firstEnabled);
  }, [open, options, selectedValue]);

  useEffect(() => {
    if (!open) return;
    function positionMenu() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const gap = 6;
      const availableBelow = window.innerHeight - rect.bottom - margin - gap;
      const availableAbove = rect.top - margin - gap;
      const placeAbove = availableBelow < 160 && availableAbove > availableBelow;
      const maxHeight = Math.max(112, Math.min(320, placeAbove ? availableAbove : availableBelow));
      const width = Math.min(Math.max(rect.width, 200), window.innerWidth - margin * 2);
      const left = Math.min(Math.max(margin, rect.left), window.innerWidth - width - margin);
      setMenuStyle({
        left,
        maxHeight,
        top: placeAbove ? Math.max(margin, rect.top - maxHeight - gap) : rect.bottom + gap,
        width,
      });
    }
    function closeOutside(event: PointerEvent) {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !(document.getElementById(listboxId)?.contains(target))) {
        setOpen(false);
      }
    }
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", closeOutside);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", closeOutside);
    };
  }, [listboxId, open]);

  function emitChange(nextValue: string) {
    if (controlledValue === undefined) setInternalValue(nextValue);
    const target = { name: name ?? "", value: nextValue } as EventTarget & HTMLSelectElement;
    onChange?.({ target, currentTarget: target } as ChangeEvent<HTMLSelectElement>);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    setConstraintInvalid(false);
    emitChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function enabledIndex(start: number, direction: 1 | -1) {
    if (!options.length) return -1;
    let index = start;
    for (let checked = 0; checked < options.length; checked += 1) {
      index = (index + direction + options.length) % options.length;
      if (!options[index].disabled) return index;
    }
    return -1;
  }

  function boundaryIndex(direction: 1 | -1) {
    const start = direction === 1 ? 0 : options.length - 1;
    for (let index = start; index >= 0 && index < options.length; index += direction) {
      if (!options[index].disabled) return index;
    }
    return -1;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (open && activeIndex >= 0) choose(activeIndex);
      else setOpen(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      if (!open) setOpen(true);
      setActiveIndex((current) => enabledIndex(current < 0 ? (event.key === "ArrowDown" ? -1 : 0) : current, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
      setActiveIndex(boundaryIndex(event.key === "Home" ? 1 : -1));
    }
  }

  return (
    <span ref={containerRef} className="relative block min-w-0">
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-controls={listboxId}
        aria-describedby={ariaDescribedBy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-invalid={ariaInvalid ?? (constraintInvalid || undefined)}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-required={required || undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        className={`${className ?? ""} flex min-w-0 items-center justify-between gap-2 text-left`}
        data-testid={dataTestId}
        disabled={disabled}
        title={title}
        value={selectedValue}
        onBlur={(event) => {
          setOpen(false);
          onBlur?.(event as unknown as FocusEvent<HTMLSelectElement>);
        }}
        onClick={() => setOpen((current) => !current)}
        onFocus={(event) => onFocus?.(event as unknown as FocusEvent<HTMLSelectElement>)}
        onKeyDown={handleKeyDown}
      >
        <span className={`min-w-0 flex-1 truncate ${selectedOption ? "text-text-primary" : "text-text-disabled"}`}>
          {selectedOption?.label ?? "Select an option"}
        </span>
        <IconChevronDown className={`size-4 shrink-0 text-text-disabled transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {mounted && open
        ? createPortal(
            <div
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              aria-labelledby={ariaLabelledBy}
              className="fixed z-[70] overflow-y-auto rounded-lg border border-brand-border bg-surface p-1 shadow-[0_16px_40px_rgba(30,30,30,0.16)]"
              style={menuStyle}
            >
              {options.length ? options.map((option, index) => {
                const groupChanged = option.group && options[index - 1]?.group !== option.group;
                return (
                  <div key={`${option.value}-${index}`}>
                    {groupChanged ? (
                      <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-disabled">
                        {option.group}
                      </div>
                    ) : null}
                    <div
                      id={`${listboxId}-option-${index}`}
                      role="option"
                      aria-disabled={option.disabled || undefined}
                      aria-selected={option.value === selectedValue}
                      data-option-value={option.value}
                      className={`flex min-h-8 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-sm outline-none ${
                        option.disabled
                          ? "text-text-disabled"
                          : index === activeIndex || option.value === selectedValue
                            ? "bg-brand-soft text-brand-primary"
                            : "text-text-primary hover:bg-brand-soft hover:text-brand-primary"
                      }`}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
                      onClick={() => choose(index)}
                    >
                      <span className={`size-1.5 shrink-0 rounded-full ${option.value === selectedValue ? "bg-brand-primary" : "bg-transparent"}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 break-words">{option.label}</span>
                    </div>
                  </div>
                );
              }) : (
                <div className="px-3 py-2 text-sm text-text-secondary">No options available</div>
              )}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
