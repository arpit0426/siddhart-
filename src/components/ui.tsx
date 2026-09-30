import React, { useEffect, useId, useRef } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2, X } from 'lucide-react';
import { TONE_CLASSES, type Tone } from '../lib/format';

/* -------------------------------------------------------------------------- */
/* Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-blue-600 text-white hover:bg-blue-700 focus-visible:outline-blue-700 disabled:bg-blue-300',
  success:
    'bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:outline-emerald-800 disabled:bg-emerald-300',
  secondary:
    'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 focus-visible:outline-slate-500 disabled:text-slate-400',
  ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-400',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-700 disabled:bg-red-300',
};

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1.5',
  md: 'px-4 py-2 text-sm gap-2',
  lg: 'px-5 py-3 text-sm gap-2',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  className = '',
  children,
  disabled,
  ...rest
}) => (
  <button
    {...rest}
    disabled={disabled || loading}
    aria-busy={loading || undefined}
    className={`inline-flex items-center justify-center rounded-lg font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
  >
    {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
    {children}
  </button>
);

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  className = '',
  children,
  ...rest
}) => (
  <div
    {...rest}
    className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}
  >
    {children}
  </div>
);

export const SectionHeader: React.FC<{
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  as?: 'h1' | 'h2' | 'h3';
}> = ({ title, subtitle, action, as = 'h2' }) => {
  const Heading = as as any;
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Heading className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{title}</Heading>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
};

export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; className?: string }> = ({
  tone = 'neutral',
  children,
  className = '',
}) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${TONE_CLASSES[tone]} ${className}`}
  >
    {children}
  </span>
);

export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: React.ReactNode;
}> = ({ label, value, hint, icon }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      {icon}
    </div>
    <div className="mt-1 text-xl font-extrabold tabular-nums text-slate-900">{value}</div>
    {hint && <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>}
  </Card>
);

export const EmptyState: React.FC<{
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ title, description, icon, action }) => (
  <Card className="flex flex-col items-center justify-center px-6 py-12 text-center">
    {icon && <div className="mb-3 text-slate-300">{icon}</div>}
    <p className="text-sm font-semibold text-slate-800">{title}</p>
    {description && <p className="mt-1 max-w-md text-xs text-slate-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </Card>
);

export const Spinner: React.FC<{ label?: string; className?: string }> = ({ label = 'Loading…', className = '' }) => (
  <div className={`flex items-center justify-center gap-2 py-8 text-sm text-slate-500 ${className}`} role="status">
    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

export const Skeleton: React.FC<{ className?: string }> = ({ className = 'h-24' }) => (
  <div className={`animate-pulse rounded-xl border border-slate-200 bg-slate-100 ${className}`} aria-hidden="true" />
);

export const ErrorNote: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    role="alert"
    className={`flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800 ${className}`}
  >
    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

export const SuccessNote: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    role="status"
    className={`flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 ${className}`}
  >
    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

export const InfoNote: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={`flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 ${className}`}
  >
    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span>{children}</span>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Forms                                                                      */
/* -------------------------------------------------------------------------- */

export interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string | null;
}

export const Field: React.FC<FieldProps> = ({ label, hint, error, id, className = '', ...rest }) => {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const describedBy = [hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="text-xs">
      <label htmlFor={fieldId} className="mb-1 block font-semibold text-slate-700">
        {label}
        {rest.required && <span className="ml-0.5 text-red-600" aria-hidden="true">*</span>}
      </label>
      <input
        id={fieldId}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 ${
          error ? 'border-red-400' : 'border-slate-300'
        } ${className}`}
      />
      {hint && !error && (
        <p id={`${fieldId}-hint`} className="mt-1 text-[11px] text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} className="mt-1 text-[11px] font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
};

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string | null;
  options: { value: string; label: string }[];
}

export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  hint,
  error,
  options,
  id,
  className = '',
  ...rest
}) => {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <div className="text-xs">
      <label htmlFor={fieldId} className="mb-1 block font-semibold text-slate-700">
        {label}
      </label>
      <select
        id={fieldId}
        {...rest}
        aria-invalid={error ? true : undefined}
        aria-describedby={hint ? `${fieldId}-hint` : undefined}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 ${
          error ? 'border-red-400' : 'border-slate-300'
        } ${className}`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && (
        <p id={`${fieldId}-hint`} className="mt-1 text-[11px] text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
};

export const TextAreaField: React.FC<
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string | null }
> = ({ label, hint, error, id, className = '', ...rest }) => {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <div className="text-xs">
      <label htmlFor={fieldId} className="mb-1 block font-semibold text-slate-700">
        {label}
      </label>
      <textarea
        id={fieldId}
        {...rest}
        aria-invalid={error ? true : undefined}
        className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 ${
          error ? 'border-red-400' : 'border-slate-300'
        } ${className}`}
      />
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-[11px] font-medium text-red-700">{error}</p>}
    </div>
  );
};

export const QuantityStepper: React.FC<{
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
  label: string;
  disabled?: boolean;
}> = ({ value, min = 1, max = 99, onChange, label, disabled }) => (
  <div className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white p-1" role="group" aria-label={label}>
    <button
      type="button"
      onClick={() => onChange(Math.max(min, value - 1))}
      disabled={disabled || value <= min}
      aria-label={`Decrease ${label}`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-40"
    >
      −
    </button>
    <span className="w-8 text-center text-sm font-bold tabular-nums" aria-live="polite">
      {value}
    </span>
    <button
      type="button"
      onClick={() => onChange(Math.min(max, value + 1))}
      disabled={disabled || value >= max}
      aria-label={`Increase ${label}`}
      className="flex h-7 w-7 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100 disabled:opacity-40"
    >
      +
    </button>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Modal (keyboard accessible, focus-trapped, ESC to close)                    */
/* -------------------------------------------------------------------------- */

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}> = ({ open, onClose, title, description, children, footer }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const firstField = dialogRef.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-close])'
    );
    firstField?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-sm sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-base font-bold text-slate-900">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
          </div>
          <button
            type="button"
            data-close
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="space-y-3">{children}</div>
        {footer && <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">{footer}</div>}
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Code display (handoff secrets)                                             */
/* -------------------------------------------------------------------------- */

export const HandoffCode: React.FC<{
  code: string;
  label: string;
  hint?: string;
  tone?: Tone;
}> = ({ code, label, hint, tone = 'success' }) => (
  <div className={`rounded-xl border px-4 py-3 text-center ${TONE_CLASSES[tone]}`}>
    <span className="block text-[11px] font-bold uppercase tracking-widest">{label}</span>
    <span className="mt-1 block font-mono text-2xl font-extrabold tracking-[0.2em]">{code}</span>
    {hint && <span className="mt-1 block text-[11px] opacity-80">{hint}</span>}
  </div>
);

export const StatusBadge: React.FC<{ tone: Tone; label: string; className?: string }> = ({
  tone,
  label,
  className,
}) => <Badge tone={tone} className={className}>{label}</Badge>;
