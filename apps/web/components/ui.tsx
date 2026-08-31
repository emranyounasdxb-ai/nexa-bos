import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f4c81]";

export const controlClass = cx(
  "min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-[0_1px_1px_rgba(15,23,42,0.03)] transition-colors placeholder:text-slate-400",
  "hover:border-slate-400 focus:border-[#0f4c81] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500",
  focusRing,
);

export const controlErrorClass = "border-red-700 focus:border-red-700";

const buttonBaseClass = cx(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm font-medium transition-colors",
  "disabled:cursor-not-allowed disabled:opacity-50",
  focusRing,
);

export const primaryButtonClass = cx(
  buttonBaseClass,
  "bg-slate-900 text-white hover:bg-slate-800 active:bg-slate-950",
);

export const secondaryButtonClass = cx(
  buttonBaseClass,
  "border border-slate-300 bg-white text-slate-700 hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900",
);

export const ghostButtonClass = cx(
  buttonBaseClass,
  "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
);

export const dangerButtonClass = cx(
  buttonBaseClass,
  "bg-red-700 text-white hover:bg-red-800 active:bg-red-900",
);

export function PageHeader({
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  if (!actions) return null;
  return <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block text-sm font-medium text-slate-700", className)} htmlFor={htmlFor}>
      {label}
      {children}
    </label>
  );
}

export function TextInput({
  error,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      className={cx("mt-1.5", controlClass, error && controlErrorClass, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

export function Select({
  error,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }) {
  return (
    <select
      className={cx("mt-1.5", controlClass, error && controlErrorClass, className)}
      aria-invalid={error || undefined}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({
  error,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: boolean }) {
  return (
    <textarea
      className={cx("mt-1.5", controlClass, error && controlErrorClass, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonClassFor = (variant: ButtonVariant) => {
  if (variant === "secondary") return secondaryButtonClass;
  if (variant === "ghost") return ghostButtonClass;
  if (variant === "danger") return dangerButtonClass;
  return primaryButtonClass;
};

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return <button className={cx(buttonClassFor(variant), className)} {...props} />;
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  className?: string;
}) {
  return (
    <Link href={href} className={cx(buttonClassFor(variant), className)}>
      {children}
    </Link>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) {
    return null;
  }
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}

type BadgeTone = "neutral" | "blue" | "green" | "amber" | "red" | "purple";

const badgeToneClass: Record<BadgeTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  green: "border-emerald-200 bg-emerald-50 text-emerald-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-800",
  purple: "border-violet-200 bg-violet-50 text-violet-800",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={cx("inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium", badgeToneClass[tone])}>
      {children}
    </span>
  );
}

export function StatusBadge({ value }: { value: string }) {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, " ");
  const tone: BadgeTone =
    /\b(active|approved|booked|funded|completed|present|read|acknowledged|available|good)\b/.test(normalized)
      ? "green"
      : /\b(pending|probation|notice|warning|fair|under repair)\b/.test(normalized)
        ? "amber"
        : /\b(inactive|rejected|terminated|resigned|cancelled|lost|damaged|urgent|critical|locked)\b/.test(normalized)
          ? "red"
          : /\b(draft|new|unread|submitted)\b/.test(normalized)
            ? "blue"
            : "neutral";
  return <Badge tone={tone}>{value}</Badge>;
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "grid gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LoadingState({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
      <span className="size-5 animate-spin rounded-full border-2 border-slate-200 border-t-[#0f4c81]" aria-hidden="true" />
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center px-4 py-6 text-center text-sm text-slate-500">
      <span aria-hidden="true" className="mb-2 inline-flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        —
      </span>
      {children}
    </div>
  );
}

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)]",
        className,
      )}
    >
      <table className="min-w-full text-left text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-100 [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-slate-50/80">
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">{children}</thead>;
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cx("whitespace-nowrap px-4 py-3 font-semibold", className)}>{children}</th>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-3 text-slate-700", className)}>{children}</td>;
}

export function DialogPanel({
  title,
  description,
  children,
  onClose,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="bos-dialog-title"
        className="max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-5 shadow-[0_20px_40px_rgba(15,23,42,0.18)] sm:max-w-lg sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="bos-dialog-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <Button type="button" variant="ghost" aria-label="Close dialog" onClick={onClose}>
            ×
          </Button>
        </div>
        <div className="mt-5">{children}</div>
      </section>
    </div>
  );
}

export function PublicScreen({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6f8] px-4 py-10 sm:px-6">
      <div className={cx("w-full", wide ? "max-w-xl" : "max-w-md")}>
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="inline-flex size-10 items-center justify-center rounded-md bg-[#0f4c81] text-sm font-bold tracking-tight text-white">
            NX
          </span>
          <div>
            <p className="text-sm font-bold tracking-[0.12em] text-slate-900">NEXA BOS</p>
            <p className="text-[11px] text-slate-500">Business operations</p>
          </div>
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.08)] sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description ? <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
          {children}
        </section>
        <p className="mt-5 text-center text-xs text-slate-500">Secure NEXA business operations workspace</p>
      </div>
    </main>
  );
}
