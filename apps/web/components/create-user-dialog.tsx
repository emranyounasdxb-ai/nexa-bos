"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, ErrorText, TextInput } from "@/components/ui";
import { ApiClientError, apiRequest } from "@/lib/api";
import { getBrowserApiUrl } from "@/lib/env";

const INITIAL = { full_name: "", personal_email: "", personal_mobile: "" };
type FieldName = keyof typeof INITIAL;
const FIELDS: { name: FieldName; label: string; type: "text" | "email" | "tel"; complete: string; max: number }[] = [
  { name: "full_name", label: "Full Name", type: "text", complete: "name", max: 200 },
  { name: "personal_email", label: "Personal Email", type: "email", complete: "email", max: 320 },
  { name: "personal_mobile", label: "Personal Mobile", type: "tel", complete: "tel", max: 32 },
];

export function CreateUserDialog() {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLElement>(null);
  const pending = useRef(false);
  const reservation = useRef<Promise<{ userCode: string }> | null>(null);
  const visible = pathname === "/users/new";
  const [form, setForm] = useState(INITIAL);
  const [userCode, setUserCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});

  const close = useCallback(() => {
    if (pending.current) return;
    reservation.current = null;
    setUserCode("");
    router.replace("/users");
  }, [router]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    reservation.current ??= apiRequest<{ userCode: string }>("/api/v1/users/code-reservations", getBrowserApiUrl(), { method: "POST" });
    void reservation.current.then((data) => { if (!cancelled) setUserCode(data.userCode); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "User Code could not be reserved."); });
    return () => { cancelled = true; };
  }, [visible]);

  useLayoutEffect(() => {
    if (!visible || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLElement>("#full-name")?.focus();
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const controls = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]'));
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    dialog.addEventListener("keydown", keyboard);
    return () => {
      dialog.removeEventListener("keydown", keyboard);
      document.body.style.overflow = overflow;
      window.requestAnimationFrame(() => {
        if (window.location.pathname === "/users") {
          const trigger = document.querySelector<HTMLElement>('a[href="/users/new"]');
          (trigger ?? previous)?.focus();
        }
      });
    };
  }, [close, visible]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const invalid: Partial<Record<FieldName, string>> = {};
    if (!form.full_name.trim()) invalid.full_name = "Enter a full name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.personal_email.trim())) invalid.personal_email = "Enter a valid personal email address.";
    if (form.personal_mobile.trim().length < 5) invalid.personal_mobile = "Enter a personal mobile number with at least 5 characters.";
    setErrors(invalid); setError("");
    const first = FIELDS.find((field) => invalid[field.name]);
    if (first) { document.getElementById(first.name.replaceAll("_", "-"))?.focus(); return; }
    if (!userCode) { setError("Wait for a server-issued User Code before creating the user."); return; }
    pending.current = true; setSubmitting(true);
    try {
      const created = await apiRequest<{ id: string }>("/api/v1/users", getBrowserApiUrl(), {
        method: "POST", body: JSON.stringify({ ...form, user_code: userCode }),
      });
      router.push(`/users/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.body?.error?.code === "EMAIL_DUPLICATE") {
        setErrors({ personal_email: caught.message });
        window.requestAnimationFrame(() => document.getElementById("personal-email")?.focus());
      }
      setError(caught instanceof Error ? caught.message : "Create failed");
    } finally { pending.current = false; setSubmitting(false); }
  }

  if (!visible) return null;
  return (
    <div data-testid="create-user-modal-backdrop" className="fixed inset-0 z-[70] flex items-center justify-center bg-[#17101f]/45 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="create-user-dialog-title" className="flex max-h-[calc(100dvh-2rem)] w-full min-w-0 flex-col overflow-hidden rounded-[24px] border border-brand-border bg-surface shadow-[var(--amafh-shadow-elevated)] sm:max-w-xl">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-brand-border px-4 py-3">
          <h2 id="create-user-dialog-title" className="text-lg font-semibold">Create User</h2>
          <Button data-dialog-close="" type="button" variant="ghost" size="compact" disabled={submitting} aria-label="Close Create User" onClick={close}>Close</Button>
        </header>
        <form noValidate onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-col">
          <div data-testid="create-user-form-body" className="grid min-h-0 gap-4 overflow-y-auto overscroll-contain p-5 sm:grid-cols-2">
            {FIELDS.map(({ name, label, type, complete, max }) => {
              const id = name.replaceAll("_", "-");
              return <div key={name} className="min-w-0">
                <label htmlFor={id} className="block text-sm font-medium">{label} <span aria-hidden="true">*</span><span className="sr-only"> (required)</span></label>
                <TextInput id={id} type={type} autoComplete={complete} required maxLength={max} value={form[name]} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${id}-error` : undefined} onChange={(event) => { setForm(current => ({ ...current, [name]: event.target.value })); setErrors(current => ({ ...current, [name]: undefined })); }} />
                {errors[name] ? <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">{errors[name]}</p> : null}
              </div>;
            })}
            <div className="min-w-0 rounded-xl bg-surface-subtle p-3 sm:col-span-2"><label htmlFor="user-code" className="block text-sm font-medium">User Code</label><TextInput id="user-code" readOnly value={userCode} placeholder="Reserving…" aria-busy={!userCode} /></div>
          </div>
          {error ? <div className="px-4 pb-3"><ErrorText>{error}</ErrorText></div> : null}
          <footer className="flex shrink-0 justify-end gap-2 border-t border-brand-border px-4 py-3">
            <Button type="button" variant="secondary" disabled={submitting} onClick={close}>Cancel</Button>
            <Button type="submit" disabled={submitting || !userCode}>{submitting ? "Creating…" : "Create User"}</Button>
          </footer>
        </form>
      </section>
    </div>
  );
}
