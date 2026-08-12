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
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[11px] font-black uppercase tracking-[0.2em] text-[var(--brand-action)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-3xl font-black tracking-tight text-[#17213d] sm:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </header>
  );
}
