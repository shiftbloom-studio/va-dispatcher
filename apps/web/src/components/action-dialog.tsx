"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/fields";
import { apiErrorMessage } from "@/lib/api/http";

export function ConfirmAction({
  trigger,
  title,
  detail,
  confirmLabel,
  danger = false,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  detail: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
}) {
  return (
    <ActionDialog
      trigger={trigger}
      title={title}
      detail={detail}
      confirmLabel={confirmLabel}
      danger={danger}
      onConfirm={onConfirm}
    />
  );
}

export function ReasonAction({
  trigger,
  title,
  detail,
  confirmLabel,
  label = "Reason (optional)",
  danger = false,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  detail: string;
  confirmLabel: string;
  label?: string;
  danger?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  return (
    <ActionDialog
      trigger={trigger}
      title={title}
      detail={detail}
      confirmLabel={confirmLabel}
      label={label}
      danger={danger}
      withReason
      onConfirm={onConfirm}
    />
  );
}

function ActionDialog({
  trigger,
  title,
  detail,
  confirmLabel,
  label,
  danger,
  withReason = false,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  detail: string;
  confirmLabel: string;
  label?: string;
  danger?: boolean;
  withReason?: boolean;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
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
      await onConfirm(reason.trim());
      dialog.current?.close();
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
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/60"
      >
        <form method="dialog" onSubmit={(event) => event.preventDefault()}>
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-display text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
          </div>
          <div className="p-5">
            {withReason ? (
              <div>
                <Label
                  htmlFor={`reason-${confirmLabel.replaceAll(" ", "-").toLowerCase()}`}
                >
                  {label}
                </Label>
                <Textarea
                  id={`reason-${confirmLabel.replaceAll(" ", "-").toLowerCase()}`}
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Add context for the operations team…"
                />
              </div>
            ) : null}
            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800"
              >
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => dialog.current?.close()}
              >
                Keep current state
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                disabled={pending}
                onClick={() => void submit()}
              >
                {pending ? "Saving…" : confirmLabel}
              </Button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
