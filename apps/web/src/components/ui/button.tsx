import { forwardRef, type ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
};

const variants: Record<ButtonVariant, string> = {
  primary: "bg-[var(--accent)] text-white shadow-sm hover:brightness-95",
  secondary:
    "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-slate-700 hover:bg-slate-100",
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
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-55 ${
          size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm"
        } ${variants[variant]} ${className}`}
        {...props}
      />
    );
  },
);
