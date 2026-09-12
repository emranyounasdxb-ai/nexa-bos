import Link from "next/link";
import Image from "next/image";
import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

import { IconAlertTriangle, IconInfoCircle, IconX } from "@/components/icons";
import { BrandedSelect, type BrandedSelectProps } from "@/components/select";
import { Tooltip } from "@/components/tooltip";
import { ThemeControls } from "@/components/theme-controls";
import patterns from "./page-patterns.module.css";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary";

const controlSurfaceClass = cx(
  "w-full rounded-xl border border-control-border bg-surface px-3 text-sm text-text-primary transition-colors placeholder:text-text-secondary",
  "hover:border-brand-primary focus:border-brand-primary disabled:cursor-not-allowed disabled:border-brand-border disabled:bg-surface-subtle disabled:text-text-disabled",
  focusRing,
);

export const controlClass = cx("h-8 py-0", controlSurfaceClass);

export const multilineControlClass = cx("min-h-10 py-2", controlSurfaceClass);

export const controlErrorClass = "border-danger focus:border-danger";

const buttonBaseClass = cx(
  "inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors",
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
  "bg-action text-action-text hover:bg-action-hover active:bg-action-hover";
const secondaryButtonTone =
  "border border-brand-border bg-surface text-text-primary hover:bg-surface-subtle active:bg-brand-soft";
const ghostButtonTone = "text-text-secondary hover:bg-brand-soft hover:text-brand-primary";
const dangerButtonTone = "bg-[#b9233b] text-white hover:bg-[#9f1e33] active:bg-[#89182b]";

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
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  if (!description && !actions) return null;
  return (
    <div data-amafh-page-purpose="" className="flex min-w-0 flex-wrap items-center justify-between gap-2 sm:gap-3">
      {description ? (
        <p data-testid="page-purpose" className="min-w-0 max-w-4xl text-sm leading-5 text-text-secondary">
          {description}
        </p>
      ) : <span aria-hidden="true" />}
      {actions ? <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div> : null}
    </div>
  );
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
      data-amafh-card=""
      className={cx(
        "min-w-0 rounded-[20px] bg-surface p-4 sm:p-5",
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
    <div data-amafh-section-header="" className="flex min-w-0 flex-wrap items-start justify-between gap-2 sm:gap-3">
      <div className="min-w-0">
        <h2 className="text-[length:var(--amafh-text-section)] leading-7 font-semibold text-text-primary">{title}</h2>
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
  help,
  helpLabel,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  help?: string;
  helpLabel?: string;
}) {
  return (
    <label className={cx("block min-w-0 text-sm font-medium text-text-primary", className)} htmlFor={htmlFor}>
      <span className="inline-flex items-center gap-1.5">
        {label}
        {help ? <Tooltip label={helpLabel ?? `About ${label}`} text={help} /> : null}
      </span>
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
}: BrandedSelectProps & { error?: boolean }) {
  return (
    <BrandedSelect
      className={cx("mt-1.5", controlClass, error && controlErrorClass, className)}
      aria-invalid={error || undefined}
      {...props}
    >
      {children}
    </BrandedSelect>
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
    <span className={cx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", badgeToneClass[tone])}>
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
        "grid min-w-0 gap-3 rounded-lg border border-brand-border bg-surface p-3 shadow-[var(--amafh-shadow-surface)] sm:grid-cols-2 sm:p-4 lg:grid-cols-3",
        className,
      )}
      data-amafh-filter-bar=""
    >
      {children}
    </div>
  );
}

export function LoadingState({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <div data-amafh-state-surface="" role="status" className="flex min-h-28 items-center gap-4 rounded-[20px] bg-surface px-5 py-5 text-sm text-text-secondary">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-surface-subtle" aria-hidden="true"><span className="size-5 animate-spin rounded-full border-2 border-brand-border border-t-brand-primary" /></span>
      <div className="min-w-0 flex-1"><p>{children}</p><div className="mt-3 h-1 max-w-40 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true"><div className="h-full w-1/3 animate-pulse rounded-full bg-brand-primary" /></div></div>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div data-amafh-empty-state="" className="flex min-h-36 flex-col items-center justify-center gap-3 px-5 py-6 text-center text-sm text-text-secondary">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-surface-subtle"><IconInfoCircle className="size-5 text-text-secondary" /></span>
      <div className="max-w-md">{children}</div>
    </div>
  );
}

export function TableShell({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        "relative max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-brand-border bg-surface shadow-[var(--amafh-shadow-surface)]",
        className,
      )}
      data-amafh-table-shell=""
      {...props}
    >
      <table className="w-full min-w-full text-left text-sm leading-6 [&_tbody_tr]:border-t [&_tbody_tr]:border-brand-border [&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-surface-subtle">
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-subtle text-xs text-text-secondary">{children}</thead>;
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return <th className={cx("whitespace-nowrap px-4 py-3 font-semibold", className)}>{children}</th>;
}

export function Td({ children, className }: { children: ReactNode; className?: string }) {
  return <td className={cx("px-4 py-3 align-middle text-text-primary", className)}>{children}</td>;
}

export function DialogPanel({
  title,
  description,
  children,
  onClose,
  className = "",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#17101f]/45 p-4 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="bos-dialog-title"
        className={`max-h-[calc(100dvh-2rem)] min-w-0 w-full overflow-y-auto rounded-[24px] border border-brand-border bg-surface p-5 shadow-[var(--amafh-shadow-elevated)] sm:max-w-lg sm:p-6 ${className}`}
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
        <div className="mt-4 min-w-0">{children}</div>
      </section>
    </div>
  );
}

export function BrandLogo({ className = "" }: { className?: string }) {
  return <span className={cx("amafh-full-logo", className)}>
    <Image data-logo-theme="light" src="/brand/amafh-core-full-logo-exact.svg" alt="AMAFH CORE" width={1551} height={479} priority unoptimized />
    <Image data-logo-theme="dark" src="/brand/amafh-core-full-logo-dark.svg" alt="AMAFH CORE" width={1551} height={479} priority unoptimized />
  </span>;
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
    <main className="relative flex min-h-screen items-center justify-center bg-[var(--amafh-canvas)] px-4 py-20 sm:px-6">
      <ThemeControls className="absolute right-4 top-4" />
      <div className={cx(patterns.publicFrame, wide && patterns.publicWide)}>
        <div className={patterns.publicBrand}>
        <div className={patterns.publicLogo}>
          <BrandLogo />
        </div>
        <p>Secure AMAFH CORE workspace</p>
        </div>
        <section data-amafh-public-surface="" className={patterns.publicForm}>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {description ? <p data-testid="page-purpose" className="mt-2 text-sm leading-6 text-slate-600">{description}</p> : null}
          {children}
        </section>
      </div>
    </main>
  );
}
