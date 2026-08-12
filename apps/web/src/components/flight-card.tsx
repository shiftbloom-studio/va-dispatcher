import { ArrowRight, Clock3, Plane } from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/ui/badge";
import type { Flight } from "@/lib/api/schemas";
import { formatUtc } from "@/lib/utc";

export function FlightCard({ flight, href }: { flight: Flight; href: string }) {
  return (
    <Link
      href={href}
      className="group block rounded-[2px] border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-[2px] bg-slate-100 text-slate-700">
            <Plane aria-hidden className="size-4" />
          </span>
          <div>
            <p className="font-display font-bold text-slate-950">
              {flight.flightNumber}
            </p>
            <p className="text-xs text-slate-500">
              {flight.aircraftType || "Aircraft TBA"}
            </p>
          </div>
        </div>
        <StatusBadge status={flight.status} />
      </div>
      <div className="mt-5 flex items-center gap-3">
        <div>
          <p className="font-display text-xl font-bold text-slate-950">
            {flight.depIcao}
          </p>
          <p className="text-xs text-slate-500">
            {formatUtc(flight.etd, {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <div className="flex min-w-10 flex-1 items-center gap-2 text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          <ArrowRight
            aria-hidden
            className="size-4 transition group-hover:translate-x-1"
          />
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-bold text-slate-950">
            {flight.arrIcao}
          </p>
          <p className="text-xs text-slate-500">
            {formatUtc(flight.eta, {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>
      <p className="mt-4 flex items-center gap-1.5 border-t border-slate-100 pt-3 text-xs font-medium text-slate-500">
        <Clock3 aria-hidden className="size-3.5" /> Times shown in Zulu
      </p>
    </Link>
  );
}
