"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { IconInfoCircle } from "@/components/icons";

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary";

export function Tooltip({
  id,
  label,
  text,
  align = "left",
  children,
}: {
  id?: string;
  label: string;
  text: string;
  align?: "left" | "right";
  children?: ReactNode;
}) {
  const generatedId = useId();
  const tooltipId = id ?? generatedId;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  function close() {
    setOpen(false);
  }

  return (
    <span
      ref={containerRef}
      className="relative inline-flex shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!containerRef.current?.contains(document.activeElement)) close();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <span
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className={cx(
          "inline-flex cursor-help items-center rounded text-text-disabled hover:text-text-primary",
          focusRing,
        )}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            setOpen((current) => !current);
          }
        }}
      >
        {children ?? <IconInfoCircle className="size-4" />}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        hidden={!open}
        className={cx(
          "pointer-events-none absolute top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg bg-text-primary px-3 py-2 text-left text-xs font-normal leading-5 text-white shadow-xl",
          "max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 max-sm:top-auto max-sm:w-auto",
          align === "right" ? "right-0" : "left-0",
        )}
      >
        {text}
      </span>
    </span>
  );
}
