import type { ReactNode } from "react";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-slate-200 pb-6">
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="mb-2 text-sm font-bold text-slate-700">{eyebrow}</p>
        ) : null}
        <h1 className="text-balance font-display text-3xl font-black leading-tight tracking-[-0.025em] text-[var(--foreground)] sm:text-[2rem]">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-[70ch] text-pretty text-sm leading-6 text-slate-600 sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
