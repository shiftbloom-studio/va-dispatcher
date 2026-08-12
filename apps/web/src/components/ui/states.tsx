import { AlertTriangle, Inbox, LoaderCircle, WifiOff } from "lucide-react";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex min-h-44 items-center justify-center gap-3 text-slate-600"
    >
      <LoaderCircle aria-hidden className="size-5 animate-spin" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-5 py-8 text-center">
      <Inbox aria-hidden className="mb-3 size-8 text-slate-400" />
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 max-w-md text-sm text-slate-600">{detail}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-900"
    >
      <div className="flex gap-3">
        <AlertTriangle aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="font-semibold">Unable to load this view</p>
          <p className="mt-1 text-sm">{message}</p>
          {onRetry ? (
            <button
              className="mt-2 text-sm font-bold underline underline-offset-2"
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function OfflineNotice() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm font-medium text-amber-950"
    >
      <WifiOff aria-hidden className="size-4" />
      You are offline. Live updates will resume when the connection returns.
    </div>
  );
}
