"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/fields";
import { apiErrorMessage } from "@/lib/api/http";

export type LinkedFlightCancellationAction = "keep" | "cancel_predeparture";

export function ScheduleCancellationAction({
  trigger,
  onConfirm,
}: {
  trigger: ReactNode;
  onConfirm: (
    linkedFlightAction: LinkedFlightCancellationAction,
    reason: string,
  ) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [linkedFlightAction, setLinkedFlightAction] =
    useState<LinkedFlightCancellationAction>("keep");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const resetDialogState = () => {
      setPending(false);
      setError(null);
    };
    element.addEventListener("close", resetDialogState);
    return () => element.removeEventListener("close", resetDialogState);
  }, []);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      await onConfirm(linkedFlightAction, reason.trim());
      dialog.current?.close();
      setLinkedFlightAction("keep");
      setReason("");
    } catch (caughtError) {
      setError(apiErrorMessage(caughtError));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <span onClick={() => dialog.current?.showModal()}>{trigger}</span>
      <dialog
        ref={dialog}
        className="m-auto w-[min(36rem,calc(100%-2rem))] rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/60"
      >
        <form method="dialog" onSubmit={(event) => event.preventDefault()}>
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-display text-xl font-semibold">
              Cancel this schedule request?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The request becomes terminal. Choose explicitly what happens to
              its linked flights.
            </p>
          </div>
          <div className="space-y-5 p-5">
            <fieldset>
              <legend className="text-sm font-bold text-slate-800">
                Linked flight outcome
              </legend>
              <div className="mt-3 space-y-3">
                <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-4 has-[:checked]:border-[var(--accent)] has-[:checked]:bg-sky-50">
                  <input
                    type="radio"
                    name="linked-flight-action"
                    value="keep"
                    aria-label="Keep linked flights"
                    checked={linkedFlightAction === "keep"}
                    onChange={() => setLinkedFlightAction("keep")}
                    className="mt-1"
                  />
                  <span>
                    <strong className="block text-sm">
                      Keep linked flights
                    </strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                      Recommended when valid offers should continue. No linked
                      flight state changes.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-4 has-[:checked]:border-red-400 has-[:checked]:bg-red-50">
                  <input
                    type="radio"
                    name="linked-flight-action"
                    value="cancel_predeparture"
                    aria-label="Cancel pre-departure flights"
                    checked={linkedFlightAction === "cancel_predeparture"}
                    onChange={() =>
                      setLinkedFlightAction("cancel_predeparture")
                    }
                    className="mt-1"
                  />
                  <span>
                    <strong className="block text-sm">
                      Cancel pre-departure flights
                    </strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">
                      Cancels linked draft, offered, accepted, and briefed
                      flights. Active, completed, declined, and already
                      cancelled records remain unchanged.
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
            <div>
              <Label htmlFor="schedule-cancel-reason">Reason (optional)</Label>
              <Textarea
                id="schedule-cancel-reason"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Add context for the pilot and operations history…"
              />
            </div>
            {error ? (
              <p
                role="alert"
                className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => dialog.current?.close()}
              >
                Keep current state
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => void submit()}
              >
                {pending ? "Cancelling…" : "Cancel request"}
              </Button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
