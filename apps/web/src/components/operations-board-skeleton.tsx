export function OperationsBoardSkeleton() {
  return (
    <section
      aria-label="Loading live operations board"
      aria-busy="true"
      className="animate-pulse"
      role="status"
    >
      <span className="sr-only">Loading live operations board</span>
      <div className="border-y border-slate-300 bg-white">
        <div className="grid snap-x snap-mandatory grid-flow-col auto-cols-[85%] divide-x divide-slate-200 overflow-x-auto md:grid-flow-row md:auto-cols-auto md:grid-cols-4 md:overflow-visible">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="min-h-40 px-5 py-4 sm:px-6">
              <div className="h-2.5 w-24 bg-slate-200" />
              <div className="mt-3 h-7 w-14 bg-slate-300" />
              <div className="mt-2 h-2.5 w-32 max-w-full bg-slate-100" />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-4 mt-7 flex items-end justify-between gap-3">
        <div>
          <div className="h-6 w-28 bg-slate-300" />
          <div className="mt-2 h-3 w-80 max-w-[70vw] bg-slate-200" />
        </div>
        <div className="h-10 w-24 border border-slate-200 bg-white" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="border-t-2 border-slate-300 bg-[#f2f3f2]">
            <div className="flex min-h-18 items-center border-x border-b border-slate-200 bg-white px-4 py-3">
              <div className="size-5 bg-slate-200" />
              <div className="ml-3 flex-1">
                <div className="h-4 w-24 bg-slate-300" />
                <div className="mt-2 h-2.5 w-32 max-w-full bg-slate-100" />
              </div>
              <div className="ml-3 size-8 bg-slate-100" />
            </div>
            <div className="min-h-52 border-x border-slate-200 p-2.5 2xl:min-h-[34rem]">
              <div className="h-28 border border-slate-200 bg-white" />
            </div>
            <div className="h-8 border border-slate-200 bg-white" />
          </div>
        ))}
      </div>

      <div className="mt-8">
        <div className="mb-3">
          <div className="h-6 w-48 bg-slate-300" />
          <div className="mt-2 h-3 w-96 max-w-[80vw] bg-slate-200" />
        </div>
        <SimulatorTelemetrySkeleton />
      </div>
    </section>
  );
}

export function SimulatorTelemetrySkeleton() {
  return (
    <div
      aria-label="Loading live simulator telemetry"
      aria-busy="true"
      className="min-h-40 animate-pulse border border-slate-200 bg-white p-4"
      role="status"
    >
      <span className="sr-only">Loading live simulator telemetry</span>
      <div className="h-4 w-40 bg-slate-200" />
      <div className="mt-3 h-3 w-64 max-w-full bg-slate-100" />
    </div>
  );
}
