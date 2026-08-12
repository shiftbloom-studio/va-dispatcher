import { CalendarRange, ChevronRight } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/ui/badge";
import type { ScheduleRequest } from "@/lib/api/schemas";
import { formatUtc } from "@/lib/utc";

export function ScheduleRequestCard({
  request,
  href,
}: {
  request: ScheduleRequest;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-50 text-[var(--accent)]">
        <CalendarRange aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate font-semibold text-slate-950">
            {request.title || `${request.desiredFlightCount}-flight request`}
          </p>
          <StatusBadge status={request.status} />
        </div>
        <p className="mt-1 truncate text-sm text-slate-600">
          {formatUtc(request.windowStart)} – {formatUtc(request.windowEnd)}
        </p>
      </div>
      <ChevronRight aria-hidden className="size-5 shrink-0 text-slate-400" />
    </Link>
  );
}
