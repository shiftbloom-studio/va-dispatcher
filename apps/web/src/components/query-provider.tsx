"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            networkMode: "online",
            refetchOnWindowFocus: true,
            refetchIntervalInBackground: false,
            retry: (attempt, error) => {
              const status =
                typeof error === "object" && error && "status" in error
                  ? error.status
                  : null;
              return status === 401 || status === 403 || status === 404
                ? false
                : attempt < 2;
            },
          },
          mutations: { networkMode: "online", retry: false },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
