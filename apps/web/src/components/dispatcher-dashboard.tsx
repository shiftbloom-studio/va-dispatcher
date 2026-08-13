"use client";

import { ClipboardList, Plane, RadioTower } from "lucide-react";
import { useRouter } from "next/navigation";

import { DispatcherFlightList } from "@/components/dispatcher-flight-list";
import { OperationsBoard } from "@/components/operations-board";
import { PageHeading } from "@/components/page-heading";
import { RequestQueue } from "@/components/request-queue";
import {
  dispatcherCopy,
  type DispatcherView,
} from "@/components/dispatcher-view";

const views: Array<{
  value: DispatcherView;
  label: string;
  icon: typeof RadioTower;
}> = [
  { value: "operations", label: "Operations", icon: RadioTower },
  { value: "requests", label: "Requests", icon: ClipboardList },
  { value: "flights", label: "Flights", icon: Plane },
];

export function DispatcherDashboard({
  slug,
  view,
}: {
  slug: string;
  view: DispatcherView;
}) {
  const router = useRouter();
  const copy = dispatcherCopy[view];

  function select(next: DispatcherView) {
    const params = new URLSearchParams();
    if (next !== "operations") params.set("view", next);
    router.replace(
      `/${slug}/dispatch${params.size ? `?${params.toString()}` : ""}`,
    );
  }

  return (
    <>
      <PageHeading
        eyebrow="Dispatcher suite"
        title={copy.title}
        description={copy.description}
      />
      <div
        role="tablist"
        aria-label="Dispatcher workspace"
        className="mb-7 flex max-w-xl border border-slate-300 bg-white"
      >
        {views.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            role="tab"
            aria-selected={view === value}
            onClick={() => select(value)}
            className={`flex min-h-11 flex-1 items-center justify-center gap-2 border-r border-slate-200 px-3 text-sm font-bold transition last:border-r-0 focus-visible:outline-2 focus-visible:outline-[var(--brand-action)] ${view === value ? "bg-[#17213d] text-white" : "text-slate-600 hover:bg-slate-50"}`}
          >
            <Icon aria-hidden className="size-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
      {view === "operations" ? <OperationsBoard slug={slug} /> : null}
      {view === "requests" ? <RequestQueue slug={slug} /> : null}
      {view === "flights" ? <DispatcherFlightList slug={slug} /> : null}
    </>
  );
}
