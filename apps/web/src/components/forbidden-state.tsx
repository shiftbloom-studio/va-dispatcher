import { LockKeyhole } from "lucide-react";
import Link from "next/link";

export function ForbiddenState({
  slug,
  destination,
}: {
  slug: string;
  destination: "portal" | "dispatch";
}) {
  return (
    <section
      role="alert"
      className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center"
    >
      <LockKeyhole aria-hidden className="mx-auto size-8 text-amber-800" />
      <h1 className="mt-4 font-display text-2xl font-semibold text-slate-950">
        This workspace is not available for your role
      </h1>
      <p className="mt-2 text-slate-700">
        Your local Virtual Airline membership controls access to operational
        screens.
      </p>
      <Link
        href={`/${slug}/${destination}`}
        className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-slate-950 px-4 py-2 text-sm font-bold text-white"
      >
        Go to your workspace
      </Link>
    </section>
  );
}
