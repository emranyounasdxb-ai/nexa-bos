import Link from "next/link";
import Image from "next/image";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

import { IconAlertTriangle, IconInfoCircle, IconX } from "@/components/icons";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary";

const controlSurfaceClass = cx(
  "w-full rounded-md border border-brand-border bg-surface px-3 text-sm text-text-primary shadow-[0_1px_1px_rgba(30,30,30,0.03)] transition-colors placeholder:text-text-disabled",
  "hover:border-brand-primary focus:border-brand-primary disabled:cursor-not-allowed disabled:bg-surface-subtle disabled:text-text-disabled",
  focusRing,
);

export const controlClass = cx("h-8 py-0", controlSurfaceClass);

export const multilineControlClass = cx("min-h-10 py-2", controlSurfaceClass);

export const controlErrorClass = "border-danger focus:border-danger";

const buttonBaseClass = cx(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors",
  "disabled:cursor-not-allowed disabled:opacity-50",
  focusRing,
);

type ButtonSize = "default" | "compact" | "icon";

const buttonSizeClass: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 px-3 py-0 text-sm",
  compact: "h-8 gap-1.5 px-2.5 py-0 text-xs",
  icon: "size-8 shrink-0 gap-0 p-0 text-sm",
};

const primaryButtonTone =
  "bg-brand-primary text-white hover:bg-brand-primary-hover active:bg-brand-primary-pressed";
const secondaryButtonTone =
  "border border-brand-primary bg-surface text-brand-primary hover:bg-brand-soft active:bg-brand-soft";
const ghostButtonTone = "text-text-secondary hover:bg-brand-soft hover:text-brand-primary";
const dangerButtonTone = "bg-danger text-white hover:bg-danger active:bg-danger";

export const primaryButtonClass = cx(
  buttonBaseClass,
  buttonSizeClass.default,
  primaryButtonTone,
);

export const secondaryButtonClass = cx(
  buttonBaseClass,
  buttonSizeClass.default,
  secondaryButtonTone,
);

export const ghostButtonClass = cx(
  buttonBaseClass,
  buttonSizeClass.default,
  ghostButtonTone,
);

export const dangerButtonClass = cx(
  buttonBaseClass,
  buttonSizeClass.default,
  dangerButtonTone,
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

export function SearchActionBar({
  search,
  actions,
  className,
}: {
  search: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="search-action-bar"
      className={cx("flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end", className)}
    >
      <div data-testid="search-action-field" className="min-w-0 flex-1">
        {search}
      </div>
      {actions ? (
        <div data-testid="search-actions" className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "rounded-[10px] border border-brand-border bg-surface p-4 shadow-[0_1px_2px_rgba(30,30,30,0.035)]",
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
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
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
    <label className={cx("block text-sm font-medium text-text-primary", className)} htmlFor={htmlFor}>
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
      className={cx("mt-1.5", multilineControlClass, error && controlErrorClass, className)}
      aria-invalid={error || undefined}
      {...props}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonClassFor = (variant: ButtonVariant, size: ButtonSize) => {
  const tone =
    variant === "secondary"
      ? secondaryButtonTone
      : variant === "ghost"
        ? ghostButtonTone
        : variant === "danger"
          ? dangerButtonTone
          : primaryButtonTone;
  return cx(buttonBaseClass, buttonSizeClass[size], tone);
};

export function Button({
  variant = "primary",
  size = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={cx(buttonClassFor(variant, size), className)} {...props} />;
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  size = "default",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <Link href={href} className={cx(buttonClassFor(variant, size), className)}>
      {children}
    </Link>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) {
    return null;
  }
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-danger-soft bg-danger-soft px-3 py-2 text-sm text-text-primary">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
      <span>{children}</span>
    </p>
  );
}

type BadgeTone = "neutral" | "blue" | "green" | "amber" | "red" | "purple";

const badgeToneClass: Record<BadgeTone, string> = {
  neutral: "border-brand-border bg-surface-subtle text-text-secondary",
  blue: "border-information-soft bg-information-soft text-information",
  green: "border-success-soft bg-success-soft text-text-primary",
  amber: "border-warning-soft bg-warning-soft text-warning",
  red: "border-danger-soft bg-danger-soft text-text-primary",
  purple: "border-brand-soft bg-brand-soft text-brand-primary",
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
        "grid gap-4 rounded-[10px] border border-brand-border bg-surface p-4 shadow-[0_1px_2px_rgba(30,30,30,0.03)] sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function LoadingState({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-3 rounded-xl border border-brand-border bg-surface px-4 py-6 text-sm text-text-secondary">
      <span className="size-5 animate-spin rounded-full border-2 border-brand-border border-t-brand-primary" aria-hidden="true" />
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center px-4 py-6 text-center text-sm text-text-secondary">
      <IconInfoCircle className="mb-2 size-6 text-text-disabled" />
      {children}
    </div>
  );
}

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        "overflow-x-auto rounded-[10px] border border-brand-border bg-surface shadow-[0_1px_2px_rgba(30,30,30,0.03)]",
        className,
      )}
    >
      <table className="min-w-full text-left text-[13px] leading-5 [&_tbody_tr]:border-t [&_tbody_tr]:border-brand-border [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-brand-soft/60">
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-subtle text-[11px] uppercase tracking-[0.04em] text-text-secondary">{children}</thead>;
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cx("whitespace-nowrap px-3 py-2 font-semibold", className)}>{children}</th>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx("px-3 py-2 align-middle text-text-primary", className)}>{children}</td>;
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
          <Button type="button" variant="ghost" size="icon" aria-label="Close dialog" onClick={onClose}>
            <IconX className="size-4" />
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
    <main className="flex min-h-screen items-center justify-center bg-app-background px-4 py-10 sm:px-6">
      <div className={cx("w-full", wide ? "max-w-xl" : "max-w-md")}>
        <div className="mb-6 flex items-center justify-center">
          <Image
            src="/brand/amafh-core-full-logo-exact.svg"
            alt="AMAFH CORE"
            width={1551}
            height={479}
            className="h-14 w-auto max-w-full"
            priority
            unoptimized
          />
        </div>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-[0_8px_24px_rgba(15,23,42,0.08)] sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description ? <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
          {children}
        </section>
        <p className="mt-5 text-center text-xs text-slate-500">Secure AMAFH CORE workspace</p>
      </div>
    </main>
  );
}
