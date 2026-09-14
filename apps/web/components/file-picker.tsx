"use client";

import { useEffect, useId, useMemo, useRef } from "react";

import { IconFileDescription, IconX } from "@/components/icons";
import { Button, cx } from "@/components/ui";
import styles from "./file-picker.module.css";

export function FilePicker({
  id,
  label,
  accept,
  guidance,
  chooseLabel,
  file,
  onChange,
  disabled = false,
  busy = false,
  imagePreview = false,
  className,
}: {
  id?: string;
  label: string;
  accept: string;
  guidance: string;
  chooseLabel: string;
  file: File | null;
  onChange: (file: File | null) => void;
  disabled?: boolean;
  busy?: boolean;
  imagePreview?: boolean;
  className?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? `file-picker-${generatedId.replace(/:/g, "")}`;
  const labelId = `${inputId}-label`;
  const guidanceId = `${inputId}-guidance`;
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(
    () => imagePreview && file ? URL.createObjectURL(file) : null,
    [file, imagePreview],
  );

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    onChange(null);
    inputRef.current?.focus();
  }

  return (
    <div className={cx(styles.field, className)} data-file-picker="" aria-busy={busy || undefined}>
      <span id={labelId} className={styles.label}>{label}</span>
      <div className={styles.surface} data-disabled={disabled || busy}>
        {previewUrl ? (
          <span className={styles.preview}>
            {/* Browser object URLs are transient local selections and cannot use the Next image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt={`Selected preview for ${file?.name ?? label}`} />
          </span>
        ) : (
          <span className={styles.fileIcon} aria-hidden="true"><IconFileDescription className="size-5" /></span>
        )}
        <div className={styles.details}>
          <p className={cx(styles.filename, !file && styles.empty)} title={file?.name}>
            {file?.name ?? "No file selected"}
          </p>
          <p id={guidanceId} className={styles.guidance}>{guidance}</p>
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            variant="secondary"
            size="compact"
            className={styles.choose}
            disabled={disabled || busy}
            aria-controls={inputId}
            aria-describedby={guidanceId}
            onClick={() => inputRef.current?.click()}
          >
            <IconFileDescription className="size-4" />
            {file ? "Change" : chooseLabel}
          </Button>
          {file ? (
            <Button
              type="button"
              variant="ghost"
              size="compact"
              className={styles.clear}
              disabled={disabled || busy}
              aria-label={`Clear selected file for ${label}`}
              aria-controls={inputId}
              onClick={clear}
            >
              <IconX className="size-4" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      <input
        ref={inputRef}
        id={inputId}
        className="sr-only"
        type="file"
        accept={accept}
        aria-labelledby={labelId}
        aria-describedby={guidanceId}
        disabled={disabled || busy}
        onChange={(event) => onChange(event.currentTarget.files?.[0] ?? null)}
      />
    </div>
  );
}
