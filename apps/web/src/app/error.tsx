"use client";

import { useEffect } from "react";

import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      id="main-content"
      className="grid min-h-screen place-items-center bg-slate-50 p-6"
    >
      <div
        role="alert"
        className="max-w-lg rounded-2xl border border-red-200 bg-white p-8 text-center shadow-xl"
      >
        <p className="text-sm font-bold uppercase tracking-widest text-red-700">
          Operational error
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold text-slate-950">
          We could not open this workspace
        </h1>
        <p className="mt-3 text-slate-600">
          No action was submitted. Try loading the current state again.
        </p>
        <Button onClick={retry} className="mt-6">
          Try again
        </Button>
      </div>
    </main>
  );
}
