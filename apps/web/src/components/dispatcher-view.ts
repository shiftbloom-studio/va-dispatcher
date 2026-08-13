export type DispatcherView = "operations" | "requests" | "flights";

export const dispatcherCopy: Record<
  DispatcherView,
  { title: string; description: string }
> = {
  operations: {
    title: "Operations dashboard",
    description:
      "Plan accepted flights, publish releases, monitor active flying, and close the monthly operation from one live board.",
  },
  requests: {
    title: "Schedule requests",
    description: "Review pilot availability and offer complete schedules.",
  },
  flights: {
    title: "Flight management",
    description:
      "Create ad-hoc flights and manage every explicit operational transition.",
  },
};

export function parseDispatcherView(value: unknown): DispatcherView {
  return value === "requests" || value === "flights" ? value : "operations";
}
