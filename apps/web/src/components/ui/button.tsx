import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
};

const variants: Record<ButtonVariant, string> = {
  primary:
    "border border-[var(--brand-action)] bg-[var(--brand-action)] text-[var(--brand-on-action)] hover:brightness-95",
  secondary:
    "border border-slate-300 bg-white text-slate-800 hover:border-slate-500 hover:bg-slate-50",
  danger: "border border-red-800 bg-red-800 text-white hover:bg-red-900",
  ghost:
    "border border-transparent text-slate-700 hover:border-slate-200 hover:bg-slate-100",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className = "",
      variant = "primary",
      size = "md",
      type = "button",
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-[2px] font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-action)] disabled:cursor-not-allowed disabled:opacity-55 ${
          size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm"
        } ${variants[variant]} ${className}`}
        {...props}
      />
    );
  },
);
