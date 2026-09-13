"use client";

import { useEffect, useRef, useState } from "react";

import { Button, ErrorText, LoadingState, TableHead, TableShell, Td, Th } from "@/components/ui";
import { apiDownload, apiGet, ApiClientError, apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { getBrowserApiUrl } from "@/lib/env";

type CsvField = {
  name: string;
  label: string;
  required: boolean;
  format: string;
  description: string;
  example: string;
};

type CsvSchema = {
  fields: CsvField[];
  limits: { maxBytes: number; maxRows: number };
  notes: string[];
};

type CsvError = { row: number; field: string; message: string };
type ValidationResult = { valid: boolean; rowCount: number; errors: CsvError[] };

function apiErrors(error: unknown): CsvError[] {
  if (!(error instanceof ApiClientError)) return [];
  const details = error.body?.error?.details;
  if (!Array.isArray(details)) return [];
  return details.filter(
    (item): item is CsvError =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as CsvError).row === "number" &&
      typeof (item as CsvError).field === "string" &&
      typeof (item as CsvError).message === "string",
  );
}

export function StaffBulkUploadDialog({ onImported }: { onImported: () => void }) {
  const { user } = useAuth();
  const owner = user?.userType?.code === "OWNER";
  const api = getBrowserApiUrl();
  const dialogRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const busyRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [schema, setSchema] = useState<CsvSchema | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState<"schema" | "sample" | "validate" | "import" | null>(null);
  const [error, setError] = useState("");
  const [importedCount, setImportedCount] = useState<number | null>(null);

  useEffect(() => {
    busyRef.current = Boolean(busy);
  }, [busy]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy("schema");
    setError("");
    void apiGet<CsvSchema>("/api/v1/users/bulk-upload/schema", api)
      .then((value) => {
        if (active) setSchema(value);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : "Unable to load CSV guidance");
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => {
      active = false;
    };
  }, [api, open]);

  useEffect(() => {
    if (!open || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLElement>('button[data-initial-focus=""]')?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [href], [tabindex="0"]',
        ),
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    dialog.addEventListener("keydown", keyboard);
    return () => {
      dialog.removeEventListener("keydown", keyboard);
      document.body.style.overflow = previousOverflow;
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [open]);

  if (!owner) return null;

  function resetAndClose() {
    if (busy) return;
    setOpen(false);
    setFile(null);
    setValidation(null);
    setImportedCount(null);
    setError("");
  }

  async function downloadSample() {
    setBusy("sample");
    setError("");
    try {
      const result = await apiDownload("/api/v1/users/bulk-upload/sample", api);
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? "nexa-bos-staff-bulk-upload-sample.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Sample CSV download failed");
    } finally {
      setBusy(null);
    }
  }

  async function validate() {
    if (!file) {
      setError("Choose a CSV file before validation.");
      return;
    }
    setBusy("validate");
    setError("");
    setImportedCount(null);
    const body = new FormData();
    body.append("file", file);
    try {
      setValidation(
        await apiRequest<ValidationResult>("/api/v1/users/bulk-upload/validate", api, {
          method: "POST",
          body,
        }),
      );
    } catch (caught) {
      setValidation(null);
      setError(caught instanceof Error ? caught.message : "CSV validation failed");
    } finally {
      setBusy(null);
    }
  }

  async function importRows() {
    if (!file || !validation?.valid) return;
    setBusy("import");
    setError("");
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await apiRequest<{ status: string; importedCount: number }>(
        "/api/v1/users/bulk-upload/import",
        api,
        { method: "POST", body },
      );
      setImportedCount(result.importedCount);
      setValidation(null);
      onImported();
    } catch (caught) {
      const errors = apiErrors(caught);
      if (errors.length) setValidation({ valid: false, rowCount: validation.rowCount, errors });
      setError(caught instanceof Error ? caught.message : "Staff import failed");
    } finally {
      setBusy(null);
    }
  }

  const required = schema?.fields.filter((field) => field.required) ?? [];
  const optional = schema?.fields.filter((field) => !field.required) ?? [];

  return (
    <>
      <Button type="button" variant="secondary" onClick={(event) => { triggerRef.current = event.currentTarget; setOpen(true); }}>
        Bulk Upload
      </Button>
      {open ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-[#17101f]/45 p-3 backdrop-blur-sm sm:p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) resetAndClose();
          }}
        >
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="staff-bulk-upload-title"
            className="flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 flex-col overflow-hidden rounded-[24px] border border-brand-border bg-surface shadow-[var(--amafh-shadow-elevated)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-5xl"
          >
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <h2 id="staff-bulk-upload-title" className="text-lg font-semibold text-text-primary">Bulk Upload Staff</h2>
                <p className="text-sm text-text-secondary">OWNER-only validation and atomic import of new Pending Setup staff.</p>
              </div>
              <Button data-initial-focus="" type="button" variant="ghost" size="compact" disabled={Boolean(busy)} aria-label="Close Bulk Upload" onClick={resetAndClose}>Close</Button>
            </header>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5">
              {busy === "schema" && !schema ? <LoadingState>Loading accepted CSV fields…</LoadingState> : null}
              {schema ? (
                <>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
                    <section className="rounded-xl border border-brand-border bg-surface-subtle p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-text-primary">Prepare the CSV</h3>
                          <p className="mt-1 text-sm text-text-secondary">Up to {schema.limits.maxRows.toLocaleString()} rows and {(schema.limits.maxBytes / 1024 / 1024).toLocaleString()} MB. No real staff data is included in the sample.</p>
                        </div>
                        <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void downloadSample()}>
                          {busy === "sample" ? "Downloading…" : "Download Sample CSV"}
                        </Button>
                      </div>
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-text-secondary">
                        {schema.notes.map((note) => <li key={note}>{note}</li>)}
                      </ul>
                    </section>

                    <section className="rounded-xl border border-brand-border p-4">
                      <h3 className="text-base font-semibold text-text-primary">Select and validate</h3>
                      <label htmlFor="staff-csv-file" className="mt-3 block text-sm font-medium text-text-primary">CSV file</label>
                      <input
                        id="staff-csv-file"
                        type="file"
                        accept=".csv,text/csv"
                        disabled={Boolean(busy) || importedCount !== null}
                        className="mt-1 block w-full rounded-xl border border-control-border bg-surface p-2 text-sm text-text-primary file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                        onChange={(event) => {
                          setFile(event.target.files?.[0] ?? null);
                          setValidation(null);
                          setImportedCount(null);
                          setError("");
                        }}
                      />
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button type="button" disabled={!file || Boolean(busy) || importedCount !== null} onClick={() => void validate()}>
                          {busy === "validate" ? "Validating all rows…" : "Validate CSV"}
                        </Button>
                        {file ? <span className="break-all text-sm text-text-secondary">{file.name}</span> : null}
                      </div>
                    </section>
                  </div>

                  <section aria-labelledby="required-fields-title">
                    <h3 id="required-fields-title" className="text-base font-semibold text-text-primary">Required fields</h3>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      {required.map((field) => <FieldSummary key={field.name} field={field} />)}
                    </div>
                  </section>
                  <details className="rounded-xl border border-brand-border p-4">
                    <summary className="cursor-pointer text-base font-semibold text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary">Optional fields ({optional.length})</summary>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {optional.map((field) => <FieldSummary key={field.name} field={field} />)}
                    </div>
                  </details>
                </>
              ) : null}

              {validation ? (
                <section aria-live="polite" className="rounded-xl border border-brand-border p-4">
                  <h3 className="text-base font-semibold text-text-primary">
                    {validation.valid ? `${validation.rowCount.toLocaleString()} rows ready to import` : `${validation.errors.length.toLocaleString()} validation issue${validation.errors.length === 1 ? "" : "s"}`}
                  </h3>
                  {validation.valid ? (
                    <p className="mt-1 text-sm text-text-secondary">Nothing has been saved yet. Import will recheck OWNER access, references, and identity conflicts.</p>
                  ) : (
                    <TableShell className="mt-3 max-h-72">
                      <TableHead><tr><Th>CSV row</Th><Th>Field</Th><Th>Issue</Th></tr></TableHead>
                      <tbody>{validation.errors.map((item, index) => <tr key={`${item.row}-${item.field}-${index}`}><Td>{item.row}</Td><Td><code>{item.field}</code></Td><Td>{item.message}</Td></tr>)}</tbody>
                    </TableShell>
                  )}
                </section>
              ) : null}
              {importedCount !== null ? <p role="status" className="rounded-xl border border-success-soft bg-success-soft p-4 text-sm text-text-primary">Successfully imported {importedCount.toLocaleString()} staff record{importedCount === 1 ? "" : "s"}. Accounts remain Pending Setup.</p> : null}
              {error ? <ErrorText>{error}</ErrorText> : null}
            </div>

            <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-brand-border px-4 py-3 sm:px-5">
              <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={resetAndClose}>{importedCount !== null ? "Done" : "Cancel"}</Button>
              {validation?.valid ? <Button type="button" disabled={Boolean(busy)} onClick={() => void importRows()}>{busy === "import" ? "Importing…" : `Import ${validation.rowCount.toLocaleString()} Staff`}</Button> : null}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function FieldSummary({ field }: { field: CsvField }) {
  return (
    <article className="min-w-0 rounded-lg bg-surface-subtle p-3 text-sm">
      <code className="break-all font-semibold text-brand-primary">{field.name}</code>
      <p className="mt-1 font-medium text-text-primary">{field.label}</p>
      <p className="text-xs text-text-secondary">{field.format}</p>
      <p className="mt-1 text-xs text-text-secondary">{field.description}</p>
    </article>
  );
}
