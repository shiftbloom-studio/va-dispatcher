"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/states";
import { apiErrorMessage } from "@/lib/api/http";

export default function ProtectedError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => console.error(error), [error]);
  return <ErrorState message={apiErrorMessage(error)} onRetry={retry} />;
}
