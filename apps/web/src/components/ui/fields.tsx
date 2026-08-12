import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export function Label({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-sm font-semibold text-slate-800"
    >
      {children}
    </label>
  );
}

const fieldClass =
  "min-h-11 w-full rounded-[2px] border border-slate-300 bg-white px-3 py-2 text-base text-slate-950 outline-none placeholder:text-slate-400 focus:border-[var(--brand-action)] focus:ring-2 focus:ring-[var(--brand-soft)] disabled:bg-slate-100 sm:text-sm";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className = "", ...props }, ref) {
  return (
    <input ref={ref} className={`${fieldClass} ${className}`} {...props} />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className = "", ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={`${fieldClass} min-h-28 resize-y ${className}`}
      {...props}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className = "", ...props }, ref) {
  return (
    <select ref={ref} className={`${fieldClass} ${className}`} {...props} />
  );
});

export function FieldError({
  children,
  id,
}: {
  children?: React.ReactNode;
  id?: string;
}) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-sm font-medium text-red-700">
      {children}
    </p>
  );
}

export function HelpText({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-sm text-slate-500">{children}</p>;
}
